import { settleOrders } from "../accounts/wallet.service";
import type { Prisma } from "@prisma/client";
import { orderFilterWhere } from "../../lib/list-filters";
import type { ListFilters } from "@lms/shared";
import {
  formatBarcode,
  toIsoDate,
  type ReceiveResult,
  type SampleItem,
  type SamplePage,
  type SampleStatus,
} from "@lms/shared";
import type { TenantDb } from "../../lib/tenant-db";
import { audit } from "../../lib/audit";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { istDayRange } from "../orders/orders.service";

export interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
  ip: string | null;
  userAgent: string | null;
}

const auditMeta = (a: Actor) => ({ tenantId: a.tenantId, actorId: a.userId, ip: a.ip, userAgent: a.userAgent });

const select = {
  id: true,
  barcode: true,
  sampleType: true,
  container: true,
  status: true,
  createdAt: true,
  collectedAt: true,
  collectedById: true,
  receivedAt: true,
  receivedById: true,
  rejectedAt: true,
  rejectReason: true,
  tests: { orderBy: { sortOrder: "asc" }, select: { id: true, code: true, name: true, status: true } },
  order: {
    select: {
      id: true,
      orderNo: true,
      createdAt: true,
      status: true,
      branch: { select: { id: true, name: true } },
      patient: { select: { id: true, uhid: true, salutation: true, name: true, sex: true, dob: true, dobEstimated: true } },
    },
  },
} satisfies Prisma.SampleSelect;

type Row = Prisma.SampleGetPayload<{ select: typeof select }>;

async function toItems(db: TenantDb, rows: Row[]): Promise<SampleItem[]> {
  const ids = [...new Set(rows.flatMap((r) => [r.collectedById, r.receivedById]).filter((x): x is string => !!x))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
  return rows.map((r) => ({
    id: r.id,
    barcode: r.barcode,
    sampleType: r.sampleType,
    container: r.container,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    collectedAt: r.collectedAt?.toISOString() ?? null,
    collectedBy: name(r.collectedById),
    receivedAt: r.receivedAt?.toISOString() ?? null,
    receivedBy: name(r.receivedById),
    rejectedAt: r.rejectedAt?.toISOString() ?? null,
    rejectReason: r.rejectReason,
    tests: r.tests,
    order: {
      id: r.order.id,
      orderNo: r.order.orderNo,
      createdAt: r.order.createdAt.toISOString(),
      branch: r.order.branch,
      patient: { ...r.order.patient, dob: toIsoDate(r.order.patient.dob) },
    },
  }));
}

// ---------------------------------------------------------------------------
// Worklists
// ---------------------------------------------------------------------------

/**
 * Samples by stage. To collect / collected show everything still open (newest
 * first); received and rejected are per day.
 */
export async function listSamples(
  db: TenantDb,
  f: { status: SampleStatus; date?: string; dateTo?: string; q?: string; branchId?: string | null; filters?: ListFilters },
): Promise<SamplePage> {
  const orderWhere: Prisma.OrderWhereInput = { status: "ACTIVE", ...orderFilterWhere(f.filters ?? {}) };
  if (f.branchId && (f.status === "PENDING" || f.status === "COLLECTED")) {
    // A centre sees the samples billed there; the lab sees everything coming in.
    orderWhere.AND = [{ branchId: f.branchId }];
  }
  const where: Prisma.SampleWhereInput = { status: f.status, order: orderWhere };
  if (f.status === "RECEIVED" && f.date) where.receivedAt = istDayRange(f.date, f.dateTo);
  if (f.status === "REJECTED" && f.date) where.rejectedAt = istDayRange(f.date, f.dateTo);
  const q = f.q?.trim();
  if (q) {
    where.OR = [
      { barcode: { contains: q.replace(/\D/g, "") || q } },
      { order: { orderNo: { contains: q } } },
      { order: { patient: { name: { contains: q, mode: "insensitive" } } } },
    ];
  }
  const [rows, total] = await Promise.all([
    db.sample.findMany({ where, select, orderBy: { createdAt: "desc" }, take: 200 }),
    db.sample.count({ where }),
  ]);
  return { samples: await toItems(db, rows), total };
}

export async function sampleByBarcode(db: TenantDb, barcode: string): Promise<SampleItem> {
  const row = await db.sample.findFirst({ where: { barcode: barcode.trim() }, select });
  if (!row) throw notFound(`No sample with barcode ${barcode}`);
  return (await toItems(db, [row]))[0]!;
}

// ---------------------------------------------------------------------------
// Moving samples along
// ---------------------------------------------------------------------------

export async function collectSamples(db: TenantDb, actor: Actor, sampleIds: string[]): Promise<SampleItem[]> {
  const rows = await db.sample.findMany({
    where: { id: { in: sampleIds } },
    select: { id: true, barcode: true, status: true, order: { select: { status: true } } },
  });
  if (rows.length !== sampleIds.length) throw notFound("Sample not found");
  const bad = rows.find((r) => r.status !== "PENDING" || r.order.status !== "ACTIVE");
  if (bad) throw conflict(`Sample ${bad.barcode} isn't waiting to be collected`);

  const now = new Date();
  await db.$transaction(async (tx) => {
    const updated = await tx.sample.updateMany({
      where: { id: { in: sampleIds }, status: "PENDING" },
      data: { status: "COLLECTED", collectedAt: now, collectedById: actor.userId, collectedBranchId: actor.branchId },
    });
    if (updated.count !== sampleIds.length) throw conflict("A sample just changed. Refresh and try again.");
    await audit(
      { ...auditMeta(actor), action: "sample.collect", entityType: "sample", after: { barcodes: rows.map((r) => r.barcode) } },
      tx,
    );
  });
  return toItems(db, await db.sample.findMany({ where: { id: { in: sampleIds } }, select }));
}

/** Changes a tube's barcode (for example when the lab uses its own label stock). */
export async function editBarcode(db: TenantDb, actor: Actor, id: string, barcode: string) {
  const sample = await db.sample.findFirst({ where: { id }, select: { id: true, barcode: true, status: true, order: { select: { status: true } } } });
  if (!sample) throw notFound("Sample not found");
  if (sample.status === "CANCELLED" || sample.status === "REJECTED" || sample.order.status === "CANCELLED") {
    throw conflict("This sample can no longer be relabelled");
  }
  if (sample.barcode === barcode) return { id, barcode };
  const mine = await db.sample.findFirst({ where: { id }, select: { orderId: true } });
  const taken = await db.sample.findFirst({ where: { barcode, id: { not: id }, orderId: { not: mine?.orderId } }, select: { id: true } });
  if (taken) throw conflict(`Barcode ${barcode} is already used by another sample`, { barcode: ["Already used by another sample"] });
  await db.$transaction(async (tx) => {
    await tx.sample.update({ where: { id }, data: { barcode } });
    await audit(
      { ...auditMeta(actor), action: "sample.barcode.edit", entityType: "sample", entityId: id, before: { barcode: sample.barcode }, after: { barcode } },
      tx,
    );
  });
  return { id, barcode };
}

/** Receives scanned samples at the lab. A sample still "to collect" is collected and received in one go. */
export async function receiveSamples(
  db: TenantDb,
  actor: Actor,
  input: { barcodes: string[]; sampleIds: string[] },
): Promise<ReceiveResult> {
  const rows = await db.sample.findMany({
    where: { OR: [{ barcode: { in: input.barcodes } }, { id: { in: input.sampleIds } }] },
    select: { id: true, barcode: true, status: true, collectedAt: true, orderId: true, order: { select: { status: true } } },
  });

  const problems: ReceiveResult["problems"] = [];
  for (const b of input.barcodes) {
    if (!rows.some((r) => r.barcode === b)) problems.push({ barcode: b, message: "No sample with this barcode" });
  }
  const why: Partial<Record<SampleStatus, string>> = {
    RECEIVED: "Already received",
    REJECTED: "This sample was rejected; use the new one",
    CANCELLED: "The order is cancelled",
  };
  const ok = rows.filter((r) => {
    const message = r.order.status !== "ACTIVE" ? "The order is cancelled" : why[r.status];
    if (message) problems.push({ barcode: r.barcode, message });
    return !message;
  });

  if (ok.length) {
    const now = new Date();
    await db.$transaction(async (tx) => {
      for (const r of ok) {
        await tx.sample.update({
          where: { id: r.id },
          data: {
            status: "RECEIVED",
            receivedAt: now,
            receivedById: actor.userId,
            // Collected and received at the same counter.
            ...(r.collectedAt ? {} : { collectedAt: now, collectedById: actor.userId, collectedBranchId: actor.branchId }),
          },
        });
      }
      await tx.orderTest.updateMany({
        where: { sampleId: { in: ok.map((r) => r.id) }, status: "AWAITING_SAMPLE" },
        data: { status: "IN_LAB" },
      });
      // A B2B lab's order is charged to its wallet once the first tube is here.
      await settleOrders(tx, actor.tenantId, [...new Set(ok.map((r) => r.orderId))], actor.userId);
      await audit(
        { ...auditMeta(actor), action: "sample.receive", entityType: "sample", after: { barcodes: ok.map((r) => r.barcode) } },
        tx,
      );
    });
  }

  const received = ok.length ? await toItems(db, await db.sample.findMany({ where: { id: { in: ok.map((r) => r.id) } }, select })) : [];
  return { received, problems };
}

/**
 * Rejects a sample (haemolysed, clotted...). Its tests move to a new sample with
 * the next barcode, waiting to be collected again.
 */
export async function rejectSample(
  db: TenantDb,
  actor: Actor,
  id: string,
  input: { reason: string; note: string | null },
): Promise<{ rejected: SampleItem; replacement: SampleItem }> {
  const sample = await db.sample.findFirst({
    where: { id },
    select: {
      id: true,
      barcode: true,
      status: true,
      orderId: true,
      sampleType: true,
      container: true,
      order: { select: { orderNo: true, status: true } },
      tests: { select: { status: true } },
    },
  });
  if (!sample) throw notFound("Sample not found");
  if (sample.order.status !== "ACTIVE") throw conflict("The order is cancelled");
  if (sample.status !== "COLLECTED" && sample.status !== "RECEIVED") {
    throw badRequest("Only a collected or received sample can be rejected");
  }
  if (sample.tests.some((t) => t.status === "APPROVED")) {
    throw conflict("Results from this sample are already approved");
  }

  const reason = input.note ? `${input.reason}: ${input.note}` : input.reason;
  const replacementId = await db.$transaction(async (tx) => {
    const updated = await tx.sample.updateMany({
      where: { id, status: sample.status },
      data: { status: "REJECTED", rejectedAt: new Date(), rejectedById: actor.userId, rejectReason: reason },
    });
    if (updated.count === 0) throw conflict("This sample just changed. Refresh and try again.");

    const count = await tx.sample.count({ where: { orderId: sample.orderId } });
    const replacement = await tx.sample.create({
      data: {
        tenantId: actor.tenantId,
        orderId: sample.orderId,
        // Patient wise: the replacement tube keeps the visit's shared barcode.
        barcode: (await tx.sample.count({ where: { orderId: sample.orderId, barcode: sample.barcode, id: { not: id }, status: { not: "REJECTED" } } })) > 0 ? sample.barcode : formatBarcode(sample.order.orderNo, count + 1),
        sampleType: sample.sampleType,
        container: sample.container,
      },
      select: { id: true, barcode: true },
    });
    // Results entered from the bad sample no longer count (the audit log keeps them).
    await tx.result.deleteMany({ where: { orderTest: { sampleId: id } } });
    await tx.orderTest.updateMany({
      where: { sampleId: id },
      data: { sampleId: replacement.id, status: "AWAITING_SAMPLE" },
    });
    await audit(
      {
        ...auditMeta(actor),
        action: "sample.reject",
        entityType: "sample",
        entityId: id,
        after: { barcode: sample.barcode, reason, replacement: replacement.barcode },
      },
      tx,
    );
    return replacement.id;
  });

  const rows = await db.sample.findMany({ where: { id: { in: [id, replacementId] } }, select });
  const items = await toItems(db, rows);
  return { rejected: items.find((s) => s.id === id)!, replacement: items.find((s) => s.id === replacementId)! };
}
