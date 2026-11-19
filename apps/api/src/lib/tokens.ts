import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

const ISSUER = "lms-api";
const AUDIENCE = "lms-web";

export interface AccessTokenClaims {
  /** User id */
  sub: string;
  /** Tenant id */
  tid: string;
  /** Session id, used to revoke a device's access before the token expires */
  sid: string;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign({ tid: claims.tid, sid: claims.sid }, env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    subject: claims.sub,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL,
  });
}

/** Returns the claims, or null if the token is invalid or expired. */
export function verifyAccessToken(token: string): AccessTokenClaims | null {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload === "string") return null;
    const { sub, tid, sid } = payload as jwt.JwtPayload & { tid?: unknown; sid?: unknown };
    if (typeof sub !== "string" || typeof tid !== "string" || typeof sid !== "string") return null;
    return { sub, tid, sid };
  } catch {
    return null;
  }
}

export function newRefreshSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function secretMatches(secret: string, hash: string | null | undefined): boolean {
  if (!hash) return false;
  const a = Buffer.from(hashSecret(secret), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Refresh tokens look like "<sessionId>.<secret>". */
export function parseRefreshToken(token: string): { sessionId: string; secret: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const sessionId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/i.test(sessionId) || secret.length < 32) return null;
  return { sessionId, secret };
}

// Platform admins get tokens for a different audience, so a lab user's token
// can never be used on /api/admin and vice versa.
const ADMIN_AUDIENCE = "lms-admin";

export interface AdminTokenClaims {
  /** PlatformAdmin id */
  sub: string;
  /** PlatformSession id */
  sid: string;
}

export function signAdminToken(claims: AdminTokenClaims): string {
  return jwt.sign({ sid: claims.sid, kind: "platform" }, env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    subject: claims.sub,
    issuer: ISSUER,
    audience: ADMIN_AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL,
  });
}

export function verifyAdminToken(token: string): AdminTokenClaims | null {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: ADMIN_AUDIENCE,
    });
    if (typeof payload === "string") return null;
    const { sub, sid, kind } = payload as jwt.JwtPayload & { sid?: unknown; kind?: unknown };
    if (typeof sub !== "string" || typeof sid !== "string" || kind !== "platform") return null;
    return { sub, sid };
  } catch {
    return null;
  }
}

// Between the password step and the authenticator-code step of an admin sign-in.
const MFA_AUDIENCE = "lms-admin-mfa";

export function signMfaToken(adminId: string): string {
  return jwt.sign({ kind: "mfa" }, env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    subject: adminId,
    issuer: ISSUER,
    audience: MFA_AUDIENCE,
    expiresIn: 5 * 60,
  });
}

export function verifyMfaToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ["HS256"], issuer: ISSUER, audience: MFA_AUDIENCE });
    if (typeof payload === "string" || payload.kind !== "mfa" || typeof payload.sub !== "string") return null;
    return payload.sub;
  } catch {
    return null;
  }
}
