import type { AuthResponse, LoginInput, SessionUser, SignupInput } from "@lms/shared";
import { env, publicBaseUrl } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { hashPassword, verifyPassword } from "../../lib/password";
import {
  hashSecret,
  newRefreshSecret,
  parseRefreshToken,
  secretMatches,
  signAccessToken,
} from "../../lib/tokens";
import { getAccess, invalidateAccess } from "../../lib/access";
import { audit } from "../../lib/audit";
import { rateLimit, resetRateLimit } from "../../lib/rate-limit";
import { redis } from "../../lib/redis";
import { badRequest, conflict, notFound, unauthorized } from "../../lib/errors";
import { buttonEmail, sendMail } from "../../lib/mailer";
import { createTenantWithOwner } from "../tenants/tenant.service";
import { markSessionRevoked } from "./session.store";

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/** How long the previous refresh secret keeps working after a rotation. */
const ROTATION_GRACE_MS = 30_000;

export interface IssuedTokens extends AuthResponse {
  refreshToken: string;
  refreshExpiresAt: Date;
}

// ---------------------------------------------------------------------------

export async function signup(input: SignupInput, meta: RequestMeta): Promise<IssuedTokens> {
  await rateLimit(`signup:${meta.ip}`, 5, 60 * 60);

  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    throw conflict("An account with this email already exists", {
      email: ["An account with this email already exists"],
    });
  }

  const passwordHash = await hashPassword(input.password);

  const { tenant, owner } = await prisma.$transaction(async (tx) => {
    const created = await createTenantWithOwner(tx, { ...input, passwordHash });
    await audit(
      {
        tenantId: created.tenant.id,
        actorId: created.owner.id,
        action: "tenant.signup",
        entityType: "tenant",
        entityId: created.tenant.id,
        after: { name: created.tenant.name, slug: created.tenant.slug },
        ...meta,
      },
      tx,
    );
    return created;
  });

  return startSession(owner.id, tenant.id, meta);
}

export async function login(input: LoginInput, meta: RequestMeta): Promise<IssuedTokens> {
  const limitKey = `login:${meta.ip}:${input.email}`;
  await rateLimit(limitKey, 10, 15 * 60);

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, tenantId: true, passwordHash: true, isActive: true, accountId: true, account: { select: { isActive: true } }, tenant: { select: { status: true } } },
  });

  // Always run bcrypt so response time doesn't reveal whether the email exists.
  const valid = await verifyPassword(input.password, user?.passwordHash);
  if (!user || !valid) throw unauthorized("Incorrect email or password");
  if (!user.isActive) throw unauthorized("This account has been deactivated. Contact your lab admin.");
  if (user.tenant.status === "SUSPENDED") {
    throw unauthorized("This lab's account is suspended. Contact support.");
  }
  if (user.accountId && !user.account?.isActive) throw unauthorized("This account has been switched off. Contact the lab.");

  await resetRateLimit(limitKey);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ tenantId: user.tenantId, actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id, ...meta });

  return startSession(user.id, user.tenantId, meta);
}

/** Swaps a one-time ticket minted by a platform admin for a normal session as the lab's owner. */
export async function loginWithTicket(ticket: string, meta: RequestMeta): Promise<IssuedTokens> {
  const key = `labticket:${ticket}`;
  const raw = await redis.get(key);
  // Deleting is the claim: only one caller gets a 1 back.
  if (!raw || (await redis.del(key)) !== 1) throw unauthorized("This sign-in link has expired. Go back to the console and try again.");
  const { userId, tenantId } = JSON.parse(raw) as { userId: string; tenantId: string };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, tenantId: true, isActive: true, tenant: { select: { status: true } } } });
  if (!user || user.tenantId !== tenantId || !user.isActive || user.tenant.status === "SUSPENDED") throw unauthorized("This lab can't be signed in to right now.");
  await audit({ tenantId, actorId: null, action: "platform.login_as_session", entityType: "user", entityId: userId, ...meta });
  return startSession(user.id, user.tenantId, meta);
}

export async function refresh(
  refreshToken: string | undefined,
  meta: RequestMeta,
  attempt = 0,
): Promise<IssuedTokens> {
  const parsed = refreshToken ? parseRefreshToken(refreshToken) : null;
  if (!parsed) throw unauthorized();

  const session = await prisma.session.findUnique({ where: { id: parsed.sessionId } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) throw unauthorized();

  const isCurrent = secretMatches(parsed.secret, session.refreshTokenHash);
  const isRecentPrevious =
    !isCurrent &&
    session.rotatedAt !== null &&
    Date.now() - session.rotatedAt.getTime() < ROTATION_GRACE_MS &&
    secretMatches(parsed.secret, session.prevRefreshTokenHash);

  if (!isCurrent && !isRecentPrevious) {
    // An old refresh token was replayed: assume it was stolen and end the session.
    await revokeSession(session.id, "refresh_token_reuse");
    await audit({
      tenantId: session.tenantId,
      actorId: session.userId,
      action: "auth.refresh_reuse_detected",
      entityType: "session",
      entityId: session.id,
      ...meta,
    });
    throw unauthorized();
  }

  const access = await getAccess(session.userId);
  if (!access?.active) {
    await revokeSession(session.id, "user_inactive");
    throw unauthorized();
  }

  const secret = newRefreshSecret();
  // Only rotate if nobody else rotated since we read the row (two tabs refreshing at once).
  const rotated = await prisma.session.updateMany({
    where: { id: session.id, refreshTokenHash: session.refreshTokenHash },
    data: {
      prevRefreshTokenHash: session.refreshTokenHash,
      refreshTokenHash: hashSecret(secret),
      rotatedAt: new Date(),
      lastUsedAt: new Date(),
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
    },
  });
  if (rotated.count === 0) {
    // Lost the race: our secret is now the "previous" one, which the retry accepts.
    if (attempt === 0) return refresh(refreshToken, meta, 1);
    throw unauthorized();
  }

  return {
    accessToken: signAccessToken({ sub: session.userId, tid: session.tenantId, sid: session.id }),
    expiresIn: env.ACCESS_TOKEN_TTL,
    refreshToken: `${session.id}.${secret}`,
    refreshExpiresAt: session.expiresAt,
    user: await buildSessionUser(session.userId),
  };
}

export async function logout(refreshToken: string | undefined, sessionId?: string): Promise<void> {
  const id = sessionId ?? (refreshToken ? parseRefreshToken(refreshToken)?.sessionId : undefined);
  if (id) await revokeSession(id, "logout");
}

export async function listSessions(userId: string, currentSessionId: string) {
  const sessions = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
    select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true },
  });
  return sessions.map((s) => ({ ...s, current: s.id === currentSessionId }));
}

export async function revokeOwnSession(userId: string, sessionId: string): Promise<void> {
  const session = await prisma.session.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
  if (!session) throw notFound("Session not found");
  await revokeSession(session.id, "revoked_by_user");
}

/** Signs a user out everywhere, e.g. after a password change or deactivation. */
export async function revokeAllSessions(userId: string, reason: string): Promise<void> {
  const sessions = await prisma.session.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await Promise.all(sessions.map((s) => markSessionRevoked(s.id)));
  await invalidateAccess(userId);
}

// ---------------------------------------------------------------------------

async function startSession(userId: string, tenantId: string, meta: RequestMeta): Promise<IssuedTokens> {
  const secret = newRefreshSecret();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const session = await prisma.session.create({
    data: {
      tenantId,
      userId,
      refreshTokenHash: hashSecret(secret),
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
    },
  });

  return {
    accessToken: signAccessToken({ sub: userId, tid: tenantId, sid: session.id }),
    expiresIn: env.ACCESS_TOKEN_TTL,
    refreshToken: `${session.id}.${secret}`,
    refreshExpiresAt: expiresAt,
    user: await buildSessionUser(userId),
  };
}

async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await markSessionRevoked(sessionId);
}

export async function buildSessionUser(userId: string): Promise<SessionUser> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      mustChangePassword: true,
      account: { select: { id: true, code: true, name: true } },
      tenant: { select: { id: true, name: true, slug: true } },
    },
  });
  const access = await getAccess(userId);
  if (!access) throw unauthorized();

  const branches = await prisma.branch.findMany({
    where: {
      tenantId: user.tenant.id,
      isActive: true,
      ...(access.branchIds ? { id: { in: access.branchIds } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    tenant: user.tenant,
    account: user.account,
    branches,
    roles: access.roles,
    permissions: access.permissions,
    mustChangePassword: user.mustChangePassword,
  };
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

const RESET_MINUTES = 30;

/**
 * Emails a reset link if the account exists. Always looks the same to the
 * caller, so it can't be used to find out which emails have accounts.
 */
export async function forgotPassword(email: string, meta: RequestMeta): Promise<boolean> {
  await rateLimit(`forgot:${meta.ip}`, 10, 60 * 60);
  await rateLimit(`forgot-email:${email}`, 3, 60 * 60);
  return issueReset(email, meta);
}

async function issueReset(email: string, meta: RequestMeta): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, tenantId: true, isActive: true, tenant: { select: { name: true, status: true } } },
  });
  if (!user || !user.isActive || user.tenant.status === "SUSPENDED") return false;

  const secret = newRefreshSecret();
  const reset = await prisma.$transaction(async (tx) => {
    // Only the newest link works.
    await tx.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    return tx.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: hashSecret(secret),
        expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000),
        requestedIp: meta.ip,
      },
      select: { id: true },
    });
  });
  await audit({ tenantId: user.tenantId, actorId: user.id, action: "auth.password_reset_requested", entityType: "user", entityId: user.id, ...meta });

  const url = `${publicBaseUrl()}/reset-password?token=${encodeURIComponent(`${reset.id}.${secret}`)}`;
  return sendMail({
    to: email,
    subject: "Reset your password",
    ...buttonEmail({
      greeting: `Hello ${user.name},`,
      lines: [`Someone asked to reset the password for your ${user.tenant.name} account. If it was you, use the button below. The link works once, for ${RESET_MINUTES} minutes.`],
      button: { label: "Choose a new password", url },
      footer: "If you didn't ask for this, ignore this email: your password stays the same.",
    }),
  });
}

async function setPassword(userId: string, password: string, reason: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password), mustChangePassword: false, passwordChangedAt: new Date() },
  });
  await revokeAllSessions(userId, reason);
}

/** Uses a reset link. Signs the user out everywhere; they then sign in with the new password. */
export async function resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
  await rateLimit(`reset:${meta.ip}`, 20, 60 * 60);
  const invalid = () => badRequest("This reset link is invalid or has expired. Ask for a new one.");
  const parsed = parseRefreshToken(token);
  if (!parsed) throw invalid();
  const reset = await prisma.passwordReset.findUnique({
    where: { id: parsed.sessionId },
    select: { id: true, userId: true, tokenHash: true, expiresAt: true, usedAt: true, user: { select: { tenantId: true, email: true, name: true, isActive: true } } },
  });
  if (!reset || reset.usedAt || reset.expiresAt < new Date() || !reset.user.isActive || !secretMatches(parsed.secret, reset.tokenHash)) {
    throw invalid();
  }
  // Claim the link first, so two clicks can't both use it.
  const claimed = await prisma.passwordReset.updateMany({ where: { id: reset.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count === 0) throw invalid();

  await setPassword(reset.userId, password, "password_reset");
  await audit({ tenantId: reset.user.tenantId, actorId: reset.userId, action: "auth.password_reset", entityType: "user", entityId: reset.userId, ...meta });
  await sendMail({
    to: reset.user.email,
    subject: "Your password was changed",
    text: `Hello ${reset.user.name},

Your password was just reset and you've been signed out of every device. If this wasn't you, contact your lab owner straight away.`,
  });
}

/** Changes your own password. Other devices are signed out; this one stays signed in. */
export async function changePassword(
  userId: string,
  sessionId: string,
  input: { currentPassword: string; newPassword: string },
  meta: RequestMeta,
): Promise<void> {
  await rateLimit(`change-password:${userId}`, 10, 15 * 60);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true, tenantId: true } });
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw badRequest("Your current password is wrong", { currentPassword: ["Your current password is wrong"] });
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, passwordChangedAt: new Date() },
  });
  const others = await prisma.session.findMany({ where: { userId, revokedAt: null, id: { not: sessionId } }, select: { id: true } });
  await Promise.all(others.map((o) => revokeSession(o.id, "password_changed")));
  await audit({ tenantId: user.tenantId, actorId: userId, action: "auth.password_change", entityType: "user", entityId: userId, ...meta });
}

/** The owner choosing a temporary password for someone; they must change it at next sign-in. */
export async function setTemporaryPassword(userId: string, password: string): Promise<void> {
  await setPassword(userId, password, "temporary_password_set");
  await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: true } });
}

/** The owner sending someone a reset link. Unlike the public form, the owner learns if the email failed. */
export async function sendResetLink(userId: string, meta: RequestMeta): Promise<boolean> {
  // Its own limit: the owner helping someone shouldn't be blocked by the public form's.
  await rateLimit(`owner-reset:${userId}`, 5, 60 * 60);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  return issueReset(user.email, meta);
}
