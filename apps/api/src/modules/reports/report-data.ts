import {
  ageOn,
  cultureConfigSchema,
  cultureResultSchema,
  type CultureConfig,
  type CultureResult,
  formatAge,
  formatRange,
  patientDisplayName,
  sampleTypeLabel,
  SEX_LABEL,
  toIsoDate,
  todayIST,
  type ResultFlag,
} from "@lms/shared";
import { prisma } from "../../lib/prisma";
import type { TenantDb } from "../../lib/tenant-db";
import { notFound } from "../../lib/errors";

/** Everything printed on one order's report, already formatted. */
export interface ReportData {
  lab: {
    name: string;
    gstin: string | null;
    phone: string | null;
    email: string | null;
    tagline: string | null;
    address: string | null;
    website: string | null;
    accreditation: string | null;
    logoId: string | null;
  };
  branch: { name: string; address: string | null; phone: string | null } | null;
  patient: { name: string; uhid: string; ageSex: string; phone: string | null };
  /** Every detail the report header can print, already formatted, by field key (see REPORT_HEADER_FIELDS). */
  headerValues: Record<string, string | null>;
  order: { orderNo: string; registeredAt: string; doctor: string | null };
  collectedAt: string | null;
  receivedAt: string | null;
  reportedAt: string | null;
  /** Some tests are still pending, so only approved ones are printed. */
  partial: boolean;
  amended: boolean;
  departments: ReportDepartment[];
  signatories: Signatory[];
}

export interface Signatory {
  name: string;
  qualification: string | null;
  registrationNo: string | null;
  signatureId: string | null;
  stampId: string | null;
}

export interface ReportDepartment {
  name: string;
  tests: ReportTest[];
}

export interface ReportTest {
  code: string;
  name: string;
  amended: boolean;
  remarks: string | null;
  notes: string | null;
  /** Clinical interpretation printed after the results. */
  interpretation?: string | null;
  rows: { name: string; value: string; unit: string | null; flag: ResultFlag | null; range: string; method?: string | null }[];
  /** Culture & sensitivity tests print this instead of rows. */
  culture?: { result: CultureResult; config: CultureConfig; sample: string | null };
}

const IST = "Asia/Kolkata";
const dateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});
export const formatDateTimeIST = (d: Date) => dateTime.format(d);

const earliest = (dates: (Date | null)[]) =>
  dates.filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
const latest = (dates: (Date | null)[]) =>
  dates.filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

export async function loadReport(db: TenantDb, tenantId: string, orderId: string): Promise<ReportData> {
  const order = await db.order.findFirst({
    where: { id: orderId },
    select: {
      orderNo: true,
      createdAt: true,
      status: true,
      doctor: { select: { name: true } },
      branch: { select: { name: true, address: true, phone: true } },
      patient: {
        select: {
          uhid: true, salutation: true, name: true, sex: true, dob: true, phone: true,
          email: true, address: true, city: true, state: true, district: true, pincode: true, country: true,
          passportNumber: true, patientType: true,
        },
      },
      tests: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { sortOrder: "asc" },
        select: {
          code: true,
          name: true,
          departmentName: true,
          status: true,
          remarks: true,
          approvedAt: true,
          approvedById: true,
          amendedAt: true,
          sample: { select: { collectedAt: true, receivedAt: true, barcode: true } },
          sampleType: true,
          culture: true,
          test: { select: { reportNotes: true, interpretation: true, reportKind: true, cultureConfig: true } },
          results: {
            orderBy: { sortOrder: "asc" },
            select: { name: true, value: true, unit: true, flag: true, decimals: true, refLow: true, refHigh: true, refText: true, parameter: { select: { method: true } } },
          },
        },
      },
    },
  });
  if (!order || order.status === "CANCELLED") throw notFound("Report not found");

  const lab = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { name: true, gstin: true, phone: true, email: true, tagline: true, address: true, website: true, accreditation: true, logoId: true },
  });

  const approved = order.tests.filter((t) => t.status === "APPROVED");
  const approverIds = [...new Set(approved.map((t) => t.approvedById).filter((x): x is string => !!x))];
  const approvers = approverIds.length
    ? await db.user.findMany({
        where: { id: { in: approverIds } },
        select: { id: true, name: true, qualification: true, registrationNo: true, signatureId: true, stampId: true },
      })
    : [];

  const departments: ReportDepartment[] = [];
  for (const t of approved) {
    const cultureResult = t.test.reportKind === "CULTURE" && t.culture ? cultureResultSchema.safeParse(t.culture) : null;
    const cultureConfig = t.test.reportKind === "CULTURE" && t.test.cultureConfig ? cultureConfigSchema.safeParse(t.test.cultureConfig) : null;
    let dept = departments.find((d) => d.name === t.departmentName);
    if (!dept) departments.push((dept = { name: t.departmentName, tests: [] }));
    dept.tests.push({
      code: t.code,
      name: t.name,
      amended: !!t.amendedAt,
      remarks: t.remarks,
      notes: t.test.reportNotes,
      interpretation: t.test.interpretation,
      ...(cultureResult?.success && cultureConfig?.success
        ? { culture: { result: cultureResult.data, config: cultureConfig.data, sample: sampleTypeLabel(t.sampleType) } }
        : {}),
      rows: t.results
        .filter((r) => r.value != null && r.value !== "")
        .map((r) => ({
          name: r.name,
          value: r.value!,
          unit: r.unit,
          flag: r.flag,
          range: formatRange({ low: r.refLow, high: r.refHigh, text: r.refText }, r.decimals),
          method: r.parameter.method,
        })),
    });
  }

  const at = (d: Date | null) => (d ? formatDateTimeIST(d) : null);
  const dob = toIsoDate(order.patient.dob);
  const p = order.patient;
  const ageSex = `${formatAge(ageOn(dob, todayIST(order.createdAt)))} / ${SEX_LABEL[p.sex]}`;
  const collectedAt = at(earliest(approved.map((t) => t.sample?.collectedAt ?? null)));
  const receivedAt = at(earliest(approved.map((t) => t.sample?.receivedAt ?? null)));
  const reportedAt = at(latest(approved.map((t) => t.approvedAt)));
  const partial = approved.length < order.tests.length;
  const barcodes = [...new Set(order.tests.map((t) => t.sample?.barcode).filter((b): b is string => !!b))];
  const headerValues: Record<string, string | null> = {
    name: patientDisplayName(p),
    ageSex,
    uhid: p.uhid,
    doctor: order.doctor?.name ?? "Self",
    patientType: p.patientType,
    phone: p.phone,
    email: p.email,
    address: p.address,
    city: p.city,
    state: p.state,
    district: p.district,
    pincode: p.pincode,
    country: p.country,
    passportNumber: p.passportNumber,
    orderNo: order.orderNo,
    barcode: barcodes.length ? barcodes.join(", ") : null,
    branch: order.branch?.name ?? null,
    registeredAt: formatDateTimeIST(order.createdAt),
    collectedAt,
    receivedAt,
    reportedAt,
    reportStatus: partial ? "Partial" : "Final",
  };
  return {
    lab,
    headerValues,
    branch: order.branch,
    patient: {
      name: patientDisplayName(order.patient),
      uhid: order.patient.uhid,
      ageSex: `${formatAge(ageOn(dob, todayIST(order.createdAt)))} / ${SEX_LABEL[order.patient.sex]}`,
      phone: order.patient.phone,
    },
    order: { orderNo: order.orderNo, registeredAt: formatDateTimeIST(order.createdAt), doctor: order.doctor?.name ?? null },
    collectedAt: at(earliest(approved.map((t) => t.sample?.collectedAt ?? null))),
    receivedAt: at(earliest(approved.map((t) => t.sample?.receivedAt ?? null))),
    reportedAt: at(latest(approved.map((t) => t.approvedAt))),
    partial: approved.length < order.tests.length,
    amended: approved.some((t) => !!t.amendedAt),
    departments,
    signatories: approverIds
      .map((id) => approvers.find((u) => u.id === id))
      .filter((u): u is NonNullable<typeof u> => !!u)
      .map(({ name, qualification, registrationNo, signatureId, stampId }) => ({ name, qualification, registrationNo, signatureId, stampId })),
  };
}
