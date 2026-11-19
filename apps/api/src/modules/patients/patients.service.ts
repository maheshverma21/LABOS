import type { Prisma } from "@prisma/client";
import { hasFilters, orderFilterWhere } from "../../lib/list-filters";
import type { ListFilters } from "@lms/shared";
import {
  todayIST,
  toIsoDate,
  type DuplicatePatientDetails,
  type PatientDetail,
  type PatientListItem,
  type PatientOutput,
  type PatientPage,
} from "@lms/shared";
import type { TenantDb } from "../../lib/tenant-db";
import { audit } from "../../lib/audit";
import { nextNumber } from "../../lib/counter";
import { AppError, notFound } from "../../lib/errors";

export interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
  ip: string | null;
  userAgent: string | null;
}

const auditMeta = (a: Actor) => ({ tenantId: a.tenantId, actorId: a.userId, ip: a.ip, userAgent: a.userAgent });

const listSelect = {
  id: true,
  uhid: true,
  salutation: true,
  name: true,
  sex: true,
  dob: true,
  dobEstimated: true,
  phone: true,
  createdAt: true,
} satisfies Prisma.PatientSelect;

type ListRow = Prisma.PatientGetPayload<{ select: typeof listSelect }>;

const toListItem = (p: ListRow): PatientListItem => ({
  ...p,
  dob: toIsoDate(p.dob),
  createdAt: p.createdAt.toISOString(),
});

const dbDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Patient ID: the registration date (YYMMDD, India time) plus that day's running number,
 * starting at 01 each day: 26111801, 26111802, ... (3 digits after 99).
 */
const uhidDay = () => todayIST().slice(2).replace(/-/g, "");
const uhidKey = (day: string) => `patient_uhid:${day}`;
export const formatUhid = (day: string, n: number) => `${day}${String(n).padStart(2, "0")}`;

/** The ID the next patient will get. Only a preview: the number is issued when the patient is saved. */
export async function peekNextUhid(db: TenantDb): Promise<string> {
  const day = uhidDay();
  const row = await db.counter.findFirst({ where: { key: uhidKey(day) }, select: { value: true } });
  return formatUhid(day, (row?.value ?? 0) + 1);
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

const TITLES = new Set(["mr", "mrs", "ms", "miss", "master", "baby", "dr", "smt", "shri", "kumari"]);

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !TITLES.has(t));
}

/**
 * "Asha Rao" ~ "asha  rao", "Asha R Rao", "Asha"; not "Ravi Rao" (a family member on
 * the same phone). First names must match; the rest may be missing or abbreviated.
 */
export function namesLookAlike(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length || ta[0] !== tb[0]) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.slice(1).every((t) => long.slice(1).some((u) => u === t || (t.length === 1 && u.startsWith(t))));
}

async function findLikelyDuplicates(db: TenantDb, input: PatientOutput, excludeId?: string): Promise<ListRow[]> {
  const first = nameTokens(input.name)[0];
  if (!first) return [];
  const or: Prisma.PatientWhereInput[] = [
    // Same phone, similar name (one phone is often shared by a family).
    ...(input.phone ? [{ phone: input.phone }] : []),
    // Same birth date, similar name (catches a different or missing phone).
    { dob: dbDate(input.dob), name: { contains: first, mode: "insensitive" as const } },
  ];
  const rows = await db.patient.findMany({
    where: { isActive: true, OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: listSelect,
    take: 50,
  });
  return rows.filter((r) => namesLookAlike(r.name, input.name)).slice(0, 5);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function searchPatients(
  db: TenantDb,
  q: string | undefined,
  page: number,
  pageSize: number,
  filters: ListFilters = {},
): Promise<PatientPage> {
  const term = q?.trim() ?? "";
  let where: Prisma.PatientWhereInput = { isActive: true, ...(hasFilters(filters) ? { orders: { some: { status: "ACTIVE", ...orderFilterWhere(filters) } } } : {}) };

  if (term) {
    const digits = term.replace(/\D/g, "");
    if (/^p?\d+$/i.test(term.replace(/\s/g, "")) && digits.length <= 8) {
      // Patient ID: "26111801", a part of it, or an older "P000123" / "p123"
      where = { ...where, OR: [{ uhid: { contains: digits } }, { uhid: { endsWith: digits.padStart(6, "0") } }, { phone: { contains: digits } }] };
    } else if (digits.length >= 4 && digits.length === term.replace(/[\s+\-()]/g, "").length) {
      where = { ...where, phone: { contains: digits.slice(-10) } };
    } else {
      // Every word must appear in the name, in any order.
      where = {
        ...where,
        AND: term
          .split(/\s+/)
          .filter(Boolean)
          .map((w) => ({ name: { contains: w, mode: "insensitive" as const } })),
      };
    }
  }

  const [rows, total] = await Promise.all([
    db.patient.findMany({
      where,
      select: listSelect,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.patient.count({ where }),
  ]);
  return { patients: rows.map(toListItem), total, page, pageSize };
}

export async function patientsByPhone(db: TenantDb, phone: string): Promise<PatientListItem[]> {
  const rows = await db.patient.findMany({
    where: { phone, isActive: true },
    select: listSelect,
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  return rows.map(toListItem);
}

export async function getPatient(db: TenantDb, id: string): Promise<PatientDetail> {
  const p = await db.patient.findFirst({
    where: { id, isActive: true },
    include: { registeredBranch: { select: { id: true, name: true } } },
  });
  if (!p) throw notFound("Patient not found");
  return {
    id: p.id,
    uhid: p.uhid,
    salutation: p.salutation,
    name: p.name,
    sex: p.sex,
    dob: toIsoDate(p.dob),
    dobEstimated: p.dobEstimated,
    phone: p.phone,
    altPhone: p.altPhone,
    email: p.email,
    address: p.address,
    city: p.city,
    pincode: p.pincode,
    abhaNumber: p.abhaNumber,
    abhaAddress: p.abhaAddress,
    patientType: p.patientType,
    phoneBelongsTo: p.phoneBelongsTo,
    organisation: p.organisation,
    referral: p.referral,
    state: p.state,
    district: p.district,
    passportNumber: p.passportNumber,
    barcode: p.barcode,
    country: p.country,
    notes: p.notes,
    consentAt: p.consentAt?.toISOString() ?? null,
    registeredBranch: p.registeredBranch,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Patient records are health data: log who opened which record. */
export function auditView(actor: Actor, patientId: string) {
  void audit({ ...auditMeta(actor), action: "patient.view", entityType: "patient", entityId: patientId });
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function patientData(input: PatientOutput) {
  return {
    salutation: input.salutation,
    name: input.name,
    sex: input.sex,
    dob: dbDate(input.dob),
    dobEstimated: input.dobEstimated,
    phone: input.phone,
    altPhone: input.altPhone,
    email: input.email,
    address: input.address,
    city: input.city,
    pincode: input.pincode,
    abhaNumber: input.abhaNumber,
    abhaAddress: input.abhaAddress,
    patientType: input.patientType,
    phoneBelongsTo: input.phoneBelongsTo,
    organisation: input.organisation,
    referral: input.referral,
    state: input.state,
    district: input.district,
    passportNumber: input.passportNumber,
    barcode: input.barcode,
    country: input.country,
    notes: input.notes,
  };
}

export async function createPatient(
  db: TenantDb,
  actor: Actor,
  input: PatientOutput & { allowDuplicate: boolean },
): Promise<PatientDetail> {
  if (!input.allowDuplicate) {
    const candidates = await findLikelyDuplicates(db, input);
    if (candidates.length) {
      const details: DuplicatePatientDetails = { candidates: candidates.map(toListItem) };
      throw new AppError(
        409,
        "possible_duplicate",
        "This patient may already be registered",
        undefined,
        details,
      );
    }
  }

  const id = await db.$transaction(async (tx) => {
    const day = uhidDay();
    const uhid = formatUhid(day, await nextNumber(tx, actor.tenantId, uhidKey(day)));
    const created = await tx.patient.create({
      data: {
        tenantId: actor.tenantId,
        uhid,
        ...patientData(input),
        consentAt: new Date(),
        registeredBranchId: actor.branchId,
        createdById: actor.userId,
      },
      select: { id: true, uhid: true },
    });
    await audit(
      {
        ...auditMeta(actor),
        action: "patient.create",
        entityType: "patient",
        entityId: created.id,
        after: { uhid, ...input, consent: true } as unknown as Prisma.InputJsonValue,
      },
      tx,
    );
    return created.id;
  });

  return getPatient(db, id);
}

export async function updatePatient(db: TenantDb, actor: Actor, id: string, input: PatientOutput): Promise<PatientDetail> {
  const before = await getPatient(db, id);
  const data = patientData(input);

  // Store only what changed in the audit log.
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(data)) {
    const prev = (before as unknown as Record<string, unknown>)[key];
    const next = value instanceof Date ? toIsoDate(value) : value;
    if (prev !== next) changed[key] = { from: prev, to: next };
  }
  if (Object.keys(changed).length === 0) return before;

  await db.$transaction(async (tx) => {
    await tx.patient.update({ where: { id }, data });
    await audit(
      {
        ...auditMeta(actor),
        action: "patient.update",
        entityType: "patient",
        entityId: id,
        before: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.from])) as Prisma.InputJsonValue,
        after: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.to])) as Prisma.InputJsonValue,
      },
      tx,
    );
  });
  return getPatient(db, id);
}
