import { Router, type CookieOptions, type Request, type Response } from "express";
import {
  adminChangePasswordSchema,
  adminTempPasswordSchema,
  adminUserAccessSchema,
  updateLabAccessSchema,
  adminSignOutSchema,
  adminUserStatusSchema,
  createPlatformAdminSchema,
  loginSchema,
  mfaCodeSchema,
  mfaLoginSchema,
  updateSubscriptionSchema,
  type AdminAuthResponse,
} from "@lms/shared";
import { z } from "zod";
import { cookieSecure } from "../../config/env";
import { validateBody } from "../../middleware/validate";
import { notFound } from "../../lib/errors";
import {
  adminLogin,
  adminLogout,
  adminMfaLogin,
  adminOf,
  adminRefresh,
  authenticateAdmin,
  changeAdminPassword,
  enableMfa,
  requireMfaReady,
  requireRole,
  resetMfa,
  setupMfa,
  type AdminTokens,
  type Meta,
} from "./admin-auth";
import * as admin from "./admin.service";

const COOKIE = "lms_admin_rt";
const cookieBase: CookieOptions = { httpOnly: true, secure: cookieSecure, sameSite: "strict", path: "/api/admin/auth" };

const meta = (req: Request): Meta => ({ ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null });
/** Malformed ids are just "not found". */
const idParam = (v: unknown) => {
  const r = z.uuid().safeParse(v);
  if (!r.success) throw notFound();
  return r.data;
};
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

function sendTokens(res: Response, t: AdminTokens) {
  res.cookie(COOKIE, t.refreshToken, { ...cookieBase, expires: t.refreshExpiresAt });
  const body: AdminAuthResponse = { accessToken: t.accessToken, expiresIn: t.expiresIn, admin: t.admin };
  res.setHeader("Cache-Control", "no-store");
  res.json(body);
}

export const adminRouter = Router();

// ---------------------------------------------------------------------------
// Sign-in (no token needed)
// ---------------------------------------------------------------------------

adminRouter.post("/auth/login", validateBody(loginSchema), async (req, res) => {
  const result = await adminLogin(req.body.email, req.body.password, meta(req));
  if ("mfaToken" in result) {
    res.setHeader("Cache-Control", "no-store");
    res.json(result);
    return;
  }
  sendTokens(res, result);
});

adminRouter.post("/auth/mfa", validateBody(mfaLoginSchema), async (req, res) => {
  sendTokens(res, await adminMfaLogin(req.body.mfaToken, req.body.code, meta(req)));
});

adminRouter.post("/auth/refresh", async (req, res) => {
  try {
    sendTokens(res, await adminRefresh(req.cookies?.[COOKIE], meta(req)));
  } catch (err) {
    res.clearCookie(COOKIE, cookieBase);
    throw err;
  }
});

adminRouter.post("/auth/logout", async (req, res) => {
  await adminLogout(req.cookies?.[COOKIE]);
  res.clearCookie(COOKIE, cookieBase);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Everything else needs a platform admin
// ---------------------------------------------------------------------------

adminRouter.use(authenticateAdmin);
adminRouter.use((_req, res, next) => {
  // Cross-lab data: never cache it anywhere.
  res.setHeader("Cache-Control", "no-store");
  next();
});
const superAdmin = requireRole("SUPER_ADMIN");

adminRouter.get("/auth/me", (req, res) => {
  const { sessionId: _sid, ...me } = adminOf(req);
  res.json({ admin: me });
});

// Two-step setup and password change work before two-step is on.
adminRouter.post("/auth/mfa/setup", async (req, res) => {
  res.json({ setup: await setupMfa(adminOf(req).id) });
});

adminRouter.post("/auth/mfa/enable", validateBody(mfaCodeSchema), async (req, res) => {
  res.json({ recoveryCodes: await enableMfa(adminOf(req).id, req.body.code, meta(req)) });
});

adminRouter.post("/auth/change-password", validateBody(adminChangePasswordSchema), async (req, res) => {
  const a = adminOf(req);
  await changeAdminPassword(a.id, a.sessionId, req.body.currentPassword, req.body.newPassword, meta(req));
  res.status(204).end();
});

adminRouter.use(requireMfaReady);

adminRouter.get("/overview", async (_req, res) => {
  res.json({ overview: await admin.overview() });
});

adminRouter.get("/labs", async (req, res) => {
  res.json({ labs: await admin.listLabs({ q: str(req.query.q), plan: str(req.query.plan), status: str(req.query.status) }) });
});

adminRouter.get("/labs/:id", async (req, res) => {
  res.json({ lab: await admin.labDetail(idParam(req.params.id)) });
});

adminRouter.put("/labs/:id/subscription", superAdmin, validateBody(updateSubscriptionSchema), async (req, res) => {
  res.json({ lab: await admin.updateSubscription(adminOf(req).id, idParam(req.params.id), req.body, meta(req)) });
});

// Signs the admin in to the lab as its owner: returns a one-time ticket the lab app exchanges for a session.
adminRouter.post("/labs/:id/login", superAdmin, async (req, res) => {
  res.json({ ticket: await admin.createLabLoginTicket(adminOf(req).id, idParam(req.params.id), meta(req)) });
});

adminRouter.get("/labs/:id/access", async (req, res) => {
  res.json({ access: await admin.labAccess(idParam(req.params.id)) });
});

adminRouter.put("/labs/:id/access", superAdmin, validateBody(updateLabAccessSchema), async (req, res) => {
  res.json({ access: await admin.updateLabAccess(adminOf(req).id, idParam(req.params.id), req.body, meta(req)) });
});

adminRouter.get("/users", async (req, res) => {
  const labId = str(req.query.labId);
  res.json({
    users: await admin.listUsers({
      q: str(req.query.q),
      labId: labId && z.uuid().safeParse(labId).success ? labId : undefined,
      role: str(req.query.role),
      status: str(req.query.status),
    }),
  });
});

adminRouter.get("/users/:id", async (req, res) => {
  res.json({ user: await admin.userDetail(idParam(req.params.id)) });
});

adminRouter.post("/users/:id/status", superAdmin, validateBody(adminUserStatusSchema), async (req, res) => {
  res.json({ user: await admin.setUserStatus(adminOf(req).id, idParam(req.params.id), req.body.isActive, req.body.reason, meta(req)) });
});

adminRouter.put("/users/:id/access", superAdmin, validateBody(adminUserAccessSchema), async (req, res) => {
  res.json({ user: await admin.setUserAccess(adminOf(req).id, idParam(req.params.id), req.body, meta(req)) });
});

adminRouter.post("/users/:id/password", superAdmin, validateBody(adminTempPasswordSchema), async (req, res) => {
  res.json({ user: await admin.setUserTempPassword(adminOf(req).id, idParam(req.params.id), req.body.password, req.body.reason, meta(req)) });
});

adminRouter.post("/users/:id/send-reset", superAdmin, validateBody(adminSignOutSchema), async (req, res) => {
  res.json(await admin.sendUserReset(adminOf(req).id, idParam(req.params.id), req.body.reason, meta(req)));
});

adminRouter.post("/users/:id/sign-out", superAdmin, validateBody(adminSignOutSchema), async (req, res) => {
  res.json({ user: await admin.signOutUser(adminOf(req).id, idParam(req.params.id), req.body.reason, meta(req)) });
});

adminRouter.get("/audit", async (req, res) => {
  const labId = str(req.query.labId);
  res.json({ items: await admin.auditItems(labId && z.uuid().safeParse(labId).success ? { tenantId: labId } : {}) });
});

adminRouter.get("/admins", superAdmin, async (_req, res) => {
  res.json({ admins: await admin.listAdmins() });
});

adminRouter.post("/admins", superAdmin, validateBody(createPlatformAdminSchema), async (req, res) => {
  res.status(201).json({ admin: await admin.createAdmin(adminOf(req).id, req.body, meta(req)) });
});

adminRouter.post("/admins/:id/reset-mfa", superAdmin, async (req, res) => {
  await resetMfa(adminOf(req).id, idParam(req.params.id), meta(req));
  res.status(204).end();
});

adminRouter.post("/admins/:id/status", superAdmin, validateBody(z.object({ isActive: z.boolean() })), async (req, res) => {
  res.json({ admin: await admin.setAdminStatus(adminOf(req).id, idParam(req.params.id), req.body.isActive, meta(req)) });
});
