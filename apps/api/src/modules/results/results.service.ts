import { Prisma } from "@prisma/client";
import { orderFilterWhere } from "../../lib/list-filters";
import type { ListFilters } from "@lms/shared";
import {
  ageInDays,
  cultureConfigSchema,
  cultureResultSchema,
  type CultureResult,
  OUTSOURCE_FILE_MAX_BYTES,
  evaluateFormula,
  flagFor,
  isCritical,
  parseNumericResult,
  rangeForPatient,
  todayIST,
  toIsoDate,
  type RangeLike,
  type ResultSheet,
  type ResultTest,
  type WorklistOrder,
} from "@lms/shared";
import type { TenantDb } from "../../lib/tenant-db";
import { audit } from "../../lib/audit";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors";
import { istDayRange } from "../orders/orders.service";
import { ensureWorkItems } from "../samples/work-items";

export interface Actor {
  tenantId: string;
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

const auditMeta = (a: Omit<Actor, "userId"> & { userId: string | null }) => ({ tenantId: a.tenantId, actorId: a.userId, ip: a.ip, userAgent: a.userAgent });

const rangeSelect = {
  id: true,
  sex: true,
  ageMinDays: true,
  ageMaxDays: true,
  low: true,
  high: true,
  criticalLow: true,
  criticalHigh: true,
  text: true,
} as const;

const paramSelect = {
  id: true,
  code: true,
  name: true,
  unit: true,
  resultType: true,
  decimals: true,
  options: true,
  formula: true,
  sortOrder: true,
  isActive: true,
  ranges: { select: rangeSelect },
} as const;

/** A saved result's copied range, in the shape the flag helpers use. */
const savedRange = (r: {
  refLow: number | null;
  refHigh: number | null;
  refCritLow: number | null;
  refCritHigh: number | null;
  refText: string | null;
}): RangeLike | null =>
  r.refLow == null && r.refHigh == null && !r.refText
    ? null
    : {
        sex: "ANY",
        ageMinDays: null,
        ageMaxDays: null,
        low: r.refLow,
        high: r.refHigh,
        criticalLow: r.refCritLow,
        criticalHigh: r.refCritHigh,
        text: r.refText,
      };

const round = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/** A saved culture result, or null if none yet (or it no longer parses). */
function parseCulture(raw: unknown): CultureResult | null {
  if (raw == null) return null;
  const r = cultureResultSchema.safeParse(raw);
  return r.success ? r.data : null;
}

// ---------------------------------------------------------------------------
// The entry sheet for one order
// ---------------------------------------------------------------------------

export async function getSheet(db: TenantDb, orderId: string): Promise<ResultSheet> {
  await ensureWorkItems(db, orderId);
  const order = await db.order.findFirst({
    where: { id: orderId },
    select: {
      id: true,
      orderNo: true,
      createdAt: true,
      status: true,
      doctor: { select: { name: true } },
      patient: { select: { id: true, uhid: true, salutation: true, name: true, sex: true, dob: true, dobEstimated: true } },
      tests: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          departmentName: true,
          status: true,
          remarks: true,
          sendBackNote: true,
          enteredById: true,
          enteredAt: true,
          approvedById: true,
          approvedAt: true,
          sample: { select: { barcode: true } },
          culture: true,
          test: { select: { reportNotes: true, reportKind: true, cultureConfig: true, outsourceLab: { select: { name: true } }, parameters: { orderBy: { sortOrder: "asc" }, select: paramSelect } } },
          file: { select: { name: true, mime: true, size: true, addLetterhead: true } },
          results: true,
        },
      },
    },
  });
  if (!order) throw notFound("Order not found");

  const dob = toIsoDate(order.patient.dob);
  const ageDays = ageInDays(dob, todayIST(order.createdAt));

  // Each parameter's latest approved result for this patient on an earlier order (delta check).
  const paramIds = order.tests.flatMap((t) => t.test.parameters.map((p) => p.id));
  const history = paramIds.length
    ? await db.result.findMany({
        where: {
          parameterId: { in: paramIds },
          value: { not: null },
          orderTest: { status: "APPROVED", orderId: { not: order.id }, order: { patientId: order.patient.id } },
        },
        orderBy: { orderTest: { approvedAt: "desc" } },
        select: { parameterId: true, value: true, flag: true, orderTest: { select: { approvedAt: true } } },
      })
    : [];
  const previous = new Map<string, (typeof history)[number]>();
  for (const h of history) if (!previous.has(h.parameterId)) previous.set(h.parameterId, h);

  const userIds = [...new Set(order.tests.flatMap((t) => [t.enteredById, t.approvedById]).filter((x): x is string => !!x))];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;

  const tests: ResultTest[] = order.tests.map((t) => {
    const saved = new Map(t.results.map((r) => [r.parameterId, r]));
    // Active parameters, plus any retired ones that already have a result on this order.
    const params = t.test.parameters.filter((p) => p.isActive || saved.has(p.id));
    return {
      orderTestId: t.id,
      code: t.code,
      name: t.name,
      department: t.departmentName,
      status: t.status,
      sampleBarcode: t.sample?.barcode ?? null,
      remarks: t.remarks,
      sendBackNote: t.sendBackNote,
      reportNotes: t.test.reportNotes,
      enteredBy: userName(t.enteredById),
      enteredAt: t.enteredAt?.toISOString() ?? null,
      approvedBy: userName(t.approvedById),
      approvedAt: t.approvedAt?.toISOString() ?? null,
      outsourceLab: t.test.outsourceLab?.name ?? null,
      outsourceFile: t.file,
      culture:
        t.test.reportKind === "CULTURE" && t.test.cultureConfig
          ? { config: cultureConfigSchema.parse(t.test.cultureConfig), data: parseCulture(t.culture) }
          : null,
      parameters: params.map((p) => {
        const r = saved.get(p.id);
        const prev = previous.get(p.id);
        return {
          parameterId: p.id,
          code: p.code,
          name: r?.name ?? p.name,
          unit: r ? r.unit : p.unit,
          resultType: p.resultType,
          decimals: p.decimals,
          options: p.options,
          formula: p.formula,
          range: r ? savedRange(r) : rangeForPatient(p.ranges, order.patient.sex, ageDays),
          value: r?.value ?? null,
          flag: r?.flag ?? null,
          source: r?.source ?? null,
          previous:
            prev?.value && prev.orderTest.approvedAt
              ? { value: prev.value, flag: prev.flag, date: prev.orderTest.approvedAt.toISOString() }
              : null,
        };
      }),
    };
  });

  return {
    order: {
      id: order.id,
      orderNo: order.orderNo,
      createdAt: order.createdAt.toISOString(),
      status: order.status,
      doctor: order.doctor?.name ?? null,
    },
    patient: { ...order.patient, dob, ageDays },
    tests,
  };
}

// ---------------------------------------------------------------------------
// Saving and submitting
// ---------------------------------------------------------------------------

export async function saveResults(
  db: TenantDb,
  // An analyzer saves with no user: its name goes in opts.source instead.
  actor: Omit<Actor, "userId"> & { userId: string | null },
  orderTestId: string,
  input: { values: Record<string, string | null>; remarks: string | null; submit: boolean; culture?: CultureResult | null },
  opts: { source?: string } = {},
): Promise<ResultSheet> {
  const ot = await db.orderTest.findFirst({
    where: { id: orderTestId },
    select: {
      id: true,
      orderId: true,
      code: true,
      status: true,
      remarks: true,
      culture: true,
      order: { select: { status: true, createdAt: true, patient: { select: { sex: true, dob: true } } } },
      test: { select: { outsourceLabId: true, reportKind: true, cultureConfig: true, parameters: { orderBy: { sortOrder: "asc" }, select: paramSelect } } },
      file: { select: { id: true } },
      results: true,
    },
  });
  if (!ot) throw notFound("Test not found");
  if (ot.order.status !== "ACTIVE") throw conflict("The order is cancelled");
  if (ot.status === "AWAITING_SAMPLE") throw conflict("The sample hasn't been received in the lab yet");
  if (ot.status === "APPROVED") throw conflict("These results are approved. Reopen them to make changes.");
  if (ot.status === "CANCELLED") throw conflict("This test is cancelled");

  const saved = new Map(ot.results.map((r) => [r.parameterId, r]));
  const params = ot.test.parameters.filter((p) => p.isActive || saved.has(p.id));
  const known = new Set(params.map((p) => p.id));
  const unknown = Object.keys(input.values).filter((id) => !known.has(id));
  if (unknown.length) throw badRequest("Unknown parameter in request");

  const ageDays = ageInDays(toIsoDate(ot.order.patient.dob), todayIST(ot.order.createdAt));
  const fieldErrors: Record<string, string[]> = {};

  // Typed values first (the request, else what was saved before), then formulas from them.
  const value = new Map<string, string | null>();
  for (const p of params.filter((x) => !x.formula)) {
    const raw = p.id in input.values ? input.values[p.id] : (saved.get(p.id)?.value ?? null);
    const text = raw?.trim() ? raw.trim() : null;
    if (text == null) {
      value.set(p.id, null);
    } else if (p.resultType === "NUMERIC") {
      const n = parseNumericResult(text);
      if (n == null) fieldErrors[p.id] = [`${p.name}: enter a number`];
      else value.set(p.id, String(n));
    } else if (p.resultType === "OPTIONS") {
      const match = p.options.find((o) => o.toLowerCase() === text.toLowerCase());
      if (!match) fieldErrors[p.id] = [`${p.name}: pick one of ${p.options.join(", ")}`];
      else value.set(p.id, match);
    } else {
      value.set(p.id, text);
    }
  }
  if (Object.keys(fieldErrors).length) throw badRequest("Some results need attention", fieldErrors);

  const byCode: Record<string, number | null> = {};
  for (const p of params) {
    const v = value.get(p.id);
    byCode[p.code] = v == null ? null : parseNumericResult(v);
  }
  for (const p of params.filter((x) => x.formula)) {
    const n = evaluateFormula(p.formula!, byCode);
    value.set(p.id, n == null ? null : String(round(n, p.decimals)));
    byCode[p.code] = n;
  }

  // Culture tests keep growth / organisms / sensitivities in one document instead of parameters.
  const isCulture = ot.test.reportKind === "CULTURE";
  let culture: CultureResult | null = null;
  if (isCulture) {
    if (!ot.test.cultureConfig) throw badRequest("This culture test has no antibiotic list. Set it up in the Test List.");
    const config = cultureConfigSchema.parse(ot.test.cultureConfig);
    culture = input.culture !== undefined ? input.culture : parseCulture(ot.culture);
    if (culture?.outcome === "NO_GROWTH" && !culture.noGrowthText) culture = { ...culture, noGrowthText: config.noGrowthText };
    // Antibiotics since removed from the test stay valid on results that already use them.
    const allowed = new Set(config.antibiotics.map((a) => a.name.toLowerCase()));
    for (const o of parseCulture(ot.culture)?.organisms ?? []) for (const x of o.sensitivities) allowed.add(x.antibiotic.toLowerCase());
    const stray = culture?.organisms.flatMap((o) => o.sensitivities).find((x) => !allowed.has(x.antibiotic.toLowerCase()));
    if (stray) throw badRequest(`${stray.antibiotic} isn't in this test's antibiotic list`, { culture: [`${stray.antibiotic} isn't in this test's antibiotic list`] });
    if (input.submit && !culture && !(!!ot.test.outsourceLabId && !!ot.file)) {
      throw new AppError(400, "incomplete", "Choose No growth or add the organism before submitting", {});
    }
  } else if (input.culture) {
    throw badRequest("This isn't a culture test");
  }

  if (input.submit && !isCulture) {
    // An outsourced test can be submitted with just the report file that came back from the other lab.
    const fileOnly = !!ot.test.outsourceLabId && !!ot.file;
    // Parameters may be left empty: they are simply left off the report. But not all of them.
    const anyValue = params.some((p) => !p.formula && p.isActive && value.get(p.id) != null);
    if (!fileOnly && !anyValue) {
      throw new AppError(400, "incomplete", "Enter at least one result before submitting", {});
    }
  }

  const before = Object.fromEntries(params.map((p) => [p.code, saved.get(p.id)?.value ?? null]));
  const after = Object.fromEntries(params.map((p) => [p.code, value.get(p.id) ?? null]));
  const now = new Date();

  await db.$transaction(async (tx) => {
    // Re-check the status inside the transaction: an approval may have just happened.
    const moved = await tx.orderTest.updateMany({
      where: { id: ot.id, status: { in: ["IN_LAB", "ENTERED", "SUBMITTED"] } },
      data: {
        status: input.submit ? "SUBMITTED" : "ENTERED",
        remarks: input.remarks,
        ...(isCulture && input.culture !== undefined ? { culture: culture ? (culture as Prisma.InputJsonValue) : Prisma.JsonNull } : {}),
        enteredById: actor.userId,
        enteredAt: now,
        ...(input.submit ? { submittedAt: now, sendBackNote: null } : {}),
      },
    });
    if (moved.count === 0) throw conflict("These results just changed. Refresh and try again.");

    for (const [i, p] of params.entries()) {
      const v = value.get(p.id) ?? null;
      // A saved result keeps the range it was entered against; new ones take today's catalog range.
      const old = saved.get(p.id);
      const range = old ? savedRange(old) : rangeForPatient(p.ranges, ot.order.patient.sex, ageDays);
      const data = {
        value: v,
        numericValue: v == null ? null : parseNumericResult(v),
        flag: flagFor(p.resultType, v, range),
        enteredById: actor.userId,
        // Which machine sent it; a value someone changes by hand is theirs.
        source: opts.source && p.id in input.values ? opts.source : old && old.value === v ? old.source : null,
      };
      await tx.result.upsert({
        where: { orderTestId_parameterId: { orderTestId: ot.id, parameterId: p.id } },
        update: data,
        create: {
          tenantId: actor.tenantId,
          orderTestId: ot.id,
          parameterId: p.id,
          code: p.code,
          name: p.name,
          unit: p.unit,
          resultType: p.resultType,
          decimals: p.decimals,
          isCalculated: !!p.formula,
          refLow: range?.low ?? null,
          refHigh: range?.high ?? null,
          refCritLow: range?.criticalLow ?? null,
          refCritHigh: range?.criticalHigh ?? null,
          refText: range?.text ?? null,
          sortOrder: i,
          ...data,
        },
      });
    }

    await audit(
      {
        ...auditMeta(actor),
        action: opts.source ? "result.instrument" : input.submit ? "result.submit" : "result.save",
        entityType: "order_test",
        entityId: ot.id,
        before: { test: ot.code, values: before, remarks: ot.remarks } as Prisma.InputJsonValue,
        after: { test: ot.code, values: after, remarks: input.remarks, ...(isCulture ? { culture } : {}), ...(opts.source ? { source: opts.source } : {}) } as Prisma.InputJsonValue,
      },
      tx,
    );
  });

  return getSheet(db, ot.orderId);
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export async function approve(db: TenantDb, actor: Actor, orderTestIds: string[]) {
  const tests = await db.orderTest.findMany({
    where: { id: { in: orderTestIds } },
    select: { id: true, code: true, status: true, orderId: true, order: { select: { status: true } } },
  });
  if (tests.length !== orderTestIds.length) throw notFound("Test not found");
  const notReady = tests.find((t) => t.status !== "SUBMITTED" || t.order.status !== "ACTIVE");
  if (notReady) throw conflict(`${notReady.code} isn't waiting for approval`);

  await db.$transaction(async (tx) => {
    const updated = await tx.orderTest.updateMany({
      where: { id: { in: orderTestIds }, status: "SUBMITTED" },
      data: { status: "APPROVED", approvedById: actor.userId, approvedAt: new Date() },
    });
    if (updated.count !== orderTestIds.length) throw conflict("Some results just changed. Refresh and try again.");
    await audit(
      { ...auditMeta(actor), action: "result.approve", entityType: "order_test", after: { tests: tests.map((t) => t.code), orderTestIds } },
      tx,
    );
  });
  return [...new Set(tests.map((t) => t.orderId))];
}

async function moveBack(
  db: TenantDb,
  actor: Actor,
  id: string,
  from: "SUBMITTED" | "APPROVED",
  note: string,
  action: string,
): Promise<string> {
  const ot = await db.orderTest.findFirst({ where: { id }, select: { id: true, code: true, status: true, orderId: true } });
  if (!ot) throw notFound("Test not found");
  if (ot.status !== from) {
    throw conflict(from === "SUBMITTED" ? `${ot.code} isn't waiting for approval` : `${ot.code} isn't approved`);
  }
  await db.$transaction(async (tx) => {
    const updated = await tx.orderTest.updateMany({
      where: { id, status: from },
      data: {
        status: "ENTERED",
        sendBackNote: note,
        approvedById: null,
        approvedAt: null,
        ...(from === "APPROVED" ? { amendedAt: new Date() } : {}),
      },
    });
    if (updated.count === 0) throw conflict("This test just changed. Refresh and try again.");
    await audit({ ...auditMeta(actor), action, entityType: "order_test", entityId: id, after: { test: ot.code, note } }, tx);
  });
  return ot.orderId;
}

export const sendBack = (db: TenantDb, actor: Actor, id: string, note: string) =>
  moveBack(db, actor, id, "SUBMITTED", note, "result.send_back");

/** Reopens approved results for correction; the reason is kept in the audit log and shown on the sheet. */
export const reopen = (db: TenantDb, actor: Actor, id: string, reason: string) =>
  moveBack(db, actor, id, "APPROVED", `Reopened: ${reason}`, "result.reopen");

// ---------------------------------------------------------------------------
// Worklists
// ---------------------------------------------------------------------------

export async function worklist(
  db: TenantDb,
  f: { tab: "enter" | "approve" | "approved"; q?: string; department?: string; date: string; dateTo?: string; filters?: ListFilters },
): Promise<WorklistOrder[]> {
  const status: Prisma.OrderTestWhereInput["status"] =
    f.tab === "enter" ? { in: ["IN_LAB", "ENTERED"] } : f.tab === "approve" ? "SUBMITTED" : "APPROVED";
  const q = f.q?.trim();
  const where: Prisma.OrderTestWhereInput = {
    status,
    ...(f.filters?.testId ? { testId: f.filters.testId } : {}),
    order: {
      status: "ACTIVE",
      ...orderFilterWhere(f.filters ?? {}, { tests: false }),
      ...(q
        ? {
            OR: [
              { orderNo: { contains: q } },
              { patient: { name: { contains: q, mode: "insensitive" } } },
              { patient: { uhid: { equals: q.toUpperCase() } } },
            ],
          }
        : {}),
    },
    ...(f.department ? { departmentName: f.department } : {}),
    ...(f.tab === "approved" ? { approvedAt: istDayRange(f.date, f.dateTo) } : {}),
  };

  const rows = await db.orderTest.findMany({
    where,
    orderBy: [{ order: { createdAt: f.tab === "approved" ? "desc" : "asc" } }, { sortOrder: "asc" }],
    take: 500,
    select: {
      id: true,
      code: true,
      name: true,
      departmentName: true,
      status: true,
      results: { where: { flag: { in: ["CRITICAL_LOW", "CRITICAL_HIGH"] } }, select: { flag: true } },
      order: {
        select: {
          id: true,
          orderNo: true,
          createdAt: true,
          doctor: { select: { name: true } },
          account: { select: { name: true } },
          samples: { where: { status: { not: "CANCELLED" } }, orderBy: { barcode: "asc" }, select: { barcode: true } },
          patient: { select: { id: true, uhid: true, salutation: true, name: true, sex: true, dob: true, dobEstimated: true } },
        },
      },
    },
  });

  const byOrder = new Map<string, WorklistOrder>();
  for (const r of rows) {
    const o =
      byOrder.get(r.order.id) ??
      byOrder
        .set(r.order.id, {
          orderId: r.order.id,
          orderNo: r.order.orderNo,
          createdAt: r.order.createdAt.toISOString(),
          patient: { ...r.order.patient, dob: toIsoDate(r.order.patient.dob) },
          doctor: r.order.doctor?.name ?? null,
          account: r.order.account?.name ?? null,
          totalTests: 0,
          approvedTests: 0,
          barcodes: r.order.samples.map((s) => s.barcode),
          tests: [],
        })
        .get(r.order.id)!;
    o.tests.push({
      orderTestId: r.id,
      code: r.code,
      name: r.name,
      department: r.departmentName,
      status: r.status,
      critical: r.results.some((x) => isCritical(x.flag)),
    });
  }
  const counts = await db.orderTest.groupBy({
    by: ["orderId", "status"],
    where: { orderId: { in: [...byOrder.keys()] } },
    _count: { _all: true },
  });
  for (const c of counts) {
    const o = byOrder.get(c.orderId);
    if (!o) continue;
    o.totalTests += c._count._all;
    if (c.status === "APPROVED") o.approvedTests += c._count._all;
  }
  return [...byOrder.values()];
}

// ---------------------------------------------------------------------------
// Report file from an outsourced lab
// ---------------------------------------------------------------------------

const sniffFile = (b: Buffer): string | null => {
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
};

async function outsourcedTest(db: TenantDb, orderTestId: string) {
  const ot = await db.orderTest.findFirst({
    where: { id: orderTestId },
    select: { id: true, orderId: true, code: true, status: true, order: { select: { status: true } }, test: { select: { outsourceLabId: true } } },
  });
  if (!ot) throw notFound("Test not found");
  if (!ot.test.outsourceLabId) throw badRequest("This test isn't outsourced");
  return ot;
}

export async function saveOutsourceFile(db: TenantDb, actor: Actor, orderTestId: string, name: string, body: unknown, addLetterhead = false) {
  const ot = await outsourcedTest(db, orderTestId);
  if (ot.order.status !== "ACTIVE") throw conflict("The order is cancelled");
  if (ot.status === "APPROVED") throw conflict("These results are approved. Reopen them to change the file.");
  if (ot.status === "CANCELLED") throw conflict("This test is cancelled");
  if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest("Choose a PDF, PNG or JPEG file");
  if (body.length > OUTSOURCE_FILE_MAX_BYTES) throw new AppError(413, "too_large", "The file must be under 5 MB");
  const mime = sniffFile(body);
  if (!mime) throw badRequest("Choose a PDF, PNG or JPEG file");
  const clean = name.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "report";
  await db.orderTestFile.deleteMany({ where: { orderTestId } });
  const file = await db.orderTestFile.create({
    data: { tenantId: actor.tenantId, orderTestId, name: clean, mime, size: body.length, data: new Uint8Array(body), addLetterhead, uploadedById: actor.userId },
  });
  await audit({ ...auditMeta(actor), action: "result.outsource_file", entityType: "order_test", entityId: orderTestId, after: { name: file.name, mime: file.mime, size: file.size, addLetterhead } });
  return ot.orderId;
}

/** Switches the outsource letterhead on or off for an uploaded file. */
export async function setOutsourceLetterhead(db: TenantDb, actor: Actor, orderTestId: string, addLetterhead: boolean) {
  const ot = await outsourcedTest(db, orderTestId);
  if (ot.status === "APPROVED") throw conflict("These results are approved. Reopen them to change the file.");
  const done = await db.orderTestFile.updateMany({ where: { orderTestId }, data: { addLetterhead } });
  if (done.count === 0) throw notFound("No file uploaded");
  await audit({ ...auditMeta(actor), action: "result.outsource_letterhead", entityType: "order_test", entityId: orderTestId, after: { addLetterhead } });
  return ot.orderId;
}

export async function removeOutsourceFile(db: TenantDb, actor: Actor, orderTestId: string) {
  const ot = await outsourcedTest(db, orderTestId);
  if (ot.status === "APPROVED") throw conflict("These results are approved. Reopen them to change the file.");
  await db.orderTestFile.deleteMany({ where: { orderTestId } });
  await audit({ ...auditMeta(actor), action: "result.outsource_file_removed", entityType: "order_test", entityId: orderTestId });
  return ot.orderId;
}

export async function readOutsourceFile(db: TenantDb, orderTestId: string) {
  const f = await db.orderTestFile.findFirst({ where: { orderTestId }, select: { name: true, mime: true, data: true } });
  if (!f) throw notFound("No file uploaded");
  return f;
}
