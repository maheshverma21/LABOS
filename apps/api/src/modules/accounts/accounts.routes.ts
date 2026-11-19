import { Router, type Request } from "express";
import {
  accountLoginSchema,
  accountPriceListSchema,
  accountSchema,
  accountStatusSchema,
  bulkAccountsSchema,
  bulkPriceSchema,
  createInvoiceSchema,
  isRealIsoDate,
  noteSchema,
  todayIST,
  topUpSchema,
  voidInvoiceSchema,
  setTemporaryPasswordSchema,
  type WalletTxnKind,
} from "@lms/shared";
import { z } from "zod";
import { authenticate, ctx, requirePermission } from "../../middleware/auth";
import { resolveBranchId } from "../../middleware/branch";
import { validateBody } from "../../middleware/validate";
import { badRequest, notFound } from "../../lib/errors";
import * as accounts from "./accounts.service";

async function actor(req: Request): Promise<accounts.Actor> {
  const { auth } = ctx(req);
  return {
    tenantId: auth.tenantId,
    userId: auth.userId,
    branchId: await resolveBranchId(req),
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

const idParam = (v: unknown) => {
  const r = z.uuid().safeParse(v);
  if (!r.success) throw notFound();
  return r.data;
};
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const optId = (v: unknown) => {
  const s = str(v);
  return s && z.uuid().safeParse(s).success ? s : undefined;
};
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** ?from=&to= as real dates; a month back to today when absent. */
function range(req: Request, defaultDays = 30) {
  const to = str(req.query.to) ?? todayIST();
  const from = str(req.query.from) ?? addDays(to, -defaultDays);
  if (!isRealIsoDate(from) || !isRealIsoDate(to)) throw badRequest("Use dates like 2026-10-04");
  if (from > to) throw badRequest("The end date is before the start date");
  return { from, to };
}

const KINDS = ["OPENING", "TOPUP", "ORDER", "REFUND", "CREDIT_NOTE", "DEBIT_NOTE"] as const;

const read = requirePermission("accounts:read");
const write = requirePermission("accounts:write");

export const accountsRouter = Router();
accountsRouter.use(authenticate);

accountsRouter.get("/", read, async (req, res) => {
  res.json({ accounts: await accounts.listAccounts(ctx(req).db, { q: str(req.query.q), includeInactive: req.query.all === "1" }) });
});

accountsRouter.post("/", write, validateBody(accountSchema), async (req, res) => {
  res.status(201).json({ account: await accounts.createAccount(ctx(req).db, await actor(req), req.body) });
});

accountsRouter.post("/bulk", write, validateBody(bulkAccountsSchema), async (req, res) => {
  res.json(await accounts.bulkCreate(ctx(req).db, await actor(req), req.body.rows));
});

accountsRouter.post("/bulk-price", write, validateBody(bulkPriceSchema), async (req, res) => {
  res.json(await accounts.bulkPrice(ctx(req).db, await actor(req), req.body));
});

accountsRouter.post("/top-up", write, validateBody(topUpSchema), async (req, res) => {
  res.status(201).json({ account: await accounts.topUp(ctx(req).db, await actor(req), req.body) });
});

accountsRouter.get("/wallet-history", read, async (req, res) => {
  const { from, to } = range(req);
  const kind = str(req.query.kind) as WalletTxnKind | undefined;
  if (kind && !KINDS.includes(kind)) throw badRequest("Unknown entry type");
  res.json(await accounts.walletHistory(ctx(req).db, { accountId: optId(req.query.accountId), from, to, kind }));
});

accountsRouter.get("/ledger", read, async (req, res) => {
  const { from, to } = range(req);
  const accountId = optId(req.query.accountId);
  if (!accountId) throw badRequest("Pick a lab");
  res.json({ ledger: await accounts.ledger(ctx(req).db, accountId, from, to) });
});

accountsRouter.get("/balances/days", read, async (req, res) => {
  const { from, to } = range(req, 29);
  res.json({ days: await accounts.dayBalances(ctx(req).db, from, to) });
});

accountsRouter.get("/balances/labs", read, async (req, res) => {
  const { from, to } = range(req);
  res.json({ labs: await accounts.labBalances(ctx(req).db, from, to) });
});

accountsRouter.get("/notes", read, async (req, res) => {
  const { from, to } = range(req, 90);
  res.json({ notes: await accounts.listNotes(ctx(req).db, { accountId: optId(req.query.accountId), from, to }) });
});

accountsRouter.post("/notes", write, validateBody(noteSchema), async (req, res) => {
  res.status(201).json({ note: await accounts.createNote(ctx(req).db, await actor(req), req.body) });
});

accountsRouter.get("/:id", read, async (req, res) => {
  res.json({ account: await accounts.getAccount(ctx(req).db, idParam(req.params.id)) });
});

accountsRouter.put("/:id", write, validateBody(accountSchema), async (req, res) => {
  res.json({ account: await accounts.updateAccount(ctx(req).db, await actor(req), idParam(req.params.id), req.body) });
});

accountsRouter.delete("/:id", write, async (req, res) => {
  await accounts.deleteAccount(ctx(req).db, await actor(req), idParam(req.params.id));
  res.status(204).end();
});

accountsRouter.post("/:id/status", write, validateBody(accountStatusSchema), async (req, res) => {
  res.json({ account: await accounts.setAccountStatus(ctx(req).db, await actor(req), idParam(req.params.id), req.body.isActive) });
});

accountsRouter.get("/:id/price-list", read, async (req, res) => {
  res.json({ priceList: await accounts.getAccountPriceList(ctx(req).db, idParam(req.params.id)) });
});

accountsRouter.put("/:id/price-list", write, validateBody(accountPriceListSchema), async (req, res) => {
  res.json({ priceList: await accounts.saveAccountPriceList(ctx(req).db, await actor(req), idParam(req.params.id), req.body.items) });
});

accountsRouter.post("/:id/logins", write, validateBody(accountLoginSchema), async (req, res) => {
  res.status(201).json({ account: await accounts.addLogin(ctx(req).db, await actor(req), idParam(req.params.id), req.body) });
});

accountsRouter.patch(
  "/:id/logins/:userId",
  write,
  validateBody(z.object({ isActive: z.boolean().optional(), password: setTemporaryPasswordSchema.shape.password.optional() })),
  async (req, res) => {
    res.json({ account: await accounts.updateLogin(ctx(req).db, await actor(req), idParam(req.params.id), idParam(req.params.userId), req.body) });
  },
);

accountsRouter.post("/:id/invoices", write, validateBody(createInvoiceSchema), async (req, res) => {
  res.status(201).json({ invoice: await accounts.createInvoice(ctx(req).db, await actor(req), idParam(req.params.id), req.body) });
});

export const invoicesRouter = Router();
invoicesRouter.use(authenticate);

invoicesRouter.get("/", read, async (req, res) => {
  res.json({ invoices: await accounts.listInvoices(ctx(req).db, { status: str(req.query.status), accountId: optId(req.query.accountId) }) });
});

invoicesRouter.get("/:id", read, async (req, res) => {
  res.json({ invoice: await accounts.getInvoice(ctx(req).db, idParam(req.params.id)) });
});

invoicesRouter.post("/:id/void", write, validateBody(voidInvoiceSchema), async (req, res) => {
  res.json({ invoice: await accounts.voidInvoice(ctx(req).db, await actor(req), idParam(req.params.id), req.body.reason) });
});
