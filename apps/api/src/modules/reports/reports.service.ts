import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  REPORT_LINK_DAYS,
  type PublicReportInfo,
  type ReportDeliveryItem,
  type ListFilters,
  toIsoDate,
  type ReportListItem,
  type ReportState,
  type ReportStatus,
} from "@lms/shared";
import { publicBaseUrl } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { tenantDb, type TenantDb } from "../../lib/tenant-db";
import { audit } from "../../lib/audit";
import { AppError, badRequest, notFound } from "../../lib/errors";
import { istDayRange } from "../orders/orders.service";
import { orderFilterWhere } from "../../lib/list-filters";
import { loadReport } from "./report-data";
import { renderReportPdf } from "./report-pdf";
import { withOutsourceFiles } from "./report-attachments";
import { lookFor } from "../branding/branding.service";
import { resolveAccount, sendAisensy } from "./whatsapp";

export interface Actor {
  tenantId: string;
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

const auditMeta = (a: Actor) => ({ tenantId: a.tenantId, actorId: a.userId, ip: a.ip, userAgent: a.userAgent });

export const viewUrl = (token: string) => `${publicBaseUrl()}/r/${token}`;
export const pdfUrl = (token: string) => `${publicBaseUrl()}/api/public/reports/${token}/pdf`;

const deliverySelect = {
  id: true,
  channel: true,
  to: true,
  status: true,
  error: true,
  sentById: true,
  createdAt: true,
} as const;

async function toDeliveryItems(
  db: TenantDb,
  rows: Prisma.ReportDeliveryGetPayload<{ select: typeof deliverySelect }>[],
): Promise<ReportDeliveryItem[]> {
  const ids = [...new Set(rows.map((r) => r.sentById).filter((x): x is string => !!x))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    to: r.to,
    status: r.status,
    error: r.error,
    sentBy: users.find((u) => u.id === r.sentById)?.name ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function counts(db: TenantDb, orderId: string) {
  const tests = await db.orderTest.findMany({
    where: { orderId, status: { not: "CANCELLED" } },
    select: { status: true, amendedAt: true },
  });
  const approved = tests.filter((t) => t.status === "APPROVED");
  return { total: tests.length, approved: approved.length, amended: approved.some((t) => !!t.amendedAt) };
}

async function activeOrder(db: TenantDb, orderId: string) {
  const order = await db.order.findFirst({
    where: { id: orderId },
    select: { id: true, orderNo: true, status: true, patient: { select: { name: true, salutation: true, phone: true } } },
  });
  if (!order) throw notFound("Order not found");
  if (order.status === "CANCELLED") throw badRequest("This order was cancelled");
  return order;
}

// ---------------------------------------------------------------------------
// Status and list
// ---------------------------------------------------------------------------

export async function status(db: TenantDb, tenantId: string, orderId: string): Promise<ReportStatus> {
  const order = await activeOrder(db, orderId);
  const c = await counts(db, orderId);
  const rows = await db.reportDelivery.findMany({ where: { orderId }, orderBy: { createdAt: "desc" }, take: 20, select: deliverySelect });
  const account = await resolveAccount(tenantId);
  return {
    orderId,
    totalTests: c.total,
    approvedTests: c.approved,
    amended: c.amended,
    patientMobile: order.patient.phone,
    whatsappReady: account.ok,
    deliveries: await toDeliveryItems(db, rows),
  };
}

/** Channels that count as the patient having the report. */
const DELIVERED_BY = new Set(["WHATSAPP", "COUNTER"]);

export async function list(
  db: TenantDb,
  f: { date: string; dateTo?: string; q?: string; state?: ReportState; filters?: ListFilters },
): Promise<ReportListItem[]> {
  const q = f.q?.trim();
  const orders = await db.order.findMany({
    where: {
      AND: [
        { status: "ACTIVE", createdAt: istDayRange(f.date, f.dateTo), tests: { some: { status: { not: "CANCELLED" } } } },
        orderFilterWhere(f.filters ?? {}),
        q
          ? {
              OR: [
                { orderNo: { contains: q } },
                { patient: { name: { contains: q, mode: "insensitive" } } },
                { patient: { uhid: { equals: q.toUpperCase() } } },
                { patient: { phone: { contains: q } } },
              ],
            }
          : {},
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true,
      orderNo: true,
      createdAt: true,
      patient: { select: { id: true, uhid: true, salutation: true, name: true, sex: true, dob: true, dobEstimated: true, phone: true } },
      netPaise: true,
      paidPaise: true,
      samples: { where: { status: { not: "CANCELLED" } }, orderBy: { barcode: "asc" }, select: { barcode: true } },
      doctor: { select: { name: true } },
      account: { select: { name: true } },
      tests: { where: { status: { not: "CANCELLED" } }, orderBy: { sortOrder: "asc" }, select: { name: true, status: true, approvedAt: true } },
      reportDeliveries: { orderBy: { createdAt: "desc" }, take: 20, select: deliverySelect },
    },
  });
  const last = await toDeliveryItems(
    db,
    orders.flatMap((o) => o.reportDeliveries.slice(0, 1)),
  );
  const items = orders.map((o): ReportListItem => {
    const approved = o.tests.filter((t) => t.status === "APPROVED");
    const lastApprovedAt = approved.map((t) => t.approvedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
    const d = o.reportDeliveries[0];
    // Delivered means given to the patient after the latest approval, so an amended report counts as not yet delivered.
    const delivered =
      approved.length === o.tests.length &&
      o.reportDeliveries.some((x) => x.status === "SENT" && DELIVERED_BY.has(x.channel) && (!lastApprovedAt || x.createdAt >= lastApprovedAt));
    return {
      orderId: o.id,
      orderNo: o.orderNo,
      createdAt: o.createdAt.toISOString(),
      patient: { ...o.patient, dob: toIsoDate(o.patient.dob), mobile: o.patient.phone },
      totalTests: o.tests.length,
      approvedTests: approved.length,
      lastApprovedAt: lastApprovedAt?.toISOString() ?? null,
      lastDelivery: d ? (last.find((x) => x.id === d.id) ?? null) : null,
      state: approved.length < o.tests.length ? "PENDING" : delivered ? "DELIVERED" : "COMPLETED",
      tests: o.tests.map((t) => ({ name: t.name, status: t.status })),
      netPaise: o.netPaise,
      paidPaise: o.paidPaise,
      barcodes: o.samples.map((s) => s.barcode),
      doctor: o.doctor?.name ?? null,
      account: o.account?.name ?? null,
    };
  });
  return f.state ? items.filter((i) => i.state === f.state) : items;
}

/** Records that a printed report was handed over at the counter. */
export async function handOver(db: TenantDb, actor: Actor, orderId: string, to: string | null) {
  await activeOrder(db, orderId);
  const c = await counts(db, orderId);
  if (c.approved === 0) throw badRequest("No results have been approved yet");
  const row = await db.reportDelivery.create({
    data: { tenantId: actor.tenantId, orderId, channel: "COUNTER", to, status: "SENT", sentById: actor.userId },
    select: deliverySelect,
  });
  await audit({ ...auditMeta(actor), action: "report.handed_over", entityType: "order", entityId: orderId, after: { to } });
  return (await toDeliveryItems(db, [row]))[0]!;
}

// ---------------------------------------------------------------------------
// Links and PDFs
// ---------------------------------------------------------------------------

/** The order's current patient link, creating one if there's none still valid. */
export async function ensureLink(db: TenantDb, actor: Actor | null, tenantId: string, orderId: string) {
  const existing = await db.reportLink.findFirst({
    where: { orderId, revokedAt: null, expiresAt: { gt: new Date(Date.now() + 7 * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    select: { token: true, expiresAt: true },
  });
  if (existing) return existing;
  const link = await db.reportLink.create({
    data: {
      tenantId,
      orderId,
      token: randomBytes(24).toString("base64url"),
      expiresAt: new Date(Date.now() + REPORT_LINK_DAYS * 86_400_000),
      createdById: actor?.userId ?? null,
    },
    select: { token: true, expiresAt: true },
  });
  if (actor) {
    await audit({ ...auditMeta(actor), action: "report.link", entityType: "order", entityId: orderId, after: { expiresAt: link.expiresAt } });
  }
  return link;
}

export async function pdfForStaff(db: TenantDb, actor: Actor, orderId: string, opts: { templateId?: string | null; letterhead?: boolean; outsource?: boolean; doctorIds?: string[]; separate?: boolean } = {}) {
  const order = await activeOrder(db, orderId);
  const c = await counts(db, orderId);
  // The QR code points at the patient link, so make sure one exists once there's something to show.
  const link = c.approved > 0 ? await ensureLink(db, actor, actor.tenantId, orderId) : null;
  const data = await loadReport(db, actor.tenantId, orderId);
  // A B2B lab's reports print on its own letterhead, unless a template was picked for this print.
  const own = opts.templateId ? null : await accountTemplateId(db, orderId);
  const look = await lookFor(actor.tenantId, data, { ...opts, templateId: opts.templateId ?? own });
  const pdf = await renderReportPdf(data, link ? viewUrl(link.token) : null, look, { separate: opts.separate });
  return { pdf: await withOutsourceFiles(db, actor.tenantId, orderId, pdf), filename: `Report-${order.orderNo}.pdf` };
}

/** The letterhead template of the B2B lab an order is billed to, if that lab has its own. */
async function accountTemplateId(db: TenantDb, orderId: string): Promise<string | null> {
  const o = await db.order.findFirst({ where: { id: orderId }, select: { accountId: true } });
  if (!o?.accountId) return null;
  return (await db.reportTemplate.findFirst({ where: { accountId: o.accountId }, select: { id: true } }))?.id ?? null;
}

export async function shareLink(db: TenantDb, actor: Actor, orderId: string) {
  await activeOrder(db, orderId);
  const c = await counts(db, orderId);
  if (c.approved === 0) throw badRequest("No results have been approved yet");
  const link = await ensureLink(db, actor, actor.tenantId, orderId);
  return { url: viewUrl(link.token), expiresAt: link.expiresAt.toISOString() };
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

export async function sendWhatsapp(db: TenantDb, actor: Actor, orderId: string, to: string | null) {
  const order = await activeOrder(db, orderId);
  const c = await counts(db, orderId);
  if (c.approved === 0) throw badRequest("No results have been approved yet");
  const mobile = to ?? order.patient.phone;
  if (!mobile) throw badRequest("This patient has no mobile number. Enter one to send to.", { to: ["Enter a mobile number"] });

  const account = await resolveAccount(actor.tenantId);
  if (!account.ok) throw badRequest(account.reason);

  const lab = await prisma.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { name: true } });
  const link = await ensureLink(db, actor, actor.tenantId, orderId);
  const result = await sendAisensy({
    apiKey: account.apiKey,
    campaignName: account.campaignName,
    mobile,
    userName: order.patient.name,
    templateParams: [order.patient.name, lab.name],
    media: { url: pdfUrl(link.token), filename: `Report-${order.orderNo}.pdf` },
  });

  const delivery = await db.reportDelivery.create({
    data: {
      tenantId: actor.tenantId,
      orderId,
      channel: "WHATSAPP",
      to: mobile,
      status: result.ok ? "SENT" : "FAILED",
      error: result.ok ? null : result.error,
      providerRef: result.ok ? result.ref : null,
      sentById: actor.userId,
    },
    select: deliverySelect,
  });
  await audit({
    ...auditMeta(actor),
    action: result.ok ? "report.send" : "report.send_failed",
    entityType: "order",
    entityId: orderId,
    after: { channel: "WHATSAPP", to: mobile, approvedTests: c.approved, totalTests: c.total },
  });
  if (!result.ok) throw new AppError(502, "delivery_failed", result.error);
  return (await toDeliveryItems(db, [delivery]))[0]!;
}

// ---------------------------------------------------------------------------
// Public (patient) access by token
// ---------------------------------------------------------------------------

async function byToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound("This report link isn't valid");
  const link = await prisma.reportLink.findUnique({
    where: { token },
    select: { tenantId: true, orderId: true, expiresAt: true, revokedAt: true, tenant: { select: { status: true } } },
  });
  if (!link || link.revokedAt || link.tenant.status === "SUSPENDED") throw notFound("This report link isn't valid");
  if (link.expiresAt < new Date()) throw new AppError(410, "expired", "This report link has expired. Please contact the lab.");
  return { ...link, db: tenantDb(link.tenantId) };
}

export async function publicInfo(token: string): Promise<PublicReportInfo> {
  const link = await byToken(token);
  const order = await link.db.order.findFirst({
    where: { id: link.orderId, status: "ACTIVE" },
    select: { orderNo: true, createdAt: true, patient: { select: { name: true, salutation: true } } },
  });
  if (!order) throw notFound("This report link isn't valid");
  const lab = await prisma.tenant.findUniqueOrThrow({ where: { id: link.tenantId }, select: { name: true, phone: true } });
  const c = await counts(link.db, link.orderId);
  // Only the first name, so a link that's forwarded on gives away as little as possible before the PDF opens.
  return {
    lab,
    patientName: order.patient.name.split(/\s+/)[0] ?? order.patient.name,
    orderNo: order.orderNo,
    orderDate: order.createdAt.toISOString(),
    totalTests: c.total,
    approvedTests: c.approved,
    expiresAt: link.expiresAt.toISOString(),
  };
}

export async function publicPdf(token: string) {
  const link = await byToken(token);
  const c = await counts(link.db, link.orderId);
  if (c.approved === 0) throw notFound("No results are ready yet");
  const data = await loadReport(link.db, link.tenantId, link.orderId);
  const look = await lookFor(link.tenantId, data, { digital: true, templateId: await accountTemplateId(link.db, link.orderId) });
  const pdf = await renderReportPdf(data, viewUrl(token), look);
  return { pdf: await withOutsourceFiles(link.db, link.tenantId, link.orderId, pdf), filename: `Report-${data.order.orderNo}.pdf` };
}
