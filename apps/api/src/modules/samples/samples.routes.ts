import { Router, type Request } from "express";
import { parseListFilters } from "../../lib/list-filters";
import { editBarcodeSchema, receiveSchema, rejectSampleSchema, SAMPLE_STATUSES, sampleIdsSchema, todayIST, type SampleStatus, isRealIsoDate } from "@lms/shared";
import { authenticate, ctx, requirePermission } from "../../middleware/auth";
import { resolveBranchId } from "../../middleware/branch";
import { validateBody } from "../../middleware/validate";
import { badRequest } from "../../lib/errors";
import * as samples from "./samples.service";
import { getOrder } from "../orders/orders.service";
import { renderLabelsPdf } from "./labels-pdf";

async function actor(req: Request): Promise<samples.Actor> {
  const { auth } = ctx(req);
  return {
    tenantId: auth.tenantId,
    userId: auth.userId,
    branchId: await resolveBranchId(req),
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

export const samplesRouter = Router();
samplesRouter.use(authenticate);

const read = requirePermission("samples:read");
const write = requirePermission("samples:write");

samplesRouter.get("/", read, async (req, res) => {
  const status = String(req.query.status ?? "PENDING") as SampleStatus;
  if (!SAMPLE_STATUSES.includes(status)) throw badRequest("Unknown status");
  const date = typeof req.query.date === "string" && req.query.date ? req.query.date : todayIST();
  if (!isRealIsoDate(date)) throw badRequest("Use a date like 2026-10-04");
  const dateTo = typeof req.query.dateTo === "string" && req.query.dateTo ? req.query.dateTo : date;
  if (!isRealIsoDate(dateTo)) throw badRequest("Use a date like 2026-10-04");
  // "mine" limits collection lists to the current branch; the processing lab leaves it off.
  const branchId = req.query.scope === "branch" ? await resolveBranchId(req) : null;
  res.json(
    await samples.listSamples(ctx(req).db, {
      status,
      date,
      dateTo,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      branchId,
      filters: parseListFilters(req.query),
    }),
  );
});

/** Barcode labels for an order as a PDF, one 50 x 25 mm label per sample (cancelled ones left out). */
samplesRouter.get("/labels/:orderId/pdf", read, async (req, res) => {
  const order = await getOrder(ctx(req).db, String(req.params.orderId));
  const only = typeof req.query.ids === "string" && req.query.ids ? new Set(req.query.ids.split(",")) : null;
  const seen = new Set<string>();
  // Patient wise tubes share a barcode: one label is enough.
  const list = order.samples.filter((s) => s.status !== "CANCELLED" && (!only || only.has(s.id)) && !seen.has(s.barcode) && !!seen.add(s.barcode));
  if (list.length === 0) throw badRequest("This order has no barcodes to print");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="Barcodes-${order.orderNo}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(await renderLabelsPdf(order, list));
});

samplesRouter.get("/barcode/:barcode", read, async (req, res) => {
  res.json({ sample: await samples.sampleByBarcode(ctx(req).db, String(req.params.barcode)) });
});

samplesRouter.post("/collect", write, validateBody(sampleIdsSchema), async (req, res) => {
  res.json({ samples: await samples.collectSamples(ctx(req).db, await actor(req), req.body.sampleIds) });
});

samplesRouter.post("/receive", write, validateBody(receiveSchema), async (req, res) => {
  res.json(await samples.receiveSamples(ctx(req).db, await actor(req), req.body));
});

samplesRouter.put("/:id/barcode", write, validateBody(editBarcodeSchema), async (req, res) => {
  res.json({ sample: await samples.editBarcode(ctx(req).db, await actor(req), String(req.params.id), req.body.barcode) });
});

samplesRouter.post("/:id/reject", write, validateBody(rejectSampleSchema), async (req, res) => {
  res.json(await samples.rejectSample(ctx(req).db, await actor(req), String(req.params.id), req.body));
});
