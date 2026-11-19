import type { Prisma } from "@prisma/client";
import {
  availablePaise,
  labSettingsSchema,
  createOrderSchema,
  todayIST,
  toIsoDate,
  type PatientListItem,
  type PortalOrderOutput,
  type PortalOrderItem,
  type PortalSummary,
} from "@lms/shared";
import { prisma } from "../../lib/prisma";
import type { TenantDb } from "../../lib/tenant-db";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors";
import * as orders from "../orders/orders.service";
import * as patients from "../patients/patients.service";
import { istRange } from "./accounts.service";

/**
 * Everything a B2B client can do. Every function takes the lab (account) id taken from the signed-in
 * user's own record, never from the request, so a client can only ever reach its own lab's data.
 */
export interface PortalActor {
  tenantId: string;
  userId: string;
  accountId: string;
  ip: string | null;
  userAgent: string | null;
}

/** The lab a portal user belongs to; refuses people who aren't B2B logins or whose lab is switched off. */
export async function resolveAccount(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { accountId: true, account: { select: { isActive: true } } } });
  if (!u?.accountId || !u.account) throw forbidden("This login isn't linked to a B2B lab");
  if (!u.account.isActive) throw forbidden("This lab has been switched off. Contact the lab.");
  return u.accountId;
}

const REPORT_DONE = "APPROVED";

/** "Report Download Below Credit Limit": while the lab is past its credit limit, its reports stay locked until it adds money. */
export async function reportsBlocked(db: TenantDb, accountId: string) {
  const a = await db.account.findFirst({ where: { id: accountId }, select: { walletPaise: true, holdPaise: true, creditLimitPaise: true, settings: true } });
  if (!a || a.creditLimitPaise == null) return false;
  if (!labSettingsSchema.parse(a.settings ?? {}).reportDownloadBelowCreditB2b) return false;
  return a.walletPaise - a.holdPaise + a.creditLimitPaise < 0;
}

export async function summary(db: TenantDb, a: PortalActor): Promise<PortalSummary> {
  const acc = await db.account.findFirstOrThrow({
    where: { id: a.accountId },
    select: { id: true, code: true, name: true, creditLimitPaise: true, walletPaise: true, holdPaise: true, discountPercent: true, settings: true },
  });
  const { settings, ...account } = acc;
  const flags = labSettingsSchema.parse(settings ?? {});
  const today = istRange(todayIST(), todayIST());
  const [todayCount, open] = await Promise.all([
    db.order.count({ where: { accountId: a.accountId, status: "ACTIVE", createdAt: today } }),
    db.order.findMany({
      where: { accountId: a.accountId, status: "ACTIVE", createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      select: { tests: { where: { status: { not: "CANCELLED" } }, select: { status: true } } },
    }),
  ]);
  let ready = 0;
  let pending = 0;
  for (const o of open) {
    if (o.tests.length && o.tests.every((t) => t.status === REPORT_DONE)) ready++;
    else pending++;
  }
  return {
    account: { ...account, netPaise: acc.walletPaise - acc.holdPaise },
    features: { barcodeEdit: flags.barcodeEdit, allowAddReferralDoctor: flags.allowAddReferralDoctor, hideB2bRateFromBilling: flags.hideB2bRateFromBilling },
    reportsBlocked: await reportsBlocked(db, a.accountId),
    availablePaise: availablePaise(acc),
    orders: { today: todayCount, pendingReports: pending, ready },
  };
}

const orderSelect = {
  id: true,
  orderNo: true,
  createdAt: true,
  status: true,
  netPaise: true,
  chargeSettled: true,
  patient: { select: { id: true, name: true, uhid: true, phone: true } },
  items: { orderBy: { sortOrder: "asc" }, select: { code: true } },
  tests: { select: { status: true } },
} as const satisfies Prisma.OrderSelect;

function toItem(o: Prisma.OrderGetPayload<{ select: typeof orderSelect }>): PortalOrderItem {
  const live = o.tests.filter((t) => t.status !== "CANCELLED");
  const approved = live.filter((t) => t.status === REPORT_DONE).length;
  return {
    id: o.id,
    orderNo: o.orderNo,
    createdAt: o.createdAt.toISOString(),
    status: o.status,
    patient: o.patient,
    tests: o.items.map((i) => i.code),
    netPaise: o.netPaise,
    settled: o.chargeSettled,
    approvedTests: approved,
    totalTests: live.length,
    reportReady: approved > 0,
    // Until the lab has received a tube nothing has been taken, so the order can still be withdrawn.
    cancellable: o.status === "ACTIVE" && !o.chargeSettled && approved === 0,
  };
}

export async function listOrders(db: TenantDb, a: PortalActor, f: { from: string; to: string; q?: string }) {
  const q = f.q?.trim();
  const rows = await db.order.findMany({
    where: {
      accountId: a.accountId,
      createdAt: istRange(f.from, f.to),
      ...(q ? { OR: [{ orderNo: { contains: q } }, { patient: { name: { contains: q, mode: "insensitive" } } }, { patient: { uhid: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: orderSelect,
  });
  return rows.map(toItem);
}

/** An order, only if it belongs to this lab. */
async function ownOrder(db: TenantDb, a: PortalActor, id: string) {
  const o = await db.order.findFirst({ where: { id, accountId: a.accountId }, select: { id: true, status: true, chargeSettled: true, orderNo: true } });
  if (!o) throw notFound("Order not found");
  return o;
}

export async function getOrder(db: TenantDb, a: PortalActor, id: string) {
  await ownOrder(db, a, id);
  const o = await orders.getOrder(db, id);
  // The lab's doctor commission is none of the client's business.
  return { ...o, commissionPercent: null, commissionPaise: 0 } as typeof o;
}

/** The tests this lab can order, at the lab's own rates. */
export async function catalog(db: TenantDb, a: PortalActor) {
  const acc = await db.account.findFirstOrThrow({ where: { id: a.accountId }, select: { priceListId: true, discountPercent: true } });
  const [tests, overrides] = await Promise.all([
    db.test.findMany({
      where: { isActive: true, pricePaise: { gt: 0 } },
      orderBy: [{ department: { sortOrder: "asc" } }, { name: "asc" }],
      select: { id: true, code: true, name: true, isPanel: true, sampleType: true, tatHours: true, pricePaise: true, department: { select: { id: true, name: true } } },
    }),
    acc.priceListId ? db.priceListItem.findMany({ where: { priceListId: acc.priceListId }, select: { testId: true, pricePaise: true } }) : [],
  ]);
  const own = new Map(overrides.map((o) => [o.testId, o.pricePaise]));
  return tests
    .map((t) => ({
      ...t,
      /** The lab's standard (base) rate, shown next to the client's own price. */
      mrpPaise: t.pricePaise,
      pricePaise: own.get(t.id) ?? Math.round((t.pricePaise * (100 - acc.discountPercent)) / 100),
    }))
    .filter((t) => t.pricePaise > 0);
}

export async function searchPatients(db: TenantDb, a: PortalActor, q: string): Promise<PatientListItem[]> {
  const term = q.trim();
  const rows = await db.patient.findMany({
    where: {
      accountId: a.accountId,
      isActive: true,
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" as const } },
              { uhid: { contains: term, mode: "insensitive" as const } },
              ...(term.replace(/\D/g, "") ? [{ phone: { contains: term.replace(/\D/g, "") } }] : []),
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, uhid: true, salutation: true, name: true, sex: true, dob: true, dobEstimated: true, phone: true, createdAt: true },
  });
  return rows.map((p) => ({ ...p, dob: toIsoDate(p.dob), createdAt: p.createdAt.toISOString() }));
}

async function mainBranch(db: TenantDb) {
  return (await db.branch.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ?? null;
}

export async function createPatient(db: TenantDb, a: PortalActor, input: Parameters<typeof patients.createPatient>[2]) {
  // Never offer other people's records as "possible duplicates": a lab only sees the patients it registered.
  const p = await patients.createPatient(db, { tenantId: a.tenantId, userId: a.userId, branchId: await mainBranch(db), ip: a.ip, userAgent: a.userAgent }, { ...input, allowDuplicate: true });
  await db.patient.update({ where: { id: p.id }, data: { accountId: a.accountId } });
  return p;
}

export async function placeOrder(db: TenantDb, a: PortalActor, input: PortalOrderOutput): Promise<PortalOrderItem> {
  const own = await db.patient.findFirst({ where: { id: input.patientId, accountId: a.accountId, isActive: true }, select: { id: true } });
  if (!own) throw badRequest("Patient not found", { patientId: ["Patient not found"] });
  const urgent = input.urgentTestIds.filter((id) => input.testIds.includes(id));
  const urgentCodes = urgent.length ? (await db.test.findMany({ where: { id: { in: urgent } }, select: { code: true } })).map((t) => t.code) : [];
  const notes = [urgentCodes.length ? `URGENT: ${urgentCodes.join(", ")}` : null, input.notes].filter(Boolean).join(". ").slice(0, 500);
  const body = createOrderSchema.parse({
    patientId: input.patientId,
    testIds: input.testIds,
    accountId: a.accountId,
    notes: notes || null,
    barcode: input.barcode ?? undefined,
    payments: [],
  });
  const order = await orders.createOrder(
    db,
    { tenantId: a.tenantId, userId: a.userId, branchId: await mainBranch(db), canDiscount: false, canBillAccount: true, ip: a.ip, userAgent: a.userAgent },
    body,
  );
  return toItem(await db.order.findFirstOrThrow({ where: { id: order.id }, select: orderSelect }));
}

export async function cancel(db: TenantDb, a: PortalActor, id: string, reason: string) {
  const o = await ownOrder(db, a, id);
  if (o.status === "CANCELLED") throw conflict("This order is already cancelled");
  if (o.chargeSettled) throw conflict("The lab has already received this sample, so it can't be cancelled here. Contact the lab.");
  await orders.cancelOrder(
    db,
    { tenantId: a.tenantId, userId: a.userId, branchId: null, canDiscount: false, canBillAccount: true, ip: a.ip, userAgent: a.userAgent },
    id,
    { reason, refundMode: null, refundReference: null },
  );
  return toItem(await db.order.findFirstOrThrow({ where: { id }, select: orderSelect }));
}

export async function assertOwnOrder(db: TenantDb, a: PortalActor, id: string) {
  await ownOrder(db, a, id);
}
