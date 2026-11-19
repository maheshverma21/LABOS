import type { NextFunction, Request, Response } from "express";
import type { Permission } from "@lms/shared";
import { verifyAccessToken } from "../lib/tokens";
import { getAccess, type Access } from "../lib/access";
import { tenantDb, type TenantDb } from "../lib/tenant-db";
import { isSessionRevoked } from "../modules/auth/session.store";
import { forbidden, unauthorized } from "../lib/errors";

/** Requires a valid access token. Sets req.auth and req.db. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) throw unauthorized();

  const claims = verifyAccessToken(token);
  if (!claims) throw unauthorized();

  if (await isSessionRevoked(claims.sid)) throw unauthorized();

  const access = await getAccess(claims.sub);
  if (!access || !access.active || access.tenantId !== claims.tid) throw unauthorized();

  req.auth = { ...access, sessionId: claims.sid };
  req.db = tenantDb(access.tenantId);
  next();
}

/** Requires every listed permission. Use after `authenticate`. */
export function requirePermission(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const granted = req.auth?.permissions ?? [];
    if (!required.every((p) => granted.includes(p))) throw forbidden();
    next();
  };
}

/** For handlers behind `authenticate`: returns auth + db without non-null assertions. */
export function ctx(req: Request): { auth: Access & { sessionId: string }; db: TenantDb } {
  if (!req.auth || !req.db) throw unauthorized();
  return { auth: req.auth, db: req.db };
}
