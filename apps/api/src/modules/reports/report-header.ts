import { DEFAULT_REPORT_HEADER, reportHeaderSettingsSchema, type ReportHeaderSettings } from "@lms/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

/** The lab's Report settings (which details print at the top of a report). Falls back to the classic layout. */
export async function readReportHeader(tenantId: string): Promise<ReportHeaderSettings> {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  const all = t.settings && typeof t.settings === "object" && !Array.isArray(t.settings) ? (t.settings as Record<string, unknown>) : {};
  // Details removed from the product (MRN, National ID) may still be saved in older settings; drop them quietly.
  const stored = all.reportHeader as { fields?: unknown } | undefined;
  const cleaned =
    stored && Array.isArray(stored.fields)
      ? { ...stored, fields: stored.fields.filter((f) => f !== "mrn" && f !== "nationalId") }
      : stored;
  const parsed = reportHeaderSettingsSchema.safeParse(cleaned);
  return parsed.success ? parsed.data : DEFAULT_REPORT_HEADER;
}

export async function writeReportHeader(tenantId: string, next: ReportHeaderSettings): Promise<void> {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  const all = t.settings && typeof t.settings === "object" && !Array.isArray(t.settings) ? (t.settings as Record<string, unknown>) : {};
  await prisma.tenant.update({ where: { id: tenantId }, data: { settings: { ...all, reportHeader: next } as Prisma.InputJsonObject } });
}
