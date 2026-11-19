import {
  ASSET_LABEL,
  ASSET_MAX_BYTES,
  DEFAULT_BILL_SETTINGS,
  DEFAULT_TEMPLATE,
  REPORT_FONTS,
  type ReportFontId,
  type BillSettings,
  type ReportDoctorItem,
  type ReportDoctorValues,
  type DoctorAlignment,
  type DoctorMode,
  type DoctorPosition,
  type AssetInfo,
  type AssetKind,
  type ReportTemplateItem,
  type ReportTemplateValues,
} from "@lms/shared";
import { readReportHeader } from "../reports/report-header";
import { prisma } from "../../lib/prisma";
import type { TenantDb } from "../../lib/tenant-db";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors";
import { embedsInPdf, MAX_IMAGE_SIDE, sniffImage } from "../../lib/images";
import type { PdfImage, ReportLook } from "../reports/report-pdf";
import type { ReportData } from "../reports/report-data";

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** Checks an uploaded file and stores it. The body is the raw image bytes. */
export async function storeAsset(tenantId: string, kind: AssetKind, body: unknown, actorId: string | null): Promise<AssetInfo> {
  if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest("Upload a PNG or JPEG image");
  const max = ASSET_MAX_BYTES[kind];
  if (body.length > max) {
    throw new AppError(413, "too_large", `${ASSET_LABEL[kind]} images must be under ${Math.round(max / 1024)} KB. Save it smaller and try again.`);
  }
  const info = sniffImage(body);
  if (!info) throw badRequest("Upload a PNG or JPEG image");
  if (info.width < 16 || info.height < 16) throw badRequest("That image is too small to print clearly");
  if (info.width > MAX_IMAGE_SIDE || info.height > MAX_IMAGE_SIDE) {
    throw badRequest(`That image is too large; keep it under ${MAX_IMAGE_SIDE} pixels on each side`);
  }
  if (!(await embedsInPdf(body, info.format))) throw badRequest("That image can't be printed in a PDF. Save it again as a PNG or JPEG and retry.");
  const asset = await prisma.labAsset.create({
    data: { tenantId, kind, mime: info.mime, width: info.width, height: info.height, data: new Uint8Array(body), createdById: actorId },
    select: { id: true, kind: true, width: true, height: true },
  });
  return asset;
}

export async function readAsset(db: TenantDb, id: string) {
  const asset = await db.labAsset.findFirst({ where: { id }, select: { mime: true, data: true } });
  if (!asset) throw notFound("Image not found");
  return asset;
}

/** Deletes an image nothing points at any more (after it was replaced or removed). */
export async function deleteIfUnused(tenantId: string, id: string | null | undefined) {
  if (!id) return;
  const [lab, users, doctors, templates] = await Promise.all([
    prisma.tenant.count({ where: { id: tenantId, OR: [{ logoId: id }, { billHeaderImageId: id }, { billFooterImageId: id }] } }),
    prisma.user.count({ where: { tenantId, OR: [{ signatureId: id }, { stampId: id }] } }),
    prisma.reportDoctor.count({ where: { tenantId, signatureId: id } }),
    prisma.reportTemplate.count({ where: { tenantId, OR: [{ headerImageId: id }, { footerImageId: id }, { backgroundImageId: id }, { outsourceHeaderImageId: id }, { outsourceFooterImageId: id }] } }),
  ]);
  if (lab + users + doctors + templates === 0) await prisma.labAsset.deleteMany({ where: { id, tenantId } });
}

/** Header and footer images uploaded in the template editor but never saved into a template. */
async function deleteAbandonedLetterheads(tenantId: string) {
  const used = await prisma.reportTemplate.findMany({ where: { tenantId }, select: { headerImageId: true, footerImageId: true, backgroundImageId: true, outsourceHeaderImageId: true, outsourceFooterImageId: true } });
  const docs = await prisma.reportDoctor.findMany({ where: { tenantId }, select: { signatureId: true } });
  const bill = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { billHeaderImageId: true, billFooterImageId: true } });
  const keep = [...docs.map((d) => d.signatureId), bill?.billHeaderImageId, bill?.billFooterImageId, ...used.flatMap((t) => [t.headerImageId, t.footerImageId, t.backgroundImageId, t.outsourceHeaderImageId, t.outsourceFooterImageId])].filter((x): x is string => !!x);
  await prisma.labAsset.deleteMany({
    where: { tenantId, kind: { in: ["HEADER", "FOOTER", "BACKGROUND", "DOCTOR_SIGNATURE"] }, id: { notIn: keep }, createdAt: { lt: new Date(Date.now() - 3_600_000) } },
  });
}

// Images never change once stored (a new upload is a new id), so they can be cached freely.
const cache = new Map<string, PdfImage>();
const CACHE_LIMIT = 200;

async function pdfImages(tenantId: string, ids: (string | null | undefined)[]): Promise<Map<string, PdfImage>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, PdfImage>();
  const missing = wanted.filter((id) => {
    const hit = cache.get(`${tenantId}:${id}`);
    if (hit) out.set(id, hit);
    return !hit;
  });
  if (missing.length) {
    const rows = await prisma.labAsset.findMany({ where: { tenantId, id: { in: missing } }, select: { id: true, mime: true, data: true } });
    for (const r of rows) {
      const img: PdfImage = { data: Buffer.from(r.data), format: r.mime === "image/png" ? "png" : "jpg" };
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      cache.set(`${tenantId}:${r.id}`, img);
      out.set(r.id, img);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Report templates
// ---------------------------------------------------------------------------

const templateSelect = {
  id: true,
  name: true,
  isDefault: true,
  style: true,
  headerImageId: true,
  footerImageId: true,
  backgroundImageId: true,
  leftMarginMm: true,
  rightMarginMm: true,
  outsourceHeaderImageId: true,
  outsourceFooterImageId: true,
  outsourceFooterHeightMm: true,
  headerHeightMm: true,
  footerHeightMm: true,
  accentColor: true,
  fontFamily: true,
  lowColor: true,
  highColor: true,
  showLogo: true,
  showSignatures: true,
  showQr: true,
  footerNote: true,
  updatedAt: true,
} as const;

type TemplateRow = { updatedAt: Date; fontFamily: string } & Omit<ReportTemplateItem, "updatedAt" | "fontFamily">;
const toItem = (t: TemplateRow): ReportTemplateItem => ({
  ...t,
  // A font id the app no longer knows prints (and shows) as the default.
  fontFamily: REPORT_FONTS.some((f) => f.id === t.fontFamily) ? (t.fontFamily as ReportFontId) : "helvetica",
  updatedAt: t.updatedAt.toISOString(),
});

export async function listTemplates(db: TenantDb, tenantId: string): Promise<ReportTemplateItem[]> {
  let rows = await db.reportTemplate.findMany({ where: { accountId: null }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: templateSelect });
  if (rows.length === 0) {
    // Every lab starts with one template, made from its profile.
    await db.reportTemplate.create({ data: { tenantId, ...DEFAULT_TEMPLATE, isDefault: true } });
    rows = await db.reportTemplate.findMany({ where: { accountId: null }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: templateSelect });
  }
  return rows.map(toItem);
}

/** Header and footer images must be this lab's, and of the right kind. */
async function checkImages(db: TenantDb, v: ReportTemplateValues) {
  for (const [field, kind] of [
    ["headerImageId", "HEADER"],
    ["footerImageId", "FOOTER"],
    ["backgroundImageId", "BACKGROUND"],
    ["outsourceHeaderImageId", "HEADER"],
    ["outsourceFooterImageId", "FOOTER"],
  ] as const) {
    const id = v[field];
    if (id && !(await db.labAsset.findFirst({ where: { id, kind }, select: { id: true } }))) {
      throw badRequest("Upload the image again", { [field]: ["Upload the image again"] });
    }
  }
}

export async function createTemplate(db: TenantDb, tenantId: string, v: ReportTemplateValues): Promise<ReportTemplateItem> {
  await checkImages(db, v);
  if ((await db.reportTemplate.count()) >= 20) throw conflict("A lab can keep up to 20 templates. Delete one you no longer use.");
  const isDefault = (await db.reportTemplate.count()) === 0;
  const row = await db.reportTemplate.create({ data: { tenantId, ...v, isDefault }, select: templateSelect });
  await deleteAbandonedLetterheads(tenantId);
  return toItem(row);
}

export async function updateTemplate(db: TenantDb, tenantId: string, id: string, v: ReportTemplateValues) {
  const before = await db.reportTemplate.findFirst({ where: { id }, select: templateSelect });
  if (!before) throw notFound("Template not found");
  await checkImages(db, v);
  const row = await db.reportTemplate.update({ where: { id }, data: v, select: templateSelect });
  const ids = (t: typeof row) => [t.headerImageId, t.footerImageId, t.backgroundImageId, t.outsourceHeaderImageId, t.outsourceFooterImageId];
  for (const old of ids(before)) {
    if (old && !ids(row).includes(old)) await deleteIfUnused(tenantId, old);
  }
  await deleteAbandonedLetterheads(tenantId);
  return { before: toItem(before), template: toItem(row) };
}

export async function deleteTemplate(db: TenantDb, tenantId: string, id: string) {
  const t = await db.reportTemplate.findFirst({ where: { id }, select: templateSelect });
  if (!t) throw notFound("Template not found");
  if (t.isDefault) throw conflict("This is the default template. Make another one the default first.");
  await db.reportTemplate.delete({ where: { id } });
  await deleteIfUnused(tenantId, t.headerImageId);
  await deleteIfUnused(tenantId, t.footerImageId);
  await deleteIfUnused(tenantId, t.backgroundImageId);
  await deleteIfUnused(tenantId, t.outsourceHeaderImageId);
  await deleteIfUnused(tenantId, t.outsourceFooterImageId);
  return toItem(t);
}

export async function setDefaultTemplate(db: TenantDb, id: string) {
  const t = await db.reportTemplate.findFirst({ where: { id }, select: { id: true, name: true } });
  if (!t) throw notFound("Template not found");
  await db.reportTemplate.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
  await db.reportTemplate.update({ where: { id }, data: { isDefault: true } });
  return t;
}

/**
 * How one report should look. Staff can pick any template; without one the
 * lab's default is used. Copies sent to patients (link, WhatsApp) are viewed on
 * screen, so a pre-printed-paper template is drawn as the built-in letterhead there.
 */
export async function lookFor(
  tenantId: string,
  data: Pick<ReportData, "lab" | "signatories">,
  opts: { templateId?: string | null; digital?: boolean; template?: ReportTemplateValues; letterhead?: boolean; outsource?: boolean; doctorIds?: string[] } = {},
): Promise<ReportLook> {
  let template: ReportTemplateValues = opts.template ?? DEFAULT_TEMPLATE;
  if (!opts.template) {
    const row = await prisma.reportTemplate.findFirst({
      where: { tenantId, ...(opts.templateId ? { id: opts.templateId } : { isDefault: true }) },
      select: templateSelect,
    });
    if (opts.templateId && !row) throw notFound("Template not found");
    if (row) template = { ...row, fontFamily: row.fontFamily as ReportFontId };
  }
  // "Outsource report": the outsource header and footer images take the place of the usual ones.
  if (opts.outsource) {
    if (!template.outsourceHeaderImageId) {
      throw badRequest("Upload an outsource report header first (Lab profile, Report Details).");
    }
    template = {
      ...template,
      style: "IMAGE",
      headerImageId: template.outsourceHeaderImageId,
      footerImageId: template.outsourceFooterImageId,
      footerHeightMm: template.outsourceFooterHeightMm,
    };
  }
  // A background image is the whole letterhead: the page keeps blank margins (the header and footer heights) for the content.
  if (opts.outsource) template = { ...template, backgroundImageId: null };
  else if (template.backgroundImageId) template = { ...template, style: "PREPRINTED" };
  if (opts.digital && template.style === "PREPRINTED" && !template.backgroundImageId) template = { ...template, style: "BUILT_IN" };
  // "Print without letterhead": the same layout with the top and bottom left blank, for letterhead paper.
  if (opts.letterhead === false) template = { ...template, style: "PREPRINTED", backgroundImageId: null };
  // Report doctors: the fixed ones always, the others only when picked for this print.
  const picked = new Set(opts.doctorIds ?? []);
  const doctorRows = (await prisma.reportDoctor.findMany({ where: { tenantId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: doctorSelect })).map(toDoctor);
  const chosen = doctorRows.filter((d) => d.mode === "FIXED" || picked.has(d.id));
  const images = await pdfImages(tenantId, [
    ...chosen.map((d) => d.signatureId),
    data.lab.logoId,
    template.headerImageId,
    template.footerImageId,
    template.backgroundImageId,
    ...data.signatories.flatMap((p) => [p.signatureId, p.stampId]),
  ]);
  const get = (id: string | null) => (id ? (images.get(id) ?? null) : null);
  return { template, logo: get(data.lab.logoId), header: get(template.headerImageId), footer: get(template.footerImageId), background: get(template.backgroundImageId),
    doctors: chosen.map((d) => ({ ...d, signature: get(d.signatureId) })),
    hasDoctors: doctorRows.length > 0,
    headerFields: await readReportHeader(tenantId),
    images,
  };
}

// ---------------------------------------------------------------------------
// Bill print settings
// ---------------------------------------------------------------------------

const billSelect = {
  billCustom: true,
  billHeading: true,
  billSize: true,
  billHeaderImageId: true,
  billFooterImageId: true,
  billHeaderHeightMm: true,
  billFooterHeightMm: true,
} as const;

type BillRow = {
  billCustom: boolean;
  billHeading: string;
  billSize: string;
  billHeaderImageId: string | null;
  billFooterImageId: string | null;
  billHeaderHeightMm: number;
  billFooterHeightMm: number;
};

const toBill = (t: BillRow): BillSettings => ({
  custom: t.billCustom,
  heading: t.billHeading || DEFAULT_BILL_SETTINGS.heading,
  size: t.billSize === "A5" ? "A5" : "A4",
  headerImageId: t.billHeaderImageId,
  footerImageId: t.billFooterImageId,
  headerHeightMm: t.billHeaderHeightMm,
  footerHeightMm: t.billFooterHeightMm,
});

export async function getBillSettings(tenantId: string): Promise<BillSettings> {
  return toBill(await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: billSelect }));
}

export async function updateBillSettings(db: TenantDb, tenantId: string, v: BillSettings) {
  for (const [field, kind] of [
    ["headerImageId", "HEADER"],
    ["footerImageId", "FOOTER"],
  ] as const) {
    const id = v[field];
    if (id && !(await db.labAsset.findFirst({ where: { id, kind }, select: { id: true } }))) {
      throw badRequest("Upload the image again", { [field]: ["Upload the image again"] });
    }
  }
  const before = await getBillSettings(tenantId);
  const row = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      billCustom: v.custom,
      billHeading: v.heading,
      billSize: v.size,
      billHeaderImageId: v.headerImageId,
      billFooterImageId: v.footerImageId,
      billHeaderHeightMm: v.headerHeightMm,
      billFooterHeightMm: v.footerHeightMm,
    },
    select: billSelect,
  });
  const now = toBill(row);
  for (const old of [before.headerImageId, before.footerImageId]) {
    if (old && old !== now.headerImageId && old !== now.footerImageId) await deleteIfUnused(tenantId, old);
  }
  await deleteAbandonedLetterheads(tenantId);
  return { before, settings: now };
}

// ---------------------------------------------------------------------------
// Report doctors
// ---------------------------------------------------------------------------

const doctorSelect = {
  id: true,
  name: true,
  degree: true,
  signatureId: true,
  hideName: true,
  position: true,
  nameFontSize: true,
  degreeFontSize: true,
  signatureSize: true,
  spacing: true,
  nameDegreeSpacing: true,
  alignment: true,
  mode: true,
  endOfReport: true,
  departments: true,
} as const;

type DoctorRow = Omit<ReportDoctorItem, "position" | "alignment" | "mode"> & { position: string; alignment: string; mode: string };
/** Stored as text: "0".."100", or the older LEFT / MIDDLE / RIGHT. */
const LEGACY_POSITION: Record<string, number> = { LEFT: 0, MIDDLE: 50, RIGHT: 100 };
const parsePosition = (v: string): DoctorPosition => {
  if (v in LEGACY_POSITION) return LEGACY_POSITION[v]!;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 100;
};

const toDoctor = (r: DoctorRow): ReportDoctorItem => ({
  ...r,
  position: parsePosition(r.position),
  alignment: (["LEFT", "CENTER", "RIGHT"].includes(r.alignment) ? r.alignment : "RIGHT") as DoctorAlignment,
  mode: (r.mode === "SELECT" ? "SELECT" : "FIXED") as DoctorMode,
});

export async function listReportDoctors(db: TenantDb): Promise<ReportDoctorItem[]> {
  const rows = await db.reportDoctor.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: doctorSelect });
  return rows.map(toDoctor);
}

async function checkSignature(db: TenantDb, v: ReportDoctorValues) {
  if (v.signatureId && !(await db.labAsset.findFirst({ where: { id: v.signatureId, kind: "DOCTOR_SIGNATURE" }, select: { id: true } }))) {
    throw badRequest("Upload the signature again", { signatureId: ["Upload the signature again"] });
  }
}

export async function createReportDoctor(db: TenantDb, tenantId: string, v: ReportDoctorValues) {
  await checkSignature(db, v);
  const count = await db.reportDoctor.count();
  if (count >= 12) throw conflict("A lab can keep up to 12 report doctors. Remove one you no longer use.");
  const row = await db.reportDoctor.create({ data: { tenantId, ...v, position: String(v.position), sortOrder: count }, select: doctorSelect });
  await deleteAbandonedLetterheads(tenantId);
  return toDoctor(row);
}

export async function updateReportDoctor(db: TenantDb, tenantId: string, id: string, v: ReportDoctorValues) {
  const before = await db.reportDoctor.findFirst({ where: { id }, select: doctorSelect });
  if (!before) throw notFound("Doctor not found");
  await checkSignature(db, v);
  const row = await db.reportDoctor.update({ where: { id }, data: { ...v, position: String(v.position) }, select: doctorSelect });
  if (before.signatureId && before.signatureId !== row.signatureId) await deleteIfUnused(tenantId, before.signatureId);
  await deleteAbandonedLetterheads(tenantId);
  return { before: toDoctor(before), doctor: toDoctor(row) };
}

export async function deleteReportDoctor(db: TenantDb, tenantId: string, id: string) {
  const d = await db.reportDoctor.findFirst({ where: { id }, select: doctorSelect });
  if (!d) throw notFound("Doctor not found");
  await db.reportDoctor.delete({ where: { id } });
  await deleteIfUnused(tenantId, d.signatureId);
  return toDoctor(d);
}

/** The outsource header and footer (Report Details) that are printed over an outsourced lab's report file. */
export async function outsourceLetterhead(tenantId: string) {
  const t = await prisma.reportTemplate.findFirst({
    where: { tenantId, isDefault: true },
    select: { outsourceHeaderImageId: true, outsourceFooterImageId: true, headerHeightMm: true, outsourceFooterHeightMm: true },
  });
  if (!t) return null;
  const images = await pdfImages(tenantId, [t.outsourceHeaderImageId, t.outsourceFooterImageId]);
  return {
    header: t.outsourceHeaderImageId ? (images.get(t.outsourceHeaderImageId) ?? null) : null,
    footer: t.outsourceFooterImageId ? (images.get(t.outsourceFooterImageId) ?? null) : null,
    headerMm: t.headerHeightMm,
    footerMm: t.outsourceFooterHeightMm,
  };
}
