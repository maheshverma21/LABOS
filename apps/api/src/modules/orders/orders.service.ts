import type { Prisma } from "@prisma/client";
import { orderFilterWhere } from "../../lib/list-filters";
import type { ListFilters } from "@lms/shared";
import {
  computeTotals,
  financialYear,
  formatBillNo,
  formatOrderNo,
  paymentStatus,
  PAYMENT_MODES,
  todayIST,
  toIsoDate,
  type CollectionsSummary,
  type CreateOrderOutput,
  type OrderDetail,
  type OrderListItem,
  type OrderPage,
  type PaymentInput,
  type PaymentMode,
} from "@lms/shared";
import type { TenantDb } from "../../lib/tenant-db";
import { audit } from "../../lib/audit";
import { nextNumber } from "../../lib/counter";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors";
import { createWorkItems, ensureWorkItems } from "../samples/work-items";
import { adjustOrder, assertCredit, holdOrder, releaseOrder } from "../accounts/wallet.service";

export interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
  canDiscount: boolean;
  /** accounts:read: may bill an order to a B2B account. */
  canBillAccount: boolean;
  ip: string | null;
  userAgent: string | null;
}

const auditMeta = (a: Actor) => ({ tenantId: a.tenantId, actorId: a.userId, ip: a.ip, userAgent: a.userAgent });

/** The UTC instants that bound a calendar day in India. */
/** IST day range; pass `toIsoDate` for an inclusive from-to range of days. */
export function istDayRange(isoDate: string, toIsoDate?: string | null) {
  const gte = new Date(`${isoDate}T00:00:00+05:30`);
  const end = new Date(`${toIsoDate || isoDate}T00:00:00+05:30`);
  return { gte, lt: new Date(end.getTime() + 86_400_000) };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const listSelect = {
  id: true,
  orderNo: true,
  billNo: true,
  createdAt: true,
  status: true,
  grossPaise: true,
  discountPaise: true,
  netPaise: true,
  paidPaise: true,
  commissionPercent: true,
  commissionPaise: true,
  patient: {
    select: { id: true, uhid: true, salutation: true, name: true, sex: true, dob: true, dobEstimated: true, phone: true },
  },
  doctor: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  account: { select: { id: true, code: true, name: true } },
  _count: { select: { items: true } },
} satisfies Prisma.OrderSelect;

type ListRow = Prisma.OrderGetPayload<{ select: typeof listSelect }>;

function toListItem(o: ListRow): OrderListItem {
  const cancelled = o.status === "CANCELLED";
  return {
    id: o.id,
    orderNo: o.orderNo,
    billNo: o.billNo,
    createdAt: o.createdAt.toISOString(),
    status: o.status,
    paymentStatus: paymentStatus(o.netPaise, o.paidPaise, cancelled, !!o.account),
    grossPaise: o.grossPaise,
    discountPaise: o.discountPaise,
    netPaise: o.netPaise,
    paidPaise: o.paidPaise,
    // The account pays, not the patient.
    duePaise: cancelled || o.account ? 0 : Math.max(o.netPaise - o.paidPaise, 0),
    commissionPercent: o.commissionPercent,
    commissionPaise: o.commissionPaise,
    testCount: o._count.items,
    patient: { ...o.patient, dob: toIsoDate(o.patient.dob) },
    doctor: o.doctor,
    branch: o.branch,
    account: o.account,
  };
}

export async function listOrders(
  db: TenantDb,
  f: { q?: string; date?: string; dateTo?: string; patientId?: string; status?: string; page: number; pageSize: number; filters?: ListFilters },
): Promise<OrderPage> {
  const and: Prisma.OrderWhereInput[] = [orderFilterWhere(f.filters ?? {})];
  if (f.date) and.push({ createdAt: istDayRange(f.date, f.dateTo) });
  if (f.patientId) and.push({ patientId: f.patientId });
  if (f.status === "cancelled") and.push({ status: "CANCELLED" });
  if (f.status === "active") and.push({ status: "ACTIVE" });

  const q = f.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    and.push({
      OR: [
        { orderNo: { contains: q, mode: "insensitive" } },
        { billNo: { contains: q, mode: "insensitive" } },
        { patient: { name: { contains: q, mode: "insensitive" } } },
        { patient: { uhid: { equals: q.toUpperCase() } } },
        ...(digits.length >= 4 ? [{ patient: { phone: { contains: digits } } }] : []),
      ],
    });
  }

  let rows = await db.order.findMany({
    where: { AND: and },
    select: listSelect,
    orderBy: { createdAt: "desc" },
    // "Due" needs paid < net, which Prisma can't compare column to column; filter below.
    ...(f.status === "due" ? {} : { skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
  });
  let total: number;
  if (f.status === "due") {
    rows = rows.filter((o) => o.status === "ACTIVE" && o.paidPaise < o.netPaise);
    total = rows.length;
    rows = rows.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);
  } else {
    total = await db.order.count({ where: { AND: and } });
  }
  return { orders: rows.map(toListItem), total, page: f.page, pageSize: f.pageSize };
}

async function userNames(db: TenantDb, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map<string, string>();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

export async function getOrder(db: TenantDb, id: string): Promise<OrderDetail> {
  await ensureWorkItems(db, id);
  const o = await db.order.findFirst({
    where: { id },
    select: {
      ...listSelect,
      discountType: true,
      discountValue: true,
      discountReason: true,
      notes: true,
      createdById: true,
      cancelledAt: true,
      cancelledById: true,
      cancelReason: true,
      patient: {
        select: {
          id: true, uhid: true, salutation: true, name: true, sex: true, dob: true, dobEstimated: true, phone: true,
          address: true, city: true,
        },
      },
      doctor: { select: { id: true, name: true, qualification: true } },
      branch: { select: { id: true, name: true, address: true, phone: true } },
      priceList: { select: { id: true, name: true } },
      tenant: { select: { name: true, gstin: true, phone: true, email: true } },
      invoice: { select: { id: true, invoiceNo: true, status: true } },
      items: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { createdAt: "asc" } },
      samples: {
        orderBy: { barcode: "asc" },
        select: {
          id: true,
          barcode: true,
          sampleType: true,
          container: true,
          status: true,
          collectedAt: true,
          receivedAt: true,
          rejectReason: true,
          tests: { orderBy: { sortOrder: "asc" }, select: { id: true, code: true, name: true, status: true } },
        },
      },
    },
  });
  if (!o) throw notFound("Order not found");

  const names = await userNames(db, [o.createdById, o.cancelledById, ...o.payments.map((p) => p.receivedById)]);
  const base = toListItem(o as unknown as ListRow);

  return {
    ...base,
    patient: { ...base.patient, address: o.patient.address, city: o.patient.city },
    doctor: o.doctor,
    branch: o.branch,
    discountType: o.discountType,
    // Percent is stored x100 to stay an integer.
    discountValue: o.discountValue == null ? null : o.discountType === "PERCENT" ? o.discountValue / 100 : o.discountValue,
    discountReason: o.discountReason,
    priceList: o.priceList,
    notes: o.notes,
    createdBy: names.get(o.createdById ?? "") ?? null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
    cancelledBy: names.get(o.cancelledById ?? "") ?? null,
    cancelReason: o.cancelReason,
    lab: o.tenant,
    items: o.items.map((i) => ({
      id: i.id,
      testId: i.testId,
      code: i.code,
      name: i.name,
      isPanel: i.isPanel,
      basePricePaise: i.basePricePaise,
      pricePaise: i.pricePaise,
    })),
    invoice: o.invoice && o.invoice.status !== "VOID" ? { id: o.invoice.id, invoiceNo: o.invoice.invoiceNo } : null,
    samples: o.samples.map((s) => ({
      ...s,
      collectedAt: s.collectedAt?.toISOString() ?? null,
      receivedAt: s.receivedAt?.toISOString() ?? null,
    })),
    payments: o.payments.map((p) => ({
      id: p.id,
      kind: p.kind,
      mode: p.mode,
      amountPaise: p.amountPaise,
      reference: p.reference,
      receivedBy: names.get(p.receivedById ?? "") ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

/** Validates the tests and works out what each one costs on this order. */
async function priceLines(db: TenantDb, testIds: string[], priceListId: string | null, discountPercent = 0) {
  const tests = await db.test.findMany({
    where: { id: { in: testIds } },
    select: {
      id: true,
      code: true,
      name: true,
      isPanel: true,
      isActive: true,
      pricePaise: true,
      panelItems: { select: { testId: true } },
    },
  });
  const byId = new Map(tests.map((t) => [t.id, t]));
  const missing = testIds.filter((id) => !byId.get(id)?.isActive);
  if (missing.length) throw badRequest("A test isn't available", { testIds: ["One or more tests aren't in the catalog or are inactive"] });

  // A test already inside a chosen panel would be billed twice.
  for (const panel of tests.filter((t) => t.isPanel)) {
    const inside = panel.panelItems.map((i) => byId.get(i.testId)).find((t) => t);
    if (inside) {
      throw badRequest(`${inside.name} is already part of ${panel.name}`, {
        testIds: [`${inside.name} is already part of ${panel.name}. Remove one of them.`],
      });
    }
  }

  const overrides = priceListId
    ? new Map(
        (
          await db.priceListItem.findMany({
            where: { priceListId, testId: { in: testIds } },
            select: { testId: true, pricePaise: true },
          })
        ).map((i) => [i.testId, i.pricePaise]),
      )
    : new Map<string, number>();

  const lines = testIds.map((id, i) => {
    const t = byId.get(id)!;
    return {
      testId: t.id,
      code: t.code,
      name: t.name,
      isPanel: t.isPanel,
      basePricePaise: t.pricePaise,
      // A lab's own rate wins; otherwise its standing discount comes off the base price.
      pricePaise: overrides.get(t.id) ?? (discountPercent > 0 ? Math.round((t.pricePaise * (100 - discountPercent)) / 100) : t.pricePaise),
      sortOrder: i,
    };
  });

  const unpriced = lines.filter((l) => l.pricePaise === 0 && !(discountPercent > 0 && l.basePricePaise > 0));
  if (unpriced.length) {
    const names = unpriced.map((l) => l.name).join(", ");
    throw badRequest(`Set a price for ${names} before billing`, {
      testIds: [`No price set for ${names}. Set it in the Test List, or give a 100% discount for a free test.`],
    });
  }
  return lines;
}

/**
 * The referring doctor's commission. With the doctor's own price list in use, each test earns what that list says
 * (a percentage of its price after any discount, or a fixed amount); tests the list says nothing about, and orders
 * on any other rate, use the doctor's flat percentage on the bill.
 */
async function doctorCommission(
  db: TenantDb,
  lines: { testId: string; pricePaise: number }[],
  totals: { grossPaise: number; netPaise: number },
  flatPercent: number,
  listId: string | null,
) {
  const flat = (paise: number) => (paise * flatPercent) / 100;
  if (!listId) return Math.round(flat(totals.netPaise));
  const list = await db.priceList.findFirst({
    where: { id: listId },
    select: { commissionMode: true, items: { where: { testId: { in: lines.map((l) => l.testId) } }, select: { testId: true, commissionPercent: true, commissionPaise: true } } },
  });
  if (!list) return Math.round(flat(totals.netPaise));
  const byTest = new Map(list.items.map((i) => [i.testId, i]));
  // What the patient actually pays for a test, after the bill's discount.
  const share = totals.grossPaise > 0 ? totals.netPaise / totals.grossPaise : 1;
  let sum = 0;
  for (const l of lines) {
    const item = byTest.get(l.testId);
    const paid = l.pricePaise * share;
    if (item && list.commissionMode === "AMOUNT" && item.commissionPaise != null) sum += Math.min(item.commissionPaise, paid);
    else if (item && list.commissionMode === "PERCENT" && item.commissionPercent != null) sum += (paid * item.commissionPercent) / 100;
    else sum += flat(paid);
  }
  return Math.round(sum);
}

function checkPayments(payments: PaymentInput[], duePaise: number) {
  const total = payments.reduce((a, p) => a + p.amountPaise, 0);
  if (total > duePaise) {
    throw badRequest("Payment is more than the amount due", { payments: ["Payment is more than the amount due"] });
  }
  return total;
}

export async function createOrder(db: TenantDb, actor: Actor, input: CreateOrderOutput): Promise<OrderDetail> {
  let commissionPercent = 0;
  let doctorListId: string | null = null;
  const patient = await db.patient.findFirst({ where: { id: input.patientId, isActive: true }, select: { id: true } });
  if (!patient) throw badRequest("Patient not found", { patientId: ["Patient not found"] });

  if (input.doctorId) {
    const doctor = await db.doctor.findFirst({
      where: { id: input.doctorId, isActive: true },
      select: { id: true, commissionPercent: true, priceListId: true },
    });
    if (!doctor) throw badRequest("Doctor not found", { doctorId: ["Doctor not found"] });
    commissionPercent = doctor.commissionPercent;
    doctorListId = doctor.priceListId;
  }
  const account = input.accountId
    ? await db.account.findFirst({
        where: { id: input.accountId, isActive: true },
        select: { id: true, name: true, priceListId: true, creditLimitPaise: true, discountPercent: true },
      })
    : null;
  if (input.accountId && !account) throw badRequest("Account not found", { accountId: ["Account not found"] });
  if (account && input.payments.length) {
    throw badRequest("This order is billed to the account; don't take payment from the patient", { payments: ["Billed to the account"] });
  }
  // An account's own rates apply unless another list was picked.
  if (account && !input.priceListId) input = { ...input, priceListId: account.priceListId };
  if (input.priceListId) {
    const list = await db.priceList.findFirst({ where: { id: input.priceListId, isActive: true }, select: { id: true } });
    if (!list) throw badRequest("Price list not found", { priceListId: ["Price list not found"] });
  }
  if (input.discount && !actor.canDiscount) throw forbidden("You don't have permission to give discounts");
  if (input.accountId && !actor.canBillAccount) throw forbidden("You can't bill orders to B2B accounts");

  const lines = await priceLines(db, input.testIds, input.priceListId, account?.discountPercent ?? 0);
  const totals = computeTotals(
    lines.map((l) => l.pricePaise),
    input.discount && { type: input.discount.type, value: input.discount.value },
  );
  const netPaise = totals.netPaise;
  const commissionPaise = await doctorCommission(db, lines, totals, commissionPercent, doctorListId !== null && doctorListId === input.priceListId ? doctorListId : null);
  const paid = checkPayments(input.payments, netPaise);
  if (account) await assertCredit(db, account, netPaise);

  if (input.barcode && (await db.sample.count({ where: { barcode: input.barcode } }))) {
    throw conflict(`Barcode ${input.barcode} is already used on another sample`);
  }
  const today = todayIST();
  const id = await db.$transaction(async (tx) => {
    const orderNo = formatOrderNo(today, await nextNumber(tx, actor.tenantId, `order:${today}`));
    const fy = financialYear(today);
    const billNo = formatBillNo(fy, await nextNumber(tx, actor.tenantId, `bill:${fy}`));

    const order = await tx.order.create({
      data: {
        tenantId: actor.tenantId,
        orderNo,
        billNo,
        patientId: input.patientId,
        doctorId: input.doctorId,
        commissionPercent: input.doctorId ? (totals.netPaise > 0 && commissionPaise > 0 ? Math.round((commissionPaise * 10_000) / totals.netPaise) / 100 : commissionPercent) : null,
        commissionPaise,
        priceListId: input.priceListId,
        branchId: actor.branchId,
        accountId: account?.id ?? null,
        ...totals,
        netPaise,
        paidPaise: paid,
        discountType: input.discount?.type ?? null,
        discountValue: input.discount
          ? input.discount.type === "PERCENT"
            ? Math.round(input.discount.value * 100)
            : input.discount.value
          : null,
        discountReason: input.discount?.reason || null,
        notes: input.notes,
        createdById: actor.userId,
        items: { create: lines.map((l) => ({ tenantId: actor.tenantId, ...l })) },
        payments: {
          create: input.payments.map((p) => ({
            tenantId: actor.tenantId,
            branchId: actor.branchId,
            mode: p.mode,
            amountPaise: p.amountPaise,
            reference: p.reference ?? null,
            receivedById: actor.userId,
          })),
        },
      },
      select: { id: true, orderNo: true, items: { select: { id: true, testId: true, isPanel: true, sortOrder: true } } },
    });
    if (account) await holdOrder(tx, actor.tenantId, order.id, account.id, netPaise);
    await createWorkItems(tx, actor.tenantId, order, order.items, { testIds: new Set(), samples: 0, tests: 0, firstBarcode: input.barcode, mode: input.barcodeMode });
    await audit(
      {
        ...auditMeta(actor),
        action: "order.create",
        entityType: "order",
        entityId: order.id,
        after: {
          orderNo,
          billNo,
          ...totals,
          netPaise,
          paidPaise: paid,
          tests: lines.map((l) => l.code),
          discount: input.discount,
          account: account?.name ?? null,
        },
      },
      tx,
    );
    return order.id;
  });

  return getOrder(db, id);
}

/**
 * Adds tests to a bill already made. The bill's totals, discount and doctor commission are worked out again;
 * the new tests start at accession (new tubes) like any other test, so they follow the usual route to results.
 */
export async function addTests(db: TenantDb, actor: Actor, id: string, testIds: string[]): Promise<OrderDetail> {
  const order = await db.order.findFirst({
    where: { id },
    select: {
      id: true,
      orderNo: true,
      status: true,
      invoiceId: true,
      priceListId: true,
      doctorId: true,
      accountId: true,
      chargePaise: true,
      chargeSettled: true,
      discountType: true,
      discountValue: true,
      paidPaise: true,
      netPaise: true,
      items: { select: { testId: true, pricePaise: true, sortOrder: true, isPanel: true } },
      tests: { select: { testId: true } },
      _count: { select: { samples: true, tests: true } },
    },
  });
  if (!order) throw notFound("Order not found");
  if (order.status === "CANCELLED") throw conflict("This order is cancelled");
  if (order.invoiceId) throw conflict("This order is on an account invoice, so tests can't be added to it");
  await ensureWorkItems(db, id);

  // Not a test the bill already has, nor one inside a panel it has.
  const have = new Set([...order.items.map((i) => i.testId), ...order.tests.map((t) => t.testId)]);
  const dupes = testIds.filter((t) => have.has(t));
  if (dupes.length) throw badRequest("A test is already on this bill", { testIds: ["One or more of those tests are already on this bill"] });
  const picked = await db.test.findMany({ where: { id: { in: testIds }, isPanel: true }, select: { name: true, panelItems: { select: { testId: true } } } });
  for (const p of picked) {
    if (p.panelItems.some((m) => have.has(m.testId))) throw badRequest(`${p.name} includes a test that is already on this bill`, { testIds: [`${p.name} includes a test that is already on this bill`] });
  }

  const orderAccount = order.accountId
    ? await db.account.findFirst({ where: { id: order.accountId }, select: { id: true, name: true, creditLimitPaise: true, discountPercent: true } })
    : null;
  const lines = await priceLines(db, testIds, order.priceListId, orderAccount?.discountPercent ?? 0);
  const discount = order.discountType && order.discountValue ? { type: order.discountType, value: order.discountType === "PERCENT" ? order.discountValue / 100 : order.discountValue } : null;
  const allLines = [...order.items.map((i) => ({ testId: i.testId, pricePaise: i.pricePaise })), ...lines.map((l) => ({ testId: l.testId, pricePaise: l.pricePaise }))];
  const totals = computeTotals(allLines.map((l) => l.pricePaise), discount);

  let commission: { commissionPercent: number | null; commissionPaise: number } | null = null;
  if (order.doctorId) {
    const doctor = await db.doctor.findFirst({ where: { id: order.doctorId }, select: { commissionPercent: true, priceListId: true } });
    if (doctor) {
      const paise = await doctorCommission(db, allLines, totals, doctor.commissionPercent, doctor.priceListId !== null && doctor.priceListId === order.priceListId ? doctor.priceListId : null);
      commission = {
        commissionPercent: totals.netPaise > 0 && paise > 0 ? Math.round((paise * 10_000) / totals.netPaise) / 100 : doctor.commissionPercent,
        commissionPaise: paise,
      };
    }
  }
  if (orderAccount) await assertCredit(db, orderAccount, totals.netPaise - order.netPaise);

  const start = Math.max(-1, ...order.items.map((i) => i.sortOrder)) + 1;
  await db.$transaction(async (tx) => {
    const changed = await tx.order.updateMany({ where: { id, status: "ACTIVE", netPaise: order.netPaise }, data: { ...totals, ...(commission ?? {}) } });
    if (changed.count === 0) throw conflict("This bill just changed. Refresh and try again.");
    await adjustOrder(tx, actor.tenantId, { id, accountId: order.accountId, chargePaise: order.chargePaise, chargeSettled: order.chargeSettled }, totals.netPaise, actor.userId, order.orderNo);
    await tx.orderItem.createMany({ data: lines.map((l, i) => ({ tenantId: actor.tenantId, orderId: id, ...l, sortOrder: start + i })) });
    const created = await tx.orderItem.findMany({
      where: { orderId: id, testId: { in: testIds } },
      select: { id: true, testId: true, isPanel: true, sortOrder: true },
    });
    // A visit that already shares one barcode keeps sharing it for the new tests.
    const have = await tx.sample.findMany({ where: { orderId: id, status: { not: "CANCELLED" } }, select: { barcode: true } });
    const distinct = new Set(have.map((s) => s.barcode));
    const shared = have.length > 1 && distinct.size === 1 ? [...distinct][0]! : null;
    await createWorkItems(tx, actor.tenantId, order, created, { testIds: new Set(order.tests.map((t) => t.testId)), samples: order._count.samples, tests: order._count.tests, mode: shared ? "patient" : "sample", sharedBarcode: shared });
    await audit(
      {
        ...auditMeta(actor),
        action: "order.add_tests",
        entityType: "order",
        entityId: id,
        before: { netPaise: order.netPaise },
        after: { ...totals, tests: lines.map((l) => l.code) },
      },
      tx,
    );
  });
  return getOrder(db, id);
}

// ---------------------------------------------------------------------------
// Payments and cancellation
// ---------------------------------------------------------------------------

export async function addPayments(db: TenantDb, actor: Actor, id: string, payments: PaymentInput[]) {
  const order = await db.order.findFirst({ where: { id }, select: { status: true, netPaise: true, paidPaise: true, accountId: true } });
  if (!order) throw notFound("Order not found");
  if (order.status === "CANCELLED") throw conflict("This order is cancelled");
  if (order.accountId) throw conflict("This order is billed to an account; record payment on the account instead");
  const amount = checkPayments(payments, order.netPaise - order.paidPaise);

  await db.$transaction(async (tx) => {
    // Re-check inside the transaction, so two people collecting at once can't overpay.
    const updated = await tx.order.updateMany({
      where: { id, status: "ACTIVE", paidPaise: order.paidPaise },
      data: { paidPaise: { increment: amount } },
    });
    if (updated.count === 0) throw conflict("This bill just changed. Refresh and try again.");
    await tx.payment.createMany({
      data: payments.map((p) => ({
        tenantId: actor.tenantId,
        orderId: id,
        branchId: actor.branchId,
        mode: p.mode,
        amountPaise: p.amountPaise,
        reference: p.reference ?? null,
        receivedById: actor.userId,
      })),
    });
    await audit(
      { ...auditMeta(actor), action: "order.payment", entityType: "order", entityId: id, after: { payments } as Prisma.InputJsonValue },
      tx,
    );
  });
  return getOrder(db, id);
}

export async function cancelOrder(
  db: TenantDb,
  actor: Actor,
  id: string,
  input: { reason: string; refundMode: PaymentMode | null; refundReference: string | null },
) {
  const order = await db.order.findFirst({
    where: { id },
    select: { status: true, paidPaise: true, orderNo: true, accountId: true, chargePaise: true, chargeSettled: true, invoice: { select: { invoiceNo: true, status: true } } },
  });
  if (!order) throw notFound("Order not found");
  if (order.status === "CANCELLED") throw conflict("This order is already cancelled");
  if (order.invoice && order.invoice.status !== "VOID") {
    throw conflict(`This order is on invoice ${order.invoice.invoiceNo}. Void the invoice first, then cancel the order.`);
  }
  const approved = await db.orderTest.count({ where: { orderId: id, status: "APPROVED" } });
  if (approved) throw conflict("Results on this order are already approved, so it can't be cancelled");
  if (order.paidPaise > 0 && !input.refundMode) {
    throw badRequest("Choose how the money is refunded", { refundMode: ["Choose how the money is refunded"] });
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id, status: "ACTIVE", paidPaise: order.paidPaise },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: input.reason, paidPaise: 0 },
    });
    if (updated.count === 0) throw conflict("This bill just changed. Refresh and try again.");
    await releaseOrder(tx, actor.tenantId, { id, accountId: order.accountId, chargePaise: order.chargePaise, chargeSettled: order.chargeSettled }, actor.userId, order.orderNo);
    await tx.sample.updateMany({ where: { orderId: id, status: { not: "REJECTED" } }, data: { status: "CANCELLED" } });
    await tx.orderTest.updateMany({ where: { orderId: id }, data: { status: "CANCELLED" } });
    if (order.paidPaise > 0) {
      await tx.payment.create({
        data: {
          tenantId: actor.tenantId,
          orderId: id,
          branchId: actor.branchId,
          kind: "REFUND",
          mode: input.refundMode!,
          amountPaise: order.paidPaise,
          reference: input.refundReference,
          receivedById: actor.userId,
        },
      });
    }
    await audit(
      {
        ...auditMeta(actor),
        action: "order.cancel",
        entityType: "order",
        entityId: id,
        after: { reason: input.reason, refundedPaise: order.paidPaise, refundMode: input.refundMode },
      },
      tx,
    );
  });
  return getOrder(db, id);
}

// ---------------------------------------------------------------------------
// Day-end collections
// ---------------------------------------------------------------------------

export async function collections(db: TenantDb, date: string, branchId: string | null, dateTo?: string): Promise<CollectionsSummary> {
  const range = istDayRange(date, dateTo);
  const branchFilter = branchId ? { branchId } : {};

  const [payments, orders, branch] = await Promise.all([
    db.payment.findMany({
      where: { createdAt: range, ...branchFilter },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        kind: true,
        mode: true,
        amountPaise: true,
        reference: true,
        receivedById: true,
        createdAt: true,
        order: { select: { id: true, orderNo: true, patient: { select: { name: true } } } },
      },
    }),
    db.order.findMany({
      where: { createdAt: range, ...branchFilter },
      select: { status: true, netPaise: true, paidPaise: true, discountPaise: true, accountId: true },
    }),
    branchId ? db.branch.findFirst({ where: { id: branchId }, select: { id: true, name: true } }) : null,
  ]);
  // Money in from B2B accounts counts towards the day too.
  const accountPayments = await db.accountPayment.findMany({
    where: { createdAt: range, ...branchFilter },
    orderBy: { createdAt: "asc" },
    select: { id: true, mode: true, amountPaise: true, reference: true, receivedById: true, createdAt: true, account: { select: { id: true, name: true } } },
  });

  const names = await userNames(db, [...payments, ...accountPayments].map((p) => p.receivedById));
  // Account payments are always money in.
  const allIn = [...payments, ...accountPayments.map((p) => ({ ...p, kind: "PAYMENT" as const }))];
  const byMode = PAYMENT_MODES.map((mode) => {
    const rows = allIn.filter((p) => p.mode === mode);
    const sum = (kind: "PAYMENT" | "REFUND") =>
      rows.filter((p) => p.kind === kind).reduce((a, p) => a + p.amountPaise, 0);
    return { mode, collectedPaise: sum("PAYMENT"), refundedPaise: sum("REFUND") };
  });
  const collectedPaise = byMode.reduce((a, m) => a + m.collectedPaise, 0);
  const refundedPaise = byMode.reduce((a, m) => a + m.refundedPaise, 0);
  const active = orders.filter((o) => o.status === "ACTIVE");
  const patientOrders = active.filter((o) => !o.accountId);
  // Who has how much: cash each person should hand over at day end.
  const collectorIds = [...new Set(allIn.map((p) => p.receivedById ?? ""))];
  const byCollector = collectorIds
    .map((uid) => {
      const rows = allIn.filter((p) => (p.receivedById ?? "") === uid);
      const signed = (p: (typeof rows)[number]) => (p.kind === "REFUND" ? -p.amountPaise : p.amountPaise);
      const cashPaise = rows.filter((p) => p.mode === "CASH").reduce((t, p) => t + signed(p), 0);
      return { name: names.get(uid) ?? "Unknown", cashPaise, otherPaise: rows.filter((p) => p.mode !== "CASH").reduce((t, p) => t + signed(p), 0) };
    })
    .sort((x, y) => y.cashPaise - x.cashPaise);

  return {
    date,
    branch,
    byMode,
    collectedPaise,
    refundedPaise,
    netPaise: collectedPaise - refundedPaise,
    byCollector,
    orders: {
      count: active.length,
      billedPaise: active.reduce((a, o) => a + o.netPaise, 0),
      discountPaise: active.reduce((a, o) => a + o.discountPaise, 0),
      duePaise: patientOrders.reduce((a, o) => a + Math.max(o.netPaise - o.paidPaise, 0), 0),
      onAccountPaise: active.filter((o) => o.accountId).reduce((a, o) => a + o.netPaise, 0),
      cancelled: orders.length - active.length,
    },
    payments: payments.map((p) => ({
      id: p.id,
      kind: p.kind,
      mode: p.mode,
      amountPaise: p.amountPaise,
      reference: p.reference,
      receivedBy: names.get(p.receivedById ?? "") ?? null,
      createdAt: p.createdAt.toISOString(),
      orderId: p.order.id,
      orderNo: p.order.orderNo,
      patientName: p.order.patient.name,
    })),
    accountPayments: accountPayments.map((p) => ({
      id: p.id,
      mode: p.mode,
      amountPaise: p.amountPaise,
      reference: p.reference,
      receivedBy: names.get(p.receivedById ?? "") ?? null,
      createdAt: p.createdAt.toISOString(),
      account: p.account,
    })),
  };
}
