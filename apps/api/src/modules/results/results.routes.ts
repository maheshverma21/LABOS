import express, { Router, type Request } from "express";
import { parseListFilters } from "../../lib/list-filters";
import { approveSchema, outsourceFileSchema, reopenSchema, saveResultsSchema, sendBackSchema, todayIST, isRealIsoDate } from "@lms/shared";
import { authenticate, ctx, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { badRequest } from "../../lib/errors";
import * as results from "./results.service";

function actor(req: Request): results.Actor {
  const { auth } = ctx(req);
  return { tenantId: auth.tenantId, userId: auth.userId, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

export const resultsRouter = Router();
resultsRouter.use(authenticate);

const read = requirePermission("results:read");
const write = requirePermission("results:write");
const approve = requirePermission("results:approve");

resultsRouter.get("/worklist", read, async (req, res) => {
  const tab = String(req.query.tab ?? "enter");
  if (tab !== "enter" && tab !== "approve" && tab !== "approved") throw badRequest("Unknown worklist");
  const date = typeof req.query.date === "string" && req.query.date ? req.query.date : todayIST();
  if (!isRealIsoDate(date)) throw badRequest("Use a date like 2026-10-04");
  const dateTo = typeof req.query.dateTo === "string" && req.query.dateTo ? req.query.dateTo : date;
  if (!isRealIsoDate(dateTo)) throw badRequest("Use a date like 2026-10-04");
  res.json({
    orders: await results.worklist(ctx(req).db, {
      tab,
      date,
      dateTo,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      department: typeof req.query.department === "string" && req.query.department ? req.query.department : undefined,
      filters: parseListFilters(req.query),
    }),
  });
});

resultsRouter.get("/orders/:orderId", read, async (req, res) => {
  res.json({ sheet: await results.getSheet(ctx(req).db, String(req.params.orderId)) });
});

resultsRouter.put("/tests/:id", write, validateBody(saveResultsSchema), async (req, res) => {
  res.json({ sheet: await results.saveResults(ctx(req).db, actor(req), String(req.params.id), req.body) });
});

resultsRouter.post("/approve", approve, validateBody(approveSchema), async (req, res) => {
  const orderIds = await results.approve(ctx(req).db, actor(req), req.body.orderTestIds);
  res.json({ approved: req.body.orderTestIds.length, orderIds });
});

resultsRouter.post("/tests/:id/send-back", approve, validateBody(sendBackSchema), async (req, res) => {
  const orderId = await results.sendBack(ctx(req).db, actor(req), String(req.params.id), req.body.note);
  res.json({ sheet: await results.getSheet(ctx(req).db, orderId) });
});

resultsRouter.post("/tests/:id/reopen", approve, validateBody(reopenSchema), async (req, res) => {
  const orderId = await results.reopen(ctx(req).db, actor(req), String(req.params.id), req.body.reason);
  res.json({ sheet: await results.getSheet(ctx(req).db, orderId) });
});

/** The report file from an outsourced lab arrives as the raw body (PDF, PNG or JPEG); ?name= is its file name. */
const rawFile = express.raw({ type: ["application/pdf", "image/png", "image/jpeg"], limit: "6mb" });

resultsRouter.put("/tests/:id/outsource-file", write, rawFile, async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name : "report";
  const orderId = await results.saveOutsourceFile(ctx(req).db, actor(req), String(req.params.id), name, req.body, req.query.letterhead === "1");
  res.json({ sheet: await results.getSheet(ctx(req).db, orderId) });
});

resultsRouter.patch("/tests/:id/outsource-file", write, validateBody(outsourceFileSchema), async (req, res) => {
  const orderId = await results.setOutsourceLetterhead(ctx(req).db, actor(req), String(req.params.id), req.body.addLetterhead);
  res.json({ sheet: await results.getSheet(ctx(req).db, orderId) });
});

resultsRouter.delete("/tests/:id/outsource-file", write, async (req, res) => {
  const orderId = await results.removeOutsourceFile(ctx(req).db, actor(req), String(req.params.id));
  res.json({ sheet: await results.getSheet(ctx(req).db, orderId) });
});

resultsRouter.get("/tests/:id/outsource-file", read, async (req, res) => {
  const f = await results.readOutsourceFile(ctx(req).db, String(req.params.id));
  res.setHeader("Content-Type", f.mime);
  res.setHeader("Content-Disposition", `inline; filename="${f.name.replace(/"/g, "")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(Buffer.from(f.data));
});
