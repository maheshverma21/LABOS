import type { NextFunction, Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import QRCode from "qrcode";
import type { AdminMfaChallenge, AdminMfaSetup, AdminSessionUser, PlatformRole } from "@lms/shared";
import { adminMfaRequired, env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { hashPassword, verifyPassword } from "../../lib/password";
import {
  hashSecret,
  newRefreshSecret,
  parseRefreshToken,
  secretMatches,
  signAdminToken,
  signMfaToken,
  verifyAdminToken,
  verifyMfaToken,
} from "../../lib/tokens";
import { decryptSecret, encryptSecret } from "../../lib/secrets";
import { newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from "../../lib/totp";
import { rateLimit, resetRateLimit } from "../../lib/rate-limit";
import { AppError, badRequest, conflict, forbidden, unauthorized } from "../../lib/errors";
import { logger } from "../../lib/logger";

/** Admin sessions are short: a working day, then sign in again. */
const SESSION_HOURS = 12;
const ROTATION_GRACE_MS = 30_000;

export interface Meta {
  ip: string | null;
  userAgent: string | null;
}

export interface AdminTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  admin: AdminSessionUser;
}

const adminSelect = { id: true, name: true, email: true, role: true, totpEnabledAt: true } as const;

const toSessionAdmin = (a: { id: string; name: string; email: string; role: PlatformRole; totpEnabledAt: Date | null }): AdminSessionUser => ({
  id: a.id,
  name: a.name,
  email: a.email,
  role: a.role,
  mfaEnabled: !!a.totpEnabledAt,
  mfaRequired: adminMfaRequired,
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface PlatformAuditEntry {
  adminId: string | null;
  action: string;
  tenantId?: string | null;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
}

type AuditDb = { platformAuditLog: { create(args: { data: Prisma.PlatformAuditLogUncheckedCreateInput }): PromiseLike<unknown> } };

export async function platformAudit(entry: PlatformAuditEntry, db: AuditDb = prisma): Promise<void> {
  try {
    await db.platformAuditLog.create({ data: entry });
  } catch (err) {
    if ((db as unknown) !== prisma) throw err;
    logger.error({ err, action: entry.action }, "failed to write platform audit log");
  }
}

// ---------------------------------------------------------------------------
// Sign-in, refresh, sign-out
// ---------------------------------------------------------------------------

async function startSession(admin: AdminSessionUser, meta: Meta): Promise<AdminTokens> {
  const secret = newRefreshSecret();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
  const session = await prisma.platformSession.create({
    data: {
      adminId: admin.id,
      refreshTokenHash: hashSecret(secret),
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
    },
    select: { id: true },
  });
  return {
    accessToken: signAdminToken({ sub: admin.id, sid: session.id }),
    expiresIn: env.ACCESS_TOKEN_TTL,
    refreshToken: `${session.id}.${secret}`,
    refreshExpiresAt: expiresAt,
    admin,
  };
}

export async function adminLogin(email: string, password: string, meta: Meta): Promise<AdminTokens | AdminMfaChallenge> {
  const limitKey = `admin-login:${meta.ip}`;
  // Stricter than lab sign-in: this account can see every lab.
  await rateLimit(limitKey, 5, 15 * 60);
  const admin = await prisma.platformAdmin.findUnique({
    where: { email },
    select: { ...adminSelect, passwordHash: true, isActive: true },
  });
  const valid = await verifyPassword(password, admin?.passwordHash);
  if (!admin || !valid || !admin.isActive) {
    await platformAudit({ adminId: admin?.id ?? null, action: "admin.login_failed", entityType: "platform_admin", after: { email }, ...meta });
    throw unauthorized("Incorrect email or password");
  }
  await resetRateLimit(limitKey);
  // With two-step sign-in on, the password alone only earns a short-lived ticket for the code step.
  if (admin.totpEnabledAt) return { mfaRequired: true, mfaToken: signMfaToken(admin.id) };
  return finishLogin(toSessionAdmin(admin), meta, "password");
}

async function finishLogin(admin: AdminSessionUser, meta: Meta, method: string) {
  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
  await platformAudit({ adminId: admin.id, action: "admin.login", entityType: "platform_admin", entityId: admin.id, after: { method }, ...meta });
  return startSession(admin, meta);
}

/**
 * Checks an authenticator code or a recovery code, and uses it up so it can't
 * be replayed. Returns how it matched, or null.
 */
async function consumeCode(adminId: string, code: string): Promise<"totp" | "recovery" | null> {
  const a = await prisma.platformAdmin.findUnique({
    where: { id: adminId },
    select: { totpSecretEnc: true, totpLastStep: true, recoveryCodeHashes: true },
  });
  const secret = decryptSecret(a?.totpSecretEnc);
  if (!a || !secret) return null;
  if (/^\d{6}$/.test(code)) {
    const step = verifyTotp(secret, code, a.totpLastStep);
    if (step == null) return null;
    const used = await prisma.platformAdmin.updateMany({
      where: { id: adminId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    return used.count === 1 ? "totp" : null;
  }
  const hash = hashSecret(code);
  if (!a.recoveryCodeHashes.includes(hash)) return null;
  await prisma.platformAdmin.update({
    where: { id: adminId },
    data: { recoveryCodeHashes: a.recoveryCodeHashes.filter((h) => h !== hash) },
  });
  return "recovery";
}

/** The second step of a sign-in with two-step on. */
export async function adminMfaLogin(mfaToken: string, code: string, meta: Meta): Promise<AdminTokens> {
  const adminId = verifyMfaToken(mfaToken);
  if (!adminId) throw unauthorized("Your sign-in took too long. Start again.");
  await rateLimit(`admin-mfa:${adminId}`, 5, 15 * 60);
  const admin = await prisma.platformAdmin.findUnique({ where: { id: adminId }, select: { ...adminSelect, isActive: true } });
  if (!admin?.isActive || !admin.totpEnabledAt) throw unauthorized();
  const method = await consumeCode(adminId, code);
  if (!method) {
    await platformAudit({ adminId, action: "admin.mfa_failed", entityType: "platform_admin", entityId: adminId, ...meta });
    throw new AppError(401, "invalid_code", "That code didn't work. Check your authenticator app and try again.", { code: ["That code didn't work"] });
  }
  await resetRateLimit(`admin-mfa:${adminId}`);
  return finishLogin(toSessionAdmin(admin), meta, method);
}

// ---------------------------------------------------------------------------
// Setting up two-step sign-in
// ---------------------------------------------------------------------------

/** Starts setup: a new secret to scan. Nothing changes until enableMfa confirms a code. */
export async function setupMfa(adminId: string): Promise<AdminMfaSetup> {
  const a = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: adminId }, select: { email: true, totpEnabledAt: true } });
  if (a.totpEnabledAt) throw conflict("Two-step sign-in is already on");
  const secret = newTotpSecret();
  await prisma.platformAdmin.update({ where: { id: adminId }, data: { totpSecretEnc: encryptSecret(secret), totpLastStep: null } });
  const url = otpauthUrl(secret, a.email, "LabOS Admin");
  return { secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}

/** Confirms setup with a first code. Returns recovery codes, shown once. */
export async function enableMfa(adminId: string, code: string, meta: Meta): Promise<string[]> {
  const a = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: adminId }, select: { totpSecretEnc: true, totpEnabledAt: true } });
  if (a.totpEnabledAt) throw conflict("Two-step sign-in is already on");
  const secret = decryptSecret(a.totpSecretEnc);
  if (!secret) throw badRequest("Start the setup again");
  const step = verifyTotp(secret, code, null);
  if (step == null) throw badRequest("That code didn't work. Check the time on your phone and try again.", { code: ["That code didn't work"] });
  const codes = newRecoveryCodes();
  await prisma.platformAdmin.update({
    where: { id: adminId },
    data: { totpEnabledAt: new Date(), totpLastStep: step, recoveryCodeHashes: codes.map(hashSecret) },
  });
  await platformAudit({ adminId, action: "admin.mfa_enabled", entityType: "platform_admin", entityId: adminId, ...meta });
  return codes;
}

/** A super admin turning off someone's two-step sign-in (lost phone and recovery codes). They set it up again. */
export async function resetMfa(actorId: string, adminId: string, meta: Meta): Promise<void> {
  if (actorId === adminId) throw badRequest("Ask another super admin to reset yours");
  await prisma.platformAdmin.update({
    where: { id: adminId },
    data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: [] },
  });
  await prisma.platformSession.updateMany({ where: { adminId, revokedAt: null }, data: { revokedAt: new Date() } });
  await platformAudit({ adminId: actorId, action: "admin.mfa_reset", entityType: "platform_admin", entityId: adminId, ...meta });
}

export async function changeAdminPassword(adminId: string, sessionId: string, current: string, next: string, meta: Meta) {
  await rateLimit(`admin-change-password:${adminId}`, 5, 15 * 60);
  const a = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: adminId }, select: { passwordHash: true } });
  if (!(await verifyPassword(current, a.passwordHash))) {
    throw badRequest("Your current password is wrong", { currentPassword: ["Your current password is wrong"] });
  }
  await prisma.platformAdmin.update({ where: { id: adminId }, data: { passwordHash: await hashPassword(next) } });
  await prisma.platformSession.updateMany({ where: { adminId, revokedAt: null, id: { not: sessionId } }, data: { revokedAt: new Date() } });
  await platformAudit({ adminId, action: "admin.password_change", entityType: "platform_admin", entityId: adminId, ...meta });
}

export async function adminRefresh(token: string | undefined, meta: Meta, attempt = 0): Promise<AdminTokens> {
  const parsed = token ? parseRefreshToken(token) : null;
  if (!parsed) throw unauthorized();
  const session = await prisma.platformSession.findUnique({
    where: { id: parsed.sessionId },
    include: { admin: { select: { ...adminSelect, isActive: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date() || !session.admin.isActive) throw unauthorized();

  const isCurrent = secretMatches(parsed.secret, session.refreshTokenHash);
  const isRecentPrevious =
    !isCurrent &&
    session.rotatedAt !== null &&
    Date.now() - session.rotatedAt.getTime() < ROTATION_GRACE_MS &&
    secretMatches(parsed.secret, session.prevRefreshTokenHash);
  if (!isCurrent && !isRecentPrevious) {
    await prisma.platformSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await platformAudit({ adminId: session.adminId, action: "admin.refresh_reuse_detected", entityType: "platform_session", entityId: session.id, ...meta });
    throw unauthorized();
  }

  const secret = newRefreshSecret();
  const rotated = await prisma.platformSession.updateMany({
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
    if (attempt === 0) return adminRefresh(token, meta, 1);
    throw unauthorized();
  }
  return {
    accessToken: signAdminToken({ sub: session.admin.id, sid: session.id }),
    expiresIn: env.ACCESS_TOKEN_TTL,
    refreshToken: `${session.id}.${secret}`,
    refreshExpiresAt: session.expiresAt,
    admin: toSessionAdmin(session.admin),
  };
}

export async function adminLogout(token: string | undefined): Promise<void> {
  const parsed = token ? parseRefreshToken(token) : null;
  if (parsed) {
    await prisma.platformSession.updateMany({ where: { id: parsed.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminSessionUser & { sessionId: string };
    }
  }
}

/**
 * Requires a platform admin token. The session row is checked on every request
 * (there are few admins), so signing out or deactivating takes effect at once.
 */
export async function authenticateAdmin(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const claims = token ? verifyAdminToken(token) : null;
  if (!claims) throw unauthorized();
  const session = await prisma.platformSession.findUnique({
    where: { id: claims.sid },
    select: { adminId: true, revokedAt: true, expiresAt: true, admin: { select: { ...adminSelect, isActive: true } } },
  });
  if (!session || session.adminId !== claims.sub || session.revokedAt || session.expiresAt < new Date() || !session.admin.isActive) {
    throw unauthorized();
  }
  req.admin = { ...toSessionAdmin(session.admin), sessionId: claims.sid };
  next();
}

/** When two-step sign-in is required, nothing but the setup works until it's on. */
export function requireMfaReady(req: Request, _res: Response, next: NextFunction) {
  if (req.admin && req.admin.mfaRequired && !req.admin.mfaEnabled) {
    throw new AppError(403, "mfa_setup_required", "Set up two-step sign-in to continue");
  }
  next();
}

export function requireRole(role: PlatformRole) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.admin?.role !== role) throw forbidden("Only a super admin can do this");
    next();
  };
}

export function adminOf(req: Request) {
  if (!req.admin) throw unauthorized();
  return req.admin;
}
