import { Router, type Request } from "express";
import { parseListFilters } from "../../lib/list-filters";
import { addOrderTestsSchema, addPaymentSchema, cancelOrderSchema, createOrderSchema, todayIST, isRealIsoDate } from "@lms/shared";
import { authenticate, ctx, requirePermission } from "../../middleware/auth";
import { resolveBranchId } from "../../middleware/branch";
import { validateBody } from "../../middleware/validate";
import { badRequest, forbidden } from "../../lib/errors";
import * as orders from "./orders.service";

async function actor(req: Request): Promise<orders.Actor> {
  const { auth } = ctx(req);
  return {
    tenantId: auth.tenantId,
    userId: auth.userId,
    branchId: await resolveBranchId(req),
    canDiscount: auth.permissions.includes("billing:discount"),
    canBillAccount: auth.permissions.includes("accounts:read"),
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const intParam = (v: unknown, fallback: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
};
const isoDate = (v: unknown) => {
  const s = str(v);
  if (s && !isRealIsoDate(s)) throw badRequest("Use a date like 2026-10-04");
  return s;
};

export const ordersRouter = Router();
ordersRouter.use(authenticate);

ordersRouter.get("/", requirePermission("orders:read"), async (req, res) => {
  res.json(
    await orders.listOrders(ctx(req).db, {
      q: str(req.query.q),
      date: isoDate(req.query.date),
      dateTo: isoDate(req.query.dateTo),
      patientId: str(req.query.patientId),
      status: str(req.query.status),
      page: intParam(req.query.page, 1, 10_000),
      pageSize: intParam(req.query.pageSize, 25, 100),
      filters: parseListFilters(req.query),
    }),
  );
});

ordersRouter.get("/:id", requirePermission("orders:read"), async (req, res) => {
  res.json({ order: await orders.getOrder(ctx(req).db, String(req.params.id)) });
});

ordersRouter.post(
  "/",
  requirePermission("orders:write", "billing:write"),
  validateBody(createOrderSchema),
  async (req, res) => {
    res.status(201).json({ order: await orders.createOrder(ctx(req).db, await actor(req), req.body) });
  },
);

ordersRouter.post("/:id/tests", requirePermission("orders:write", "billing:write"), validateBody(addOrderTestsSchema), async (req, res) => {
  res.json({ order: await orders.addTests(ctx(req).db, await actor(req), String(req.params.id), req.body.testIds) });
});

ordersRouter.post("/:id/payments", requirePermission("billing:write"), validateBody(addPaymentSchema), async (req, res) => {
  res.json({ order: await orders.addPayments(ctx(req).db, await actor(req), String(req.params.id), req.body.payments) });
});

// Cancelling and refunding is a manager's call: same permission as discounts.
ordersRouter.post("/:id/cancel", requirePermission("billing:discount"), validateBody(cancelOrderSchema), async (req, res) => {
  res.json({ order: await orders.cancelOrder(ctx(req).db, await actor(req), String(req.params.id), req.body) });
});

export const billingRouter = Router();
billingRouter.use(authenticate);

/** Day-end collections for one branch (default: the current branch) or, with branchId=all, every branch. */
billingRouter.get("/collections", requirePermission("billing:read"), async (req, res) => {
  const { auth } = ctx(req);
  const date = isoDate(req.query.date) ?? todayIST();
  const wanted = str(req.query.branchId);
  let branchId: string | null;
  if (wanted === "all") {
    if (auth.branchIds) throw forbidden("You can only see your own branches");
    branchId = null;
  } else if (wanted) {
    if (auth.branchIds && !auth.branchIds.includes(wanted)) throw forbidden("You don't have access to this branch");
    branchId = wanted;
  } else {
    branchId = await resolveBranchId(req);
  }
  const dateTo = isoDate(req.query.dateTo) ?? date;
  res.json({ ...(await orders.collections(ctx(req).db, date, branchId, dateTo)), dateTo });
});
