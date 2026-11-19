import { Router, type CookieOptions, type Request, type Response } from "express";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  type AuthResponse,
} from "@lms/shared";
import { z } from "zod";
import { cookieSecure } from "../../config/env";
import { validateBody } from "../../middleware/validate";
import { authenticate, ctx } from "../../middleware/auth";
import * as auth from "./auth.service";

export const REFRESH_COOKIE = "lms_rt";

const cookieBase: CookieOptions = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite: "lax",
  // Only sent to the auth endpoints, never to the rest of the API.
  path: "/api/auth",
};

function meta(req: Request): auth.RequestMeta {
  return { ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

function sendTokens(res: Response, tokens: auth.IssuedTokens, status = 200) {
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...cookieBase, expires: tokens.refreshExpiresAt });
  const body: AuthResponse = {
    accessToken: tokens.accessToken,
    expiresIn: tokens.expiresIn,
    user: tokens.user,
  };
  res.status(status).json(body);
}

export const authRouter = Router();

authRouter.post("/signup", validateBody(signupSchema), async (req, res) => {
  sendTokens(res, await auth.signup(req.body, meta(req)), 201);
});

authRouter.post("/login", validateBody(loginSchema), async (req, res) => {
  sendTokens(res, await auth.login(req.body, meta(req)));
});

authRouter.post("/ticket", validateBody(z.object({ ticket: z.string().min(20).max(100) })), async (req, res) => {
  sendTokens(res, await auth.loginWithTicket(req.body.ticket, meta(req)));
});

authRouter.post("/refresh", async (req, res) => {
  try {
    sendTokens(res, await auth.refresh(req.cookies?.[REFRESH_COOKIE], meta(req)));
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, cookieBase);
    throw err;
  }
});

authRouter.post("/logout", async (req, res) => {
  await auth.logout(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, cookieBase);
  res.status(204).end();
});

authRouter.get("/me", authenticate, async (req, res) => {
  res.json({ user: await auth.buildSessionUser(ctx(req).auth.userId) });
});

authRouter.get("/sessions", authenticate, async (req, res) => {
  const { auth: a } = ctx(req);
  res.json({ sessions: await auth.listSessions(a.userId, a.sessionId) });
});

authRouter.delete("/sessions/:id", authenticate, async (req, res) => {
  await auth.revokeOwnSession(ctx(req).auth.userId, String(req.params.id));
  res.status(204).end();
});

// Always 204, whether or not the email has an account.
authRouter.post("/forgot-password", validateBody(forgotPasswordSchema), async (req, res) => {
  await auth.forgotPassword(req.body.email, meta(req));
  res.status(204).end();
});

authRouter.post("/reset-password", validateBody(resetPasswordSchema), async (req, res) => {
  await auth.resetPassword(req.body.token, req.body.password, meta(req));
  res.clearCookie(REFRESH_COOKIE, cookieBase);
  res.status(204).end();
});

authRouter.post("/change-password", authenticate, validateBody(changePasswordSchema), async (req, res) => {
  const { auth: a } = ctx(req);
  await auth.changePassword(a.userId, a.sessionId, req.body, meta(req));
  res.json({ user: await auth.buildSessionUser(a.userId) });
});
