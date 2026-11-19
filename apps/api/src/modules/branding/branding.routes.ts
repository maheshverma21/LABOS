import express, { Router, type Request } from "express";
import {
  PERSONAL_ASSETS,
  DEFAULT_TEMPLATE,
  labLetterheadSchema,
  billSettingsSchema,
  reportDoctorSchema,
  reportTemplateSchema,
  type ReportDoctorValues,
  type BillSettings,
  updateUserSchema,
  type MyProfile,
  type PersonalAssetSlug,
  type ReportTemplateValues,
} from "@lms/shared";
import type { z } from "zod";
import { authenticate, ctx, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { audit } from "../../lib/audit";
import { badRequest, notFound } from "../../lib/errors";
import { rateLimit } from "../../lib/rate-limit";
import type { TenantDb } from "../../lib/tenant-db";
import { renderReportPdf } from "../reports/report-pdf";
import { sampleReport } from "./sample-report";
import * as branding from "./branding.service";

/** Images arrive as the raw file body (Content-Type image/png or image/jpeg). */
const rawImage = express.raw({ type: ["image/png", "image/jpeg"], limit: "5mb" });

const meta = (req: Request) => {
  const { auth } = ctx(req);
  return { tenantId: auth.tenantId, actorId: auth.userId, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
};

/** A lab can't fill its database with images by retrying in a loop. */
const uploadLimit = (req: Request) => rateLimit(`upload:${ctx(req).auth.userId}`, 30, 10 * 60);

// ---------------------------------------------------------------------------
// /api/lab: logo, letterhead images, report templates
// ---------------------------------------------------------------------------

export const brandingRouter = Router();
brandingRouter.use(authenticate);

const settings = requirePermission("settings:write");

brandingRouter.put("/logo", settings, rawImage, async (req, res) => {
  const { auth } = ctx(req);
  await uploadLimit(req);
  const asset = await branding.storeAsset(auth.tenantId, "LOGO", req.body, auth.userId);
  const before = await prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { logoId: true } });
  await prisma.tenant.update({ where: { id: auth.tenantId }, data: { logoId: asset.id } });
  await branding.deleteIfUnused(auth.tenantId, before.logoId);
  await audit({ ...meta(req), action: "lab.logo", entityType: "tenant", entityId: auth.tenantId, after: { logoId: asset.id } });
  res.json({ asset });
});

brandingRouter.delete("/logo", settings, async (req, res) => {
  const { auth } = ctx(req);
  const before = await prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { logoId: true } });
  await prisma.tenant.update({ where: { id: auth.tenantId }, data: { logoId: null } });
  await branding.deleteIfUnused(auth.tenantId, before.logoId);
  await audit({ ...meta(req), action: "lab.logo_removed", entityType: "tenant", entityId: auth.tenantId });
  res.status(204).end();
});

/** Header or footer images for a template. They're attached when the template is saved. */
brandingRouter.post("/assets", settings, rawImage, async (req, res) => {
  const kind = req.query.kind;
  if (kind !== "HEADER" && kind !== "FOOTER" && kind !== "BACKGROUND" && kind !== "DOCTOR_SIGNATURE") {
    throw badRequest("Say whether this is a HEADER, FOOTER, BACKGROUND or DOCTOR_SIGNATURE image");
  }
  await uploadLimit(req);
  res.status(201).json({ asset: await branding.storeAsset(ctx(req).auth.tenantId, kind, req.body, ctx(req).auth.userId) });
});

/**
 * Any image of this lab, for showing in the app. Signatures and stamps are only
 * shown to their owner and to people who manage users.
 */
brandingRouter.get("/assets/:id", async (req, res) => {
  const { auth, db } = ctx(req);
  const id = String(req.params.id);
  const asset = await db.labAsset.findFirst({ where: { id }, select: { kind: true, mime: true, data: true } });
  if (!asset) throw notFound("Image not found");
  if (asset.kind === "SIGNATURE" || asset.kind === "STAMP") {
    const mine = await db.user.count({ where: { id: auth.userId, OR: [{ signatureId: id }, { stampId: id }] } });
    if (!mine && !auth.permissions.includes("users:read")) throw notFound("Image not found");
  }
  res.setHeader("Content-Type", asset.mime);
  // Stored images never change; a new upload gets a new id.
  res.setHeader("Cache-Control", "private, max-age=86400, immutable");
  res.send(Buffer.from(asset.data));
});

/** How bills print: read by every signed-in user (the print page needs it), changed by whoever manages settings. */
brandingRouter.get("/bill-settings", async (req, res) => {
  res.json({ settings: await branding.getBillSettings(ctx(req).auth.tenantId) });
});

brandingRouter.put("/bill-settings", settings, validateBody(billSettingsSchema), async (req, res) => {
  const { auth, db } = ctx(req);
  const input = req.body as BillSettings;
  const { before, settings: saved } = await branding.updateBillSettings(db, auth.tenantId, input);
  await audit({ ...meta(req), action: "lab.bill_settings", entityType: "tenant", entityId: auth.tenantId, before: { ...before }, after: { ...saved } });
  res.json({ settings: saved });
});

/** Doctors whose signature prints on reports. Everyone signed in can read them (print screens list the selectable ones). */
brandingRouter.get("/report-doctors", async (req, res) => {
  res.json({ doctors: await branding.listReportDoctors(ctx(req).db) });
});

brandingRouter.post("/report-doctors", settings, validateBody(reportDoctorSchema), async (req, res) => {
  const { auth, db } = ctx(req);
  const doctor = await branding.createReportDoctor(db, auth.tenantId, req.body as ReportDoctorValues);
  await audit({ ...meta(req), action: "report_doctor.create", entityType: "report_doctor", entityId: doctor.id, after: { ...doctor } });
  res.status(201).json({ doctor });
});

brandingRouter.put("/report-doctors/:id", settings, validateBody(reportDoctorSchema), async (req, res) => {
  const { auth, db } = ctx(req);
  const { before, doctor } = await branding.updateReportDoctor(db, auth.tenantId, String(req.params.id), req.body as ReportDoctorValues);
  await audit({ ...meta(req), action: "report_doctor.update", entityType: "report_doctor", entityId: doctor.id, before: { ...before }, after: { ...doctor } });
  res.json({ doctor });
});

brandingRouter.delete("/report-doctors/:id", settings, async (req, res) => {
  const { auth, db } = ctx(req);
  const d = await branding.deleteReportDoctor(db, auth.tenantId, String(req.params.id));
  await audit({ ...meta(req), action: "report_doctor.delete", entityType: "report_doctor", entityId: d.id, before: { ...d } });
  res.status(204).end();
});

brandingRouter.get("/templates", async (req, res) => {
  const { auth, db } = ctx(req);
  res.json({ templates: await branding.listTemplates(db, auth.tenantId) });
});

brandingRouter.post("/templates", settings, validateBody(reportTemplateSchema), async (req, res) => {
  const { auth, db } = ctx(req);
  const input = req.body as ReportTemplateValues;
  const template = await branding.createTemplate(db, auth.tenantId, input);
  await audit({ ...meta(req), action: "template.create", entityType: "report_template", entityId: template.id, after: input });
  res.status(201).json({ template });
});

brandingRouter.put("/templates/:id", settings, validateBody(reportTemplateSchema), async (req, res) => {
  const { auth, db } = ctx(req);
  const input = req.body as ReportTemplateValues;
  const { before, template } = await branding.updateTemplate(db, auth.tenantId, String(req.params.id), input);
  await audit({ ...meta(req), action: "template.update", entityType: "report_template", entityId: template.id, before: { ...before }, after: input });
  res.json({ template });
});

brandingRouter.delete("/templates/:id", settings, async (req, res) => {
  const { auth, db } = ctx(req);
  const t = await branding.deleteTemplate(db, auth.tenantId, String(req.params.id));
  await audit({ ...meta(req), action: "template.delete", entityType: "report_template", entityId: t.id, before: { ...t } });
  res.status(204).end();
});

brandingRouter.post("/templates/:id/default", settings, async (req, res) => {
  const { db } = ctx(req);
  const t = await branding.setDefaultTemplate(db, String(req.params.id));
  await audit({ ...meta(req), action: "template.default", entityType: "report_template", entityId: t.id, after: { name: t.name } });
  res.status(204).end();
});

/** The background image of a B2B lab's own letterhead. Managed with B2B labs, so it needs that permission rather than lab settings. */
brandingRouter.post("/b2b-letterhead/asset", requirePermission("accounts:write"), rawImage, async (req, res) => {
  await uploadLimit(req);
  res.status(201).json({ asset: await branding.storeAsset(ctx(req).auth.tenantId, "BACKGROUND", req.body, ctx(req).auth.userId) });
});

/** A sample report on a B2B lab's unsaved letterhead settings. */
brandingRouter.post("/b2b-letterhead/preview", requirePermission("accounts:write"), validateBody(labLetterheadSchema), async (req, res) => {
  const { auth, db } = ctx(req);
  await rateLimit(`template-preview:${auth.userId}`, 60, 60);
  const l = req.body as z.output<typeof labLetterheadSchema>;
  const template = { ...DEFAULT_TEMPLATE, style: "PREPRINTED" as const, backgroundImageId: l.backgroundAssetId, headerHeightMm: l.headerHeightMm, footerHeightMm: l.footerHeightMm, leftMarginMm: l.leftMarginMm, rightMarginMm: l.rightMarginMm };
  await checkPreviewImages(db, template);
  const data = await sampleReport(auth.tenantId, auth.userId);
  const look = await branding.lookFor(auth.tenantId, data, { template });
  const pdf = await renderReportPdf(data, "https://example.com/r/sample", look);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "no-store");
  res.send(pdf);
});

/** A sample report drawn with unsaved template settings, for the editor's live preview. */
brandingRouter.post("/templates/preview", settings, validateBody(reportTemplateSchema), async (req, res) => {
  const { auth, db } = ctx(req);
  await rateLimit(`template-preview:${auth.userId}`, 60, 60);
  const template = req.body as ReportTemplateValues;
  await checkPreviewImages(db, template);
  const data = await sampleReport(auth.tenantId, auth.userId);
  const look = await branding.lookFor(auth.tenantId, data, { template });
  const pdf = await renderReportPdf(data, "https://example.com/r/sample", look);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "no-store");
  res.send(pdf);
});

/** Preview images must belong to this lab too. */
async function checkPreviewImages(db: TenantDb, t: ReportTemplateValues) {
  for (const id of [t.headerImageId, t.footerImageId, t.backgroundImageId, t.outsourceHeaderImageId, t.outsourceFooterImageId]) {
    if (id && !(await db.labAsset.findFirst({ where: { id }, select: { id: true } }))) throw badRequest("Upload the image again");
  }
}

// ---------------------------------------------------------------------------
// Signatures and stamps: your own (/api/profile) or, for owners, anyone's (/api/users/:id)
// ---------------------------------------------------------------------------

const slugKind = (slug: string) => PERSONAL_ASSETS[slug as PersonalAssetSlug];
const column = (kind: "SIGNATURE" | "STAMP") => (kind === "SIGNATURE" ? "signatureId" : "stampId");

async function setPersonalAsset(req: Request, userId: string, slug: string, body: unknown) {
  const { auth, db } = ctx(req);
  const kind = slugKind(slug);
  const user = await db.user.findFirst({ where: { id: userId }, select: { id: true, signatureId: true, stampId: true } });
  if (!user) throw notFound("User not found");
  await uploadLimit(req);
  const asset = await branding.storeAsset(auth.tenantId, kind, body, auth.userId);
  await db.user.update({ where: { id: userId }, data: { [column(kind)]: asset.id } });
  await branding.deleteIfUnused(auth.tenantId, user[column(kind)]);
  await audit({ ...meta(req), action: `user.${slug}`, entityType: "user", entityId: userId, after: { assetId: asset.id } });
  return asset;
}

async function removePersonalAsset(req: Request, userId: string, slug: string) {
  const { auth, db } = ctx(req);
  const kind = slugKind(slug);
  const user = await db.user.findFirst({ where: { id: userId }, select: { id: true, signatureId: true, stampId: true } });
  if (!user) throw notFound("User not found");
  await db.user.update({ where: { id: userId }, data: { [column(kind)]: null } });
  await branding.deleteIfUnused(auth.tenantId, user[column(kind)]);
  await audit({ ...meta(req), action: `user.${slug}_removed`, entityType: "user", entityId: userId });
}

/** Mounted on /api/users: owners managing someone else's signature or stamp. */
export const userAssetsRouter = Router();
userAssetsRouter.use(authenticate);
for (const slug of Object.keys(PERSONAL_ASSETS)) {
  userAssetsRouter.put(`/:id/${slug}`, requirePermission("users:write"), rawImage, async (req, res) => {
    res.json({ asset: await setPersonalAsset(req, String(req.params.id), slug, req.body) });
  });
  userAssetsRouter.delete(`/:id/${slug}`, requirePermission("users:write"), async (req, res) => {
    await removePersonalAsset(req, String(req.params.id), slug);
    res.status(204).end();
  });
}

// ---------------------------------------------------------------------------
// /api/profile: anyone's own details
// ---------------------------------------------------------------------------

export const profileRouter = Router();
profileRouter.use(authenticate);

async function myProfile(req: Request): Promise<MyProfile> {
  const { auth, db } = ctx(req);
  const u = await db.user.findFirstOrThrow({
    where: { id: auth.userId },
    select: { id: true, name: true, email: true, phone: true, qualification: true, registrationNo: true, signatureId: true, stampId: true },
  });
  return { ...u, signsReports: auth.permissions.includes("results:approve") };
}

profileRouter.get("/", async (req, res) => {
  res.json({ profile: await myProfile(req) });
});

profileRouter.put("/", validateBody(updateUserSchema), async (req, res) => {
  const { auth, db } = ctx(req);
  const input = req.body as z.output<typeof updateUserSchema>;
  const before = await db.user.findFirstOrThrow({
    where: { id: auth.userId },
    select: { name: true, phone: true, qualification: true, registrationNo: true },
  });
  await db.user.update({ where: { id: auth.userId }, data: input });
  await audit({ ...meta(req), action: "user.update", entityType: "user", entityId: auth.userId, before, after: input });
  res.json({ profile: await myProfile(req) });
});

for (const slug of Object.keys(PERSONAL_ASSETS)) {
  profileRouter.put(`/${slug}`, rawImage, async (req, res) => {
    await setPersonalAsset(req, ctx(req).auth.userId, slug, req.body);
    res.json({ profile: await myProfile(req) });
  });
  profileRouter.delete(`/${slug}`, async (req, res) => {
    await removePersonalAsset(req, ctx(req).auth.userId, slug);
    res.json({ profile: await myProfile(req) });
  });
}
