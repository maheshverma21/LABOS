import type { Prisma } from "@prisma/client";
import {
  accountSchema,
  B2B_ROLE,
  DEFAULT_TEMPLATE,
  labSettingsSchema,
  type LabLetterhead,
  financialYear,
  todayIST,
  toIsoDate,
  type AccountDetail,
  type AccountListItem,
  type AccountNoteItem,
  type AccountOrderItem,
  type BulkAccountsResult,
  type DayBalanceRow,
  type InvoiceDetail,
  type InvoiceListItem,
  type LabBalanceRow,
  type LedgerResponse,
  type PriceListDetail,
  type WalletHistoryPage,
  type WalletTxnItem,
  type WalletTxnKind,
  accountLoginSchema,
  bulkPriceSchema,
  noteSchema,
  topUpSchema,
} from "@lms/shared";
import type { z } from "zod";
import { prisma } from "../../lib/prisma";
import type { TenantDb } from "../../lib/tenant-db";
import { audit } from "../../lib/audit";
import { nextNumber } from "../../lib/counter";
import { hashPassword } from "../../lib/password";
import { invalidateAccess } from "../../lib/access";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { revokeAllSessions } from "../auth/auth.service";
import { move, type Tx } from "./wallet.service";

export { assertCredit } from "./wallet.service";

export interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
  ip: string | null;
  userAgent: string | null;
}

const auditMeta = (a: Actor) => ({ tenantId: a.tenantId, actorId: a.userId, ip: a.ip, userAgent: a.userAgent });
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const DAY = 86_400_000;
const IST_MS = 5.5 * 3600_000;
const formatInvoiceNo = (fy: string, n: number) => `INV/${fy}/${String(n).padStart(6, "0")}`;
/** The IST calendar day, as 2026-11-05, for an instant. */
const istDate = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const istRange = (from: string, to: string) => ({
  gte: new Date(`${from}T00:00:00+05:30`),
  lt: new Date(new Date(`${to}T00:00:00+05:30`).getTime() + DAY),
});

// ---------------------------------------------------------------------------
// Labs
// ---------------------------------------------------------------------------

const accountSelect = {
  id: true,
  code: true,
  name: true,
  type: true,
  contactName: true,
  phone: true,
  email: true,
  priceListId: true,
  creditLimitPaise: true,
  discountPercent: true,
  walletPaise: true,
  holdPaise: true,
  isActive: true,
  _count: { select: { users: true } },
} as const;

type AccountRow = Prisma.AccountGetPayload<{ select: typeof accountSelect }>;

async function toListItems(db: TenantDb, rows: AccountRow[]): Promise<AccountListItem[]> {
  const ids = rows.map((r) => r.priceListId).filter((x): x is string => !!x);
  const lists = ids.length ? await db.priceList.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  return rows.map(({ priceListId, _count, ...r }) => ({
    ...r,
    netPaise: r.walletPaise - r.holdPaise,
    priceList: lists.find((l) => l.id === priceListId) ?? null,
    loginCount: _count.users,
  }));
}

export async function listAccounts(db: TenantDb, f: { q?: string; includeInactive?: boolean }): Promise<AccountListItem[]> {
  const q = f.q?.trim();
  const rows = await db.account.findMany({
    where: {
      ...(f.includeInactive ? {} : { isActive: true }),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { name: "asc" },
    select: accountSelect,
  });
  return toListItems(db, rows);
}

export async function getAccount(db: TenantDb, id: string): Promise<AccountDetail> {
  const row = await db.account.findFirst({ where: { id }, select: { ...accountSelect, address: true, gstin: true, notes: true, city: true, settings: true } });
  if (!row) throw notFound("Lab not found");
  const [[item], logins] = await Promise.all([
    toListItems(db, [row]),
    db.user.findMany({
      where: { accountId: id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true },
    }),
  ]);
  const tpl = await db.reportTemplate.findFirst({ where: { accountId: id }, select: { backgroundImageId: true, headerHeightMm: true, footerHeightMm: true, leftMarginMm: true, rightMarginMm: true } });
  const letterhead: LabLetterhead = tpl
    ? { enabled: true, backgroundAssetId: tpl.backgroundImageId, headerHeightMm: tpl.headerHeightMm, footerHeightMm: tpl.footerHeightMm, leftMarginMm: tpl.leftMarginMm, rightMarginMm: tpl.rightMarginMm }
    : { enabled: false, backgroundAssetId: null, headerHeightMm: 35, footerHeightMm: 20, leftMarginMm: 11, rightMarginMm: 11 };
  return {
    ...item!,
    city: row.city,
    settings: labSettingsSchema.parse(row.settings ?? {}),
    letterhead,
    address: row.address,
    gstin: row.gstin,
    notes: row.notes,
    logins: logins.map((l) => ({ ...l, lastLoginAt: l.lastLoginAt?.toISOString() ?? null })),
  };
}

type AccountInputOut = z.output<typeof accountSchema>;

export async function createAccount(db: TenantDb, actor: Actor, input: AccountInputOut) {
  if (await db.account.findFirst({ where: { code: input.code }, select: { id: true } })) {
    throw conflict("Another lab uses this code", { code: ["Another lab uses this code"] });
  }
  const { letterhead, ...data } = input;
  await checkLetterhead(db, letterhead);
  const a = await db.account.create({ data: { tenantId: actor.tenantId, ...data }, select: { id: true } });
  await syncLetterhead(db, actor, a.id, input.name, letterhead);
  await audit({ ...auditMeta(actor), action: "account.create", entityType: "account", entityId: a.id, after: data });
  return getAccount(db, a.id);
}

export async function updateAccount(db: TenantDb, actor: Actor, id: string, input: AccountInputOut) {
  const before = await db.account.findFirst({ where: { id } });
  if (!before) throw notFound("Lab not found");
  if (await db.account.findFirst({ where: { code: input.code, id: { not: id } }, select: { id: true } })) {
    throw conflict("Another lab uses this code", { code: ["Another lab uses this code"] });
  }
  const { letterhead, ...data } = input;
  await checkLetterhead(db, letterhead);
  await db.account.update({ where: { id }, data });
  await syncLetterhead(db, actor, id, input.name, letterhead);
  await audit({
    ...auditMeta(actor),
    action: "account.update",
    entityType: "account",
    entityId: id,
    before: { ...before, createdAt: undefined, updatedAt: undefined } as unknown as Prisma.InputJsonValue,
    after: data,
  });
  return getAccount(db, id);
}

/** A lab's own letterhead needs its background image, and the image must be this lab's. */
async function checkLetterhead(db: TenantDb, l: LabLetterhead) {
  if (!l.enabled) return;
  if (!l.backgroundAssetId) throw badRequest("Upload the letterhead image", { "letterhead.backgroundAssetId": ["Upload the letterhead image"] });
  if (!(await db.labAsset.findFirst({ where: { id: l.backgroundAssetId, kind: "BACKGROUND" }, select: { id: true } }))) {
    throw badRequest("Upload the letterhead image again", { "letterhead.backgroundAssetId": ["Upload the letterhead image again"] });
  }
}

/** Keeps the lab's own report template in step with its letterhead settings: made when switched on, removed when off. */
async function syncLetterhead(db: TenantDb, actor: Actor, accountId: string, name: string, l: LabLetterhead) {
  const existing = await db.reportTemplate.findFirst({ where: { accountId }, select: { id: true } });
  if (!l.enabled) {
    if (existing) await db.reportTemplate.delete({ where: { id: existing.id } });
    return;
  }
  const values = {
    name: `B2B letterhead: ${name}`.slice(0, 60),
    style: "PREPRINTED" as const,
    backgroundImageId: l.backgroundAssetId,
    headerHeightMm: l.headerHeightMm,
    footerHeightMm: l.footerHeightMm,
    leftMarginMm: l.leftMarginMm,
    rightMarginMm: l.rightMarginMm,
  };
  if (existing) await db.reportTemplate.update({ where: { id: existing.id }, data: values });
  else await db.reportTemplate.create({ data: { ...DEFAULT_TEMPLATE, ...values, tenantId: actor.tenantId, accountId, isDefault: false } });
}

export async function setAccountStatus(db: TenantDb, actor: Actor, id: string, isActive: boolean) {
  const a = await db.account.findFirst({ where: { id }, select: { id: true } });
  if (!a) throw notFound("Lab not found");
  await db.account.update({ where: { id }, data: { isActive } });
  if (!isActive) {
    // A deactivated lab's people are signed out straight away.
    const users = await db.user.findMany({ where: { accountId: id }, select: { id: true } });
    await Promise.all(users.map((u) => revokeAllSessions(u.id, "lab_deactivated")));
  }
  await audit({ ...auditMeta(actor), action: isActive ? "account.enable" : "account.disable", entityType: "account", entityId: id });
  return getAccount(db, id);
}

/** Removes a lab that has never been used. One with orders or wallet history is deactivated instead. */
export async function deleteAccount(db: TenantDb, actor: Actor, id: string) {
  const a = await db.account.findFirst({ where: { id }, select: { id: true, name: true, priceListId: true } });
  if (!a) throw notFound("Lab not found");
  const [orders, txns, invoices] = await Promise.all([
    db.order.count({ where: { accountId: id } }),
    db.walletTxn.count({ where: { accountId: id } }),
    db.invoice.count({ where: { accountId: id } }),
  ]);
  if (orders || txns || invoices) {
    throw conflict(`${a.name} has orders or wallet history, so it can't be deleted. Switch it off instead.`);
  }
  const users = await db.user.findMany({ where: { accountId: id }, select: { id: true } });
  await prisma.$transaction(async (tx) => {
    await tx.patient.updateMany({ where: { accountId: id }, data: { accountId: null } });
    await tx.user.deleteMany({ where: { accountId: id, tenantId: actor.tenantId } });
    await tx.accountPayment.deleteMany({ where: { accountId: id, tenantId: actor.tenantId } });
    await tx.accountNote.deleteMany({ where: { accountId: id, tenantId: actor.tenantId } });
    await tx.reportTemplate.deleteMany({ where: { accountId: id, tenantId: actor.tenantId } });
    await tx.account.delete({ where: { id } });
    // The lab's own rates go with it.
    if (a.priceListId && !(await tx.doctor.count({ where: { priceListId: a.priceListId } })) && !(await tx.order.count({ where: { priceListId: a.priceListId } }))) {
      await tx.priceList.delete({ where: { id: a.priceListId } });
    }
    await audit({ ...auditMeta(actor), action: "account.delete", entityType: "account", entityId: id, before: { name: a.name } }, tx);
  });
  await Promise.all(users.map((u) => invalidateAccess(u.id)));
}

/** Bulk upload: each row is checked on its own, so one bad row doesn't stop the rest. */
export async function bulkCreate(db: TenantDb, actor: Actor, rows: unknown[]): Promise<BulkAccountsResult> {
  const result: BulkAccountsResult = { created: 0, errors: [] };
  const seen = new Set<string>();
  for (const [i, raw] of rows.entries()) {
    const parsed = accountSchema.safeParse(raw);
    if (!parsed.success) {
      result.errors.push({ row: i + 1, message: parsed.error.issues.map((x) => `${x.path.join(".") || "row"}: ${x.message}`).join("; ") });
      continue;
    }
    if (seen.has(parsed.data.code)) {
      result.errors.push({ row: i + 1, message: `code ${parsed.data.code} appears twice in the file` });
      continue;
    }
    seen.add(parsed.data.code);
    try {
      await createAccount(db, actor, parsed.data);
      result.created++;
    } catch (err) {
      result.errors.push({ row: i + 1, message: err instanceof Error ? err.message : "Couldn't create" });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Portal logins
// ---------------------------------------------------------------------------

async function b2bRoleId(tenantId: string) {
  const role = await prisma.role.upsert({
    where: { tenantId_key: { tenantId, key: B2B_ROLE.key } },
    create: { tenantId, key: B2B_ROLE.key, name: B2B_ROLE.name, permissions: [...B2B_ROLE.permissions], isSystem: true },
    update: {},
    select: { id: true },
  });
  return role.id;
}

export async function addLogin(db: TenantDb, actor: Actor, accountId: string, input: z.output<typeof accountLoginSchema>) {
  const account = await db.account.findFirst({ where: { id: accountId }, select: { id: true, name: true } });
  if (!account) throw notFound("Lab not found");
  if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
    throw conflict("This email is already in use", { email: ["This email is already in use"] });
  }
  const roleId = await b2bRoleId(actor.tenantId);
  const passwordHash = await hashPassword(input.password);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      // They set their own password at first sign-in.
      data: { tenantId: actor.tenantId, accountId, name: input.name, email: input.email, passwordHash, mustChangePassword: true },
      select: { id: true },
    });
    await tx.userRole.create({ data: { tenantId: actor.tenantId, userId: u.id, roleId, branchId: null } });
    await audit({ ...auditMeta(actor), action: "account.login_add", entityType: "account", entityId: accountId, after: { email: input.email } }, tx);
    return u;
  });
  void user;
  return getAccount(db, accountId);
}

export async function updateLogin(
  db: TenantDb,
  actor: Actor,
  accountId: string,
  userId: string,
  input: { isActive?: boolean; password?: string },
) {
  const user = await db.user.findFirst({ where: { id: userId, accountId }, select: { id: true, email: true } });
  if (!user) throw notFound("Login not found");
  if (input.password) {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(input.password), mustChangePassword: true, passwordChangedAt: new Date() } });
    await revokeAllSessions(userId, "temporary_password_set");
  }
  if (input.isActive !== undefined) {
    await prisma.user.update({ where: { id: userId }, data: { isActive: input.isActive } });
    if (!input.isActive) await revokeAllSessions(userId, "login_disabled");
    await invalidateAccess(userId);
  }
  await audit({
    ...auditMeta(actor),
    action: "account.login_update",
    entityType: "account",
    entityId: accountId,
    after: { email: user.email, isActive: input.isActive, passwordReset: !!input.password },
  });
  return getAccount(db, accountId);
}

// ---------------------------------------------------------------------------
// Price list and discount
// ---------------------------------------------------------------------------

export async function getAccountPriceList(db: TenantDb, id: string): Promise<PriceListDetail | null> {
  const a = await db.account.findFirst({ where: { id }, select: { priceListId: true } });
  if (!a) throw notFound("Lab not found");
  if (!a.priceListId) return null;
  return db.priceList.findFirst({
    where: { id: a.priceListId },
    select: { id: true, name: true, type: true, commissionMode: true, items: { select: { testId: true, pricePaise: true, commissionPercent: true, commissionPaise: true } } },
  });
}

/** Finds the lab's own price list, making one the first time. */
async function ensureList(tx: Tx, actor: Actor, a: { id: string; name: string; priceListId: string | null }) {
  if (a.priceListId) return a.priceListId;
  const base = `${a.name} (B2B rates)`;
  let name = base;
  for (let n = 2; await tx.priceList.findFirst({ where: { tenantId: actor.tenantId, name: { equals: name, mode: "insensitive" } }, select: { id: true } }); n++) name = `${base} ${n}`;
  const list = await tx.priceList.create({ data: { tenantId: actor.tenantId, name, type: "B2B" }, select: { id: true } });
  await tx.account.update({ where: { id: a.id }, data: { priceListId: list.id } });
  return list.id;
}

export async function saveAccountPriceList(db: TenantDb, actor: Actor, id: string, items: { testId: string; pricePaise: number }[]) {
  const a = await db.account.findFirst({ where: { id }, select: { id: true, name: true, priceListId: true } });
  if (!a) throw notFound("Lab not found");
  const testIds = [...new Set(items.map((i) => i.testId))];
  if (testIds.length !== items.length) throw badRequest("A test was listed twice");
  if ((await db.test.count({ where: { id: { in: testIds } } })) !== testIds.length) throw badRequest("One or more tests weren't found");
  await db.$transaction(
    async (tx) => {
      const listId = await ensureList(tx, actor, a);
      await tx.priceListItem.deleteMany({ where: { priceListId: listId } });
      if (items.length) {
        await tx.priceListItem.createMany({ data: items.map((i) => ({ tenantId: actor.tenantId, priceListId: listId, testId: i.testId, pricePaise: i.pricePaise })) });
      }
      await audit({ ...auditMeta(actor), action: "account.price_list", entityType: "account", entityId: id, after: { items: items.length } }, tx);
    },
    { timeout: 30_000 },
  );
  return getAccountPriceList(db, id);
}

/** One price change for many labs, written to each lab's own price list. */
export async function bulkPrice(db: TenantDb, actor: Actor, input: z.output<typeof bulkPriceSchema>) {
  const ids = [...new Set(input.accountIds)];
  const accounts = await db.account.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, priceListId: true } });
  if (accounts.length === 0) throw badRequest("None of those labs were found");
  let changes: { testId: string; pricePaise: number }[];
  if (input.mode === "FIXED") {
    changes = input.items;
    const found = await db.test.count({ where: { id: { in: changes.map((c) => c.testId) } } });
    if (found !== new Set(changes.map((c) => c.testId)).size) throw badRequest("One or more tests weren't found");
  } else {
    const tests = await db.test.findMany({
      where: { isActive: true, pricePaise: { gt: 0 }, ...(input.testIds.length ? { id: { in: input.testIds } } : {}) },
      select: { id: true, pricePaise: true },
    });
    changes = tests.map((t) => ({ testId: t.id, pricePaise: Math.max(0, Math.round((t.pricePaise * (100 + input.percent)) / 100)) }));
    if (changes.length === 0) throw badRequest("No priced tests to change");
  }
  await db.$transaction(
    async (tx) => {
      for (const a of accounts) {
        const listId = await ensureList(tx, actor, a);
        for (const c of changes) {
          await tx.priceListItem.upsert({
            where: { priceListId_testId: { priceListId: listId, testId: c.testId } },
            create: { tenantId: actor.tenantId, priceListId: listId, testId: c.testId, pricePaise: c.pricePaise },
            update: { pricePaise: c.pricePaise },
          });
        }
      }
      await audit({ ...auditMeta(actor), action: "account.bulk_price", entityType: "account", after: { accountIds: ids, mode: input.mode, tests: changes.length } }, tx);
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
  return { labs: accounts.length, tests: changes.length };
}

// ---------------------------------------------------------------------------
// Wallet: adding money, notes, history
// ---------------------------------------------------------------------------

export async function topUp(db: TenantDb, actor: Actor, input: z.output<typeof topUpSchema>) {
  const account = await db.account.findFirst({ where: { id: input.accountId }, select: { id: true, name: true } });
  if (!account) throw notFound("Lab not found");
  await db.$transaction(async (tx) => {
    // Kept in AccountPayment too, so the day's collections still include it.
    const payment = await tx.accountPayment.create({
      data: {
        tenantId: actor.tenantId,
        accountId: account.id,
        branchId: actor.branchId,
        mode: input.mode,
        amountPaise: input.amountPaise,
        reference: input.reference,
        allocations: [],
        receivedById: actor.userId,
      },
      select: { id: true },
    });
    await move(tx, {
      tenantId: actor.tenantId,
      accountId: account.id,
      wallet: input.amountPaise,
      txn: { kind: "TOPUP", mode: input.mode, reference: input.reference, narration: "Money added", createdById: actor.userId },
    });
    await audit({ ...auditMeta(actor), action: "account.topup", entityType: "account", entityId: account.id, after: { paymentId: payment.id, ...input } }, tx);
  });
  return getAccount(db, account.id);
}

export async function createNote(db: TenantDb, actor: Actor, input: z.output<typeof noteSchema>): Promise<AccountNoteItem> {
  const account = await db.account.findFirst({ where: { id: input.accountId }, select: { id: true, code: true, name: true } });
  if (!account) throw notFound("Lab not found");
  const prefix = input.kind === "CREDIT" ? "CN" : "DN";
  const noteId = await db.$transaction(async (tx) => {
    const fy = financialYear(todayIST());
    const noteNo = `${prefix}/${fy}/${String(await nextNumber(tx, actor.tenantId, `note:${prefix}:${fy}`)).padStart(6, "0")}`;
    const note = await tx.accountNote.create({
      data: { tenantId: actor.tenantId, accountId: account.id, kind: input.kind, noteNo, amountPaise: input.amountPaise, reason: input.reason, createdById: actor.userId },
      select: { id: true },
    });
    // A debit note may take the lab past its credit limit: it is the lab's own charge, not an order.
    await move(tx, {
      tenantId: actor.tenantId,
      accountId: account.id,
      wallet: input.kind === "CREDIT" ? input.amountPaise : -input.amountPaise,
      txn: { kind: input.kind === "CREDIT" ? "CREDIT_NOTE" : "DEBIT_NOTE", noteId: note.id, narration: `${noteNo}: ${input.reason}`, createdById: actor.userId },
    });
    await audit({ ...auditMeta(actor), action: "account.note", entityType: "account", entityId: account.id, after: { noteNo, ...input } }, tx);
    return note.id;
  });
  const n = await db.accountNote.findFirstOrThrow({ where: { id: noteId }, select: noteSelect });
  return toNote(n);
}

const noteSelect = { id: true, noteNo: true, kind: true, amountPaise: true, reason: true, createdAt: true, account: { select: { id: true, code: true, name: true } } } as const;
const toNote = (n: Prisma.AccountNoteGetPayload<{ select: typeof noteSelect }>): AccountNoteItem => ({ ...n, createdAt: n.createdAt.toISOString() });

export async function listNotes(db: TenantDb, f: { accountId?: string; from: string; to: string }) {
  const rows = await db.accountNote.findMany({
    where: { ...(f.accountId ? { accountId: f.accountId } : {}), createdAt: istRange(f.from, f.to) },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: noteSelect,
  });
  return rows.map(toNote);
}

const txnSelect = {
  id: true,
  createdAt: true,
  kind: true,
  amountPaise: true,
  balanceAfterPaise: true,
  mode: true,
  reference: true,
  narration: true,
  orderId: true,
  account: { select: { id: true, code: true, name: true } },
} as const;

async function toTxnItems(db: TenantDb, rows: Prisma.WalletTxnGetPayload<{ select: typeof txnSelect }>[]): Promise<WalletTxnItem[]> {
  const orderIds = [...new Set(rows.map((r) => r.orderId).filter((x): x is string => !!x))];
  const orders = orderIds.length ? await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNo: true } }) : [];
  return rows.map(({ orderId, ...r }) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    kind: r.kind as WalletTxnKind,
    orderNo: orders.find((o) => o.id === orderId)?.orderNo ?? null,
  }));
}

const HISTORY_LIMIT = 1000;

export async function walletHistory(
  db: TenantDb,
  f: { accountId?: string; from: string; to: string; kind?: WalletTxnKind },
): Promise<WalletHistoryPage> {
  const rows = await db.walletTxn.findMany({
    where: { ...(f.accountId ? { accountId: f.accountId } : {}), ...(f.kind ? { kind: f.kind } : {}), createdAt: istRange(f.from, f.to) },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT + 1,
    select: txnSelect,
  });
  return { entries: await toTxnItems(db, rows.slice(0, HISTORY_LIMIT)), truncated: rows.length > HISTORY_LIMIT };
}

export async function ledger(db: TenantDb, accountId: string, from: string, to: string): Promise<LedgerResponse> {
  const account = await db.account.findFirst({ where: { id: accountId }, select: { id: true, code: true, name: true } });
  if (!account) throw notFound("Lab not found");
  const range = istRange(from, to);
  const [opening, rows] = await Promise.all([
    db.walletTxn.aggregate({ where: { accountId, createdAt: { lt: range.gte } }, _sum: { amountPaise: true } }),
    db.walletTxn.findMany({ where: { accountId, createdAt: range }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 5000, select: txnSelect }),
  ]);
  const openingPaise = opening._sum.amountPaise ?? 0;
  const credit = rows.filter((r) => r.amountPaise > 0).reduce((t, r) => t + r.amountPaise, 0);
  const debit = rows.filter((r) => r.amountPaise < 0).reduce((t, r) => t - r.amountPaise, 0);
  return { account, from, to, openingPaise, closingPaise: openingPaise + credit - debit, creditPaise: credit, debitPaise: debit, entries: await toTxnItems(db, rows) };
}

const MAX_DAYS = 366;
function checkSpan(from: string, to: string) {
  if (from > to) throw badRequest("The end date is before the start date");
  if ((day(to).getTime() - day(from).getTime()) / DAY >= MAX_DAYS) throw badRequest("Pick a range of a year or less");
}

/** All labs together: money in, money out and the closing wallet balance for each day. */
export async function dayBalances(db: TenantDb, from: string, to: string): Promise<DayBalanceRow[]> {
  checkSpan(from, to);
  const range = istRange(from, to);
  const [opening, rows] = await Promise.all([
    db.walletTxn.aggregate({ where: { createdAt: { lt: range.gte } }, _sum: { amountPaise: true } }),
    db.walletTxn.findMany({ where: { createdAt: range }, select: { createdAt: true, amountPaise: true } }),
  ]);
  const byDay = new Map<string, { credit: number; debit: number }>();
  for (const r of rows) {
    const k = istDate(r.createdAt);
    const d = byDay.get(k) ?? { credit: 0, debit: 0 };
    if (r.amountPaise > 0) d.credit += r.amountPaise;
    else d.debit -= r.amountPaise;
    byDay.set(k, d);
  }
  const out: DayBalanceRow[] = [];
  let running = opening._sum.amountPaise ?? 0;
  for (let t = day(from).getTime(); t <= day(to).getTime(); t += DAY) {
    const k = new Date(t).toISOString().slice(0, 10);
    const d = byDay.get(k) ?? { credit: 0, debit: 0 };
    running += d.credit - d.debit;
    out.push({ date: k, creditPaise: d.credit, debitPaise: d.debit, closingPaise: running });
  }
  return out.reverse();
}

/** Each lab: what its wallet held at the start of the range, what came in and went out, and where it ends. */
export async function labBalances(db: TenantDb, from: string, to: string): Promise<LabBalanceRow[]> {
  checkSpan(from, to);
  const range = istRange(from, to);
  const [accounts, opening, rows] = await Promise.all([
    db.account.findMany({ orderBy: { name: "asc" }, select: { id: true, code: true, name: true, holdPaise: true } }),
    db.walletTxn.groupBy({ by: ["accountId"], where: { createdAt: { lt: range.gte } }, _sum: { amountPaise: true } }),
    db.walletTxn.findMany({ where: { createdAt: range }, select: { accountId: true, amountPaise: true } }),
  ]);
  return accounts.map((a) => {
    const mine = rows.filter((r) => r.accountId === a.id);
    const credit = mine.filter((r) => r.amountPaise > 0).reduce((t, r) => t + r.amountPaise, 0);
    const debit = mine.filter((r) => r.amountPaise < 0).reduce((t, r) => t - r.amountPaise, 0);
    const open = opening.find((o) => o.accountId === a.id)?._sum.amountPaise ?? 0;
    return { account: { id: a.id, code: a.code, name: a.name }, openingPaise: open, creditPaise: credit, debitPaise: debit, closingPaise: open + credit - debit, holdPaise: a.holdPaise };
  });
}

// ---------------------------------------------------------------------------
// Invoices: statements of the orders already taken from a lab's wallet
// ---------------------------------------------------------------------------

const orderItemSelect = {
  id: true,
  orderNo: true,
  createdAt: true,
  netPaise: true,
  patient: { select: { name: true, uhid: true } },
  items: { orderBy: { sortOrder: "asc" }, select: { code: true } },
  invoice: { select: { invoiceNo: true } },
} as const satisfies Prisma.OrderSelect;

export const toOrderItem = (o: Prisma.OrderGetPayload<{ select: typeof orderItemSelect }>): AccountOrderItem => ({
  id: o.id,
  orderNo: o.orderNo,
  createdAt: o.createdAt.toISOString(),
  patient: o.patient,
  tests: o.items.map((i) => i.code),
  netPaise: o.netPaise,
  invoiceNo: o.invoice?.invoiceNo ?? null,
});

const invoiceSelect = {
  id: true,
  invoiceNo: true,
  periodFrom: true,
  periodTo: true,
  totalPaise: true,
  status: true,
  issuedAt: true,
  voidReason: true,
  _count: { select: { orders: true } },
} as const;

function toInvoiceItem(i: Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>) {
  return {
    id: i.id,
    invoiceNo: i.invoiceNo,
    periodFrom: toIsoDate(i.periodFrom),
    periodTo: toIsoDate(i.periodTo),
    totalPaise: i.totalPaise,
    status: i.status,
    issuedAt: i.issuedAt.toISOString(),
    orderCount: i._count.orders,
    voidReason: i.voidReason,
  };
}

/** Invoices every order of the period that the wallet has been charged for and no invoice has yet. */
export async function createInvoice(db: TenantDb, actor: Actor, accountId: string, input: { periodFrom: string; periodTo: string }) {
  const account = await db.account.findFirst({ where: { id: accountId }, select: { id: true } });
  if (!account) throw notFound("Lab not found");
  if (input.periodTo > todayIST()) throw badRequest("The period can't end in the future", { periodTo: ["Pick today or earlier"] });
  const range = istRange(input.periodFrom, input.periodTo);

  const id = await db.$transaction(async (tx) => {
    const orders = await tx.order.findMany({
      where: { tenantId: actor.tenantId, accountId, status: "ACTIVE", invoiceId: null, chargeSettled: true, createdAt: range },
      select: { id: true, netPaise: true },
    });
    if (orders.length === 0) throw badRequest("No orders to invoice in this period");
    const fy = financialYear(todayIST());
    const invoiceNo = formatInvoiceNo(fy, await nextNumber(tx, actor.tenantId, `invoice:${fy}`));
    const total = orders.reduce((t, o) => t + o.netPaise, 0);
    const invoice = await tx.invoice.create({
      data: {
        tenantId: actor.tenantId,
        accountId,
        invoiceNo,
        periodFrom: day(input.periodFrom),
        periodTo: day(input.periodTo),
        totalPaise: total,
        // Already paid from the wallet when each order was taken.
        paidPaise: total,
        status: "PAID",
        dueDate: day(todayIST()),
        createdById: actor.userId,
      },
      select: { id: true },
    });
    const claimed = await tx.order.updateMany({
      where: { id: { in: orders.map((o) => o.id) }, invoiceId: null, status: "ACTIVE" },
      data: { invoiceId: invoice.id },
    });
    if (claimed.count !== orders.length) throw conflict("Some orders just changed. Try again.");
    await audit({ ...auditMeta(actor), action: "invoice.create", entityType: "invoice", entityId: invoice.id, after: { invoiceNo, accountId, ...input, totalPaise: total, orders: orders.length } }, tx);
    return invoice.id;
  });
  return getInvoice(db, id);
}

export async function voidInvoice(db: TenantDb, actor: Actor, id: string, reason: string) {
  const inv = await db.invoice.findFirst({ where: { id }, select: { id: true, status: true, invoiceNo: true } });
  if (!inv) throw notFound("Invoice not found");
  if (inv.status === "VOID") throw conflict("This invoice is already void");
  await db.$transaction(async (tx) => {
    const r = await tx.invoice.updateMany({ where: { id, status: { not: "VOID" } }, data: { status: "VOID", voidedAt: new Date(), voidReason: reason } });
    if (r.count === 0) throw conflict("This invoice just changed. Refresh and try again.");
    await tx.order.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
    await audit({ ...auditMeta(actor), action: "invoice.void", entityType: "invoice", entityId: id, after: { invoiceNo: inv.invoiceNo, reason } }, tx);
  });
  return getInvoice(db, id);
}

export async function listInvoices(db: TenantDb, f: { status?: string; accountId?: string }): Promise<InvoiceListItem[]> {
  const rows = await db.invoice.findMany({
    where: {
      ...(f.accountId ? { accountId: f.accountId } : {}),
      ...(f.status === "PAID" || f.status === "VOID" ? { status: f.status } : {}),
    },
    orderBy: { issuedAt: "desc" },
    take: 300,
    select: { ...invoiceSelect, account: { select: { id: true, code: true, name: true } } },
  });
  return rows.map((r) => ({ ...toInvoiceItem(r), account: r.account }));
}

export async function getInvoice(db: TenantDb, id: string, accountId?: string): Promise<InvoiceDetail> {
  const inv = await db.invoice.findFirst({
    where: { id, ...(accountId ? { accountId } : {}) },
    select: {
      ...invoiceSelect,
      tenantId: true,
      account: { select: { id: true, code: true, name: true, contactName: true, address: true, gstin: true, phone: true, email: true } },
      orders: { orderBy: { createdAt: "asc" }, select: orderItemSelect },
    },
  });
  if (!inv) throw notFound("Invoice not found");
  const lab = await prisma.tenant.findUniqueOrThrow({ where: { id: inv.tenantId }, select: { name: true, gstin: true, phone: true, email: true } });
  return { ...toInvoiceItem(inv), account: inv.account, lab, orders: inv.orders.map(toOrderItem) };
}

export { orderItemSelect, istRange, istDate };
