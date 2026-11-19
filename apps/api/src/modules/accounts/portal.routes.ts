import { Router, type NextFunction, type Request, type Response } from "express";
import { createPatientSchema, isRealIsoDate, portalOrderSchema, todayIST, cancelOrderSchema } from "@lms/shared";
import { z } from "zod";
import { authenticate, ctx, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { badRequest, forbidden, notFound } from "../../lib/errors";
import * as accounts from "./accounts.service";
import * as portal from "./portal.service";
import * as reports from "../reports/reports.service";
import { renderLabelsPdf } from "../samples/labels-pdf";

/** A B2B client's own area. The lab id always comes from the signed-in user's record. */
export const portalRouter = Router();
portalRouter.use(authenticate, requirePermission("b2b:portal"));
portalRouter.use(async (req: Request, res: Response, next: NextFunction) => {
  res.locals.accountId = await portal.resolveAccount(ctx(req).auth.userId);
  next();
});

function me(req: Request, res: Response): portal.PortalActor {
  const { auth } = ctx(req);
  return { tenantId: auth.tenantId, userId: auth.userId, accountId: res.locals.accountId as string, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const idParam = (v: unknown) => {
  const r = z.uuid().safeParse(v);
  if (!r.success) throw notFound();
  return r.data;
};
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
function range(req: Request, days = 30) {
  const to = str(req.query.to) ?? todayIST();
  const from = str(req.query.from) ?? addDays(to, -days);
  if (!isRealIsoDate(from) || !isRealIsoDate(to)) throw badRequest("Use dates like 2026-10-04");
  if (from > to) throw badRequest("The end date is before the start date");
  return { from, to };
}

portalRouter.get("/summary", async (req, res) => {
  res.json({ summary: await portal.summary(ctx(req).db, me(req, res)) });
});

portalRouter.get("/catalog", async (req, res) => {
  res.json({ tests: await portal.catalog(ctx(req).db, me(req, res)) });
});

portalRouter.get("/patients", async (req, res) => {
  res.json({ patients: await portal.searchPatients(ctx(req).db, me(req, res), str(req.query.q) ?? "") });
});

portalRouter.post("/patients", validateBody(createPatientSchema), async (req, res) => {
  res.status(201).json({ patient: await portal.createPatient(ctx(req).db, me(req, res), req.body) });
});

portalRouter.get("/orders", async (req, res) => {
  const { from, to } = range(req);
  res.json({ orders: await portal.listOrders(ctx(req).db, me(req, res), { from, to, q: str(req.query.q) }) });
});

portalRouter.post("/orders", validateBody(portalOrderSchema), async (req, res) => {
  res.status(201).json({ order: await portal.placeOrder(ctx(req).db, me(req, res), req.body) });
});

portalRouter.get("/orders/:id", async (req, res) => {
  res.json({ order: await portal.getOrder(ctx(req).db, me(req, res), idParam(req.params.id)) });
});

portalRouter.post("/orders/:id/cancel", validateBody(cancelOrderSchema), async (req, res) => {
  res.json({ order: await portal.cancel(ctx(req).db, me(req, res), idParam(req.params.id), req.body.reason) });
});

portalRouter.get("/orders/:id/report", async (req, res) => {
  const a = me(req, res);
  const id = idParam(req.params.id);
  const { db } = ctx(req);
  await portal.assertOwnOrder(db, a, id);
  if (await portal.reportsBlocked(db, a.accountId)) throw forbidden("Reports are locked while your balance is below your credit limit. Please add money to your wallet.");
  if ((await reports.status(db, a.tenantId, id)).approvedTests === 0) throw badRequest("No results are approved yet");
  const doctorIds = typeof req.query.doctors === "string" && req.query.doctors ? req.query.doctors.split(",").slice(0, 12) : [];
  const isUuid = (v: string) => z.uuid().safeParse(v).success;
  const template = typeof req.query.template === "string" && req.query.template ? req.query.template : null;
  if (doctorIds.some((d) => !isUuid(d)) || (template && !isUuid(template))) throw badRequest("Unknown option");
  const file = await reports.pdfForStaff(
    db,
    { tenantId: a.tenantId, userId: a.userId, ip: a.ip, userAgent: a.userAgent },
    id,
    { templateId: template, letterhead: req.query.letterhead !== "0", doctorIds, separate: req.query.separate === "1" },
  );
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${file.filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(file.pdf);
});

portalRouter.get("/orders/:id/labels", async (req, res) => {
  const order = await portal.getOrder(ctx(req).db, me(req, res), idParam(req.params.id));
  const seen = new Set<string>();
  const only = typeof req.query.ids === "string" && req.query.ids ? new Set(req.query.ids.split(",")) : null;
  const list = order.samples.filter((s) => s.status !== "CANCELLED" && (!only || only.has(s.id)) && !seen.has(s.barcode) && !!seen.add(s.barcode));
  if (list.length === 0) throw badRequest("This order has no barcodes to print");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="Barcodes-${order.orderNo}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(await renderLabelsPdf(order, list));
});

portalRouter.get("/wallet-history", async (req, res) => {
  const { from, to } = range(req);
  res.json(await accounts.walletHistory(ctx(req).db, { accountId: res.locals.accountId as string, from, to }));
});

portalRouter.get("/ledger", async (req, res) => {
  const { from, to } = range(req);
  res.json({ ledger: await accounts.ledger(ctx(req).db, res.locals.accountId as string, from, to) });
});

portalRouter.get("/invoices", async (req, res) => {
  res.json({ invoices: (await accounts.listInvoices(ctx(req).db, { accountId: res.locals.accountId as string })).filter((i) => i.status !== "VOID") });
});

portalRouter.get("/invoices/:id", async (req, res) => {
  const inv = await accounts.getInvoice(ctx(req).db, idParam(req.params.id), res.locals.accountId as string);
  if (inv.status === "VOID") throw notFound("Invoice not found");
  res.json({ invoice: inv });
});
