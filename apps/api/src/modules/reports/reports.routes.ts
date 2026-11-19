import { Router, type Request, type Response } from "express";
import { REPORT_STATES, REPORT_HEADER_FIELDS, reportHeaderSettingsSchema, handOverSchema, sendReportSchema, todayIST, whatsappSettingsSchema, isRealIsoDate, type ReportState } from "@lms/shared";
import type { z } from "zod";
import type { Prisma } from "@prisma/client";
import { authenticate, ctx, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { badRequest } from "../../lib/errors";
import { parseListFilters } from "../../lib/list-filters";

const REPORT_HEADER_KEYS = new Set<string>(REPORT_HEADER_FIELDS.map((f) => f.key));
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
import { prisma } from "../../lib/prisma";
import { audit } from "../../lib/audit";
import { rateLimit } from "../../lib/rate-limit";
import { encryptSecret } from "../../lib/secrets";
import * as reports from "./reports.service";
import { readReportHeader, writeReportHeader } from "./report-header";
import { readStored, toPublic, type StoredWhatsapp } from "./whatsapp";

function actor(req: Request): reports.Actor {
  const { auth } = ctx(req);
  return { tenantId: auth.tenantId, userId: auth.userId, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

function sendPdf(res: Response, file: { pdf: Buffer; filename: string }, cache: string) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${file.filename}"`);
  res.setHeader("Cache-Control", cache);
  res.send(file.pdf);
}

export const reportsRouter = Router();
reportsRouter.use(authenticate);

const read = requirePermission("reports:read");
const deliver = requirePermission("reports:deliver");

reportsRouter.get("/", read, async (req, res) => {
  const date = typeof req.query.date === "string" && req.query.date ? req.query.date : todayIST();
  if (!isRealIsoDate(date)) throw badRequest("Use a date like 2026-10-04");
  const dateTo = typeof req.query.dateTo === "string" && req.query.dateTo ? req.query.dateTo : date;
  if (!isRealIsoDate(dateTo)) throw badRequest("Use a date like 2026-10-04");
  const state = typeof req.query.state === "string" && req.query.state ? (req.query.state.toUpperCase() as ReportState) : undefined;
  if (state && !REPORT_STATES.includes(state)) throw badRequest("Unknown report state");
  res.json({
    reports: await reports.list(ctx(req).db, {
      date,
      dateTo,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      state,
      filters: parseListFilters(req.query),
    }),
  });
});

// WhatsApp settings: anyone who can see reports can see whether it's set up; changing it is a settings job.
reportsRouter.get("/whatsapp-settings", read, async (req, res) => {
  res.json({ settings: toPublic((await readStored(ctx(req).auth.tenantId)).whatsapp) });
});

reportsRouter.put(
  "/whatsapp-settings",
  requirePermission("settings:write"),
  validateBody(whatsappSettingsSchema),
  async (req, res) => {
    const { tenantId } = ctx(req).auth;
    const input = req.body as z.output<typeof whatsappSettingsSchema>;
    const { all, whatsapp: before } = await readStored(tenantId);
    const next: StoredWhatsapp = {
      enabled: input.enabled,
      provider: input.provider,
      campaignName: input.campaignName,
      apiKeyEnc: input.apiKey ? encryptSecret(input.apiKey) : (before.apiKeyEnc ?? null),
      apiKeyHint: input.apiKey ? input.apiKey.slice(-4) : (before.apiKeyHint ?? null),
    };
    if (next.enabled && next.provider === "own" && !next.apiKeyEnc) {
      throw badRequest("Enter your AiSensy API key", { apiKey: ["Enter your AiSensy API key"] });
    }
    await prisma.tenant.update({ where: { id: tenantId }, data: { settings: { ...all, whatsapp: { ...next } } as Prisma.InputJsonObject } });
    const a = actor(req);
    await audit({
      tenantId,
      actorId: a.userId,
      ip: a.ip,
      userAgent: a.userAgent,
      action: "settings.whatsapp",
      entityType: "tenant",
      entityId: tenantId,
      before: { ...toPublic(before) },
      after: { ...toPublic(next), apiKeyChanged: !!input.apiKey },
    });
    res.json({ settings: toPublic(next) });
  },
);

// Report settings: the patient and order details printed at the top of every report. Front desk sets these from the registration page.
reportsRouter.get("/header-settings", read, async (req, res) => {
  res.json({ settings: await readReportHeader(ctx(req).auth.tenantId) });
});

reportsRouter.put("/header-settings", requirePermission("orders:write"), validateBody(reportHeaderSettingsSchema), async (req, res) => {
  const { tenantId } = ctx(req).auth;
  const input = req.body as z.output<typeof reportHeaderSettingsSchema>;
  const labels = Object.fromEntries(Object.entries(input.labels).filter(([k, v]) => v && REPORT_HEADER_KEYS.has(k)));
  const next = { fields: input.fields, labels };
  const before = await readReportHeader(tenantId);
  await writeReportHeader(tenantId, next);
  const a = actor(req);
  await audit({ tenantId, actorId: a.userId, ip: a.ip, userAgent: a.userAgent, action: "settings.report_header", entityType: "tenant", entityId: tenantId, before: { ...before }, after: next });
  res.json({ settings: next });
});

reportsRouter.get("/:orderId", read, async (req, res) => {
  res.json({ report: await reports.status(ctx(req).db, ctx(req).auth.tenantId, String(req.params.orderId)) });
});

reportsRouter.get("/:orderId/pdf", read, async (req, res) => {
  const template = typeof req.query.template === "string" && req.query.template ? req.query.template : null;
  if (template && !isUuid(template)) throw badRequest("Unknown template");
  const letterhead = req.query.letterhead !== "0";
  const doctorIds = typeof req.query.doctors === "string" && req.query.doctors ? req.query.doctors.split(",").slice(0, 12) : [];
  if (doctorIds.some((id) => !isUuid(id))) throw badRequest("Unknown doctor");
  sendPdf(res, await reports.pdfForStaff(ctx(req).db, actor(req), String(req.params.orderId), { templateId: template, letterhead, outsource: req.query.outsource === "1", doctorIds, separate: req.query.separate === "1" }), "private, no-store");
});

reportsRouter.post("/:orderId/link", deliver, async (req, res) => {
  res.json(await reports.shareLink(ctx(req).db, actor(req), String(req.params.orderId)));
});

reportsRouter.post("/:orderId/handed-over", deliver, validateBody(handOverSchema), async (req, res) => {
  const input = req.body as z.output<typeof handOverSchema>;
  res.status(201).json({ delivery: await reports.handOver(ctx(req).db, actor(req), String(req.params.orderId), input.to) });
});

reportsRouter.post("/:orderId/send", deliver, validateBody(sendReportSchema), async (req, res) => {
  const input = req.body as z.output<typeof sendReportSchema>;
  // A lab can't burn through its WhatsApp quota by double-clicking.
  await rateLimit(`report-send:${req.params.orderId}`, 5, 60);
  res.json({ delivery: await reports.sendWhatsapp(ctx(req).db, actor(req), String(req.params.orderId), input.to) });
});

// ---------------------------------------------------------------------------
// Public: patients open their report from the link. No sign-in.
// ---------------------------------------------------------------------------

export const publicReportsRouter = Router();

publicReportsRouter.use(async (req, _res, next) => {
  await rateLimit(`public-report:${req.ip}`, 60, 60);
  next();
});

publicReportsRouter.get("/:token/info", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ report: await reports.publicInfo(String(req.params.token)) });
});

publicReportsRouter.get("/:token/pdf", async (req, res) => {
  sendPdf(res, await reports.publicPdf(String(req.params.token)), "private, no-store");
});
