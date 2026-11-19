import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { TenantDb } from "../../lib/tenant-db";
import { outsourceLetterhead } from "../branding/branding.service";
import { logger } from "../../lib/logger";

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 36;
const MM = 72 / 25.4;

/**
 * Adds the report files that came back from outsourced labs (for tests that are
 * approved) after the report's own pages: PDFs page by page, photos one per page.
 * A file that can't be read is left out rather than breaking the whole report.
 */
export async function withOutsourceFiles(db: TenantDb, tenantId: string, orderId: string, report: Buffer): Promise<Buffer> {
  const files = await db.orderTestFile.findMany({
    where: { orderTest: { orderId, status: "APPROVED" } },
    orderBy: { createdAt: "asc" },
    select: { name: true, mime: true, data: true, addLetterhead: true, orderTest: { select: { code: true, name: true, test: { select: { outsourceLab: { select: { name: true } } } } } } },
  });
  if (files.length === 0) return report;

  const doc = await PDFDocument.load(report);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const letterhead = files.some((f) => f.addLetterhead) ? await outsourceLetterhead(tenantId) : null;
  const embed = async (img: { data: Buffer; format: "png" | "jpg" } | null) =>
    img ? (img.format === "png" ? doc.embedPng(new Uint8Array(img.data)) : doc.embedJpg(new Uint8Array(img.data))) : null;
  const headerImg = await embed(letterhead?.header ?? null);
  const footerImg = await embed(letterhead?.footer ?? null);
  const headerH = headerImg && letterhead ? letterhead.headerMm * MM : 0;
  const footerH = footerImg && letterhead ? letterhead.footerMm * MM : 0;

  /** Draws the outsource header across the top of the page and the footer along the bottom, scaled to fit like the report's own letterhead. */
  const stamp = (page: ReturnType<typeof doc.addPage>) => {
    const { width, height } = page.getSize();
    if (headerImg && headerH > 0) {
      const k = Math.min(width / headerImg.width, headerH / headerImg.height);
      const w = headerImg.width * k;
      const h = headerImg.height * k;
      page.drawImage(headerImg, { x: (width - w) / 2, y: height - h - (headerH - h) / 2, width: w, height: h });
    }
    if (footerImg && footerH > 0) {
      const k = Math.min(width / footerImg.width, footerH / footerImg.height);
      const w = footerImg.width * k;
      const h = footerImg.height * k;
      page.drawImage(footerImg, { x: (width - w) / 2, y: (footerH - h) / 2, width: w, height: h });
    }
  };
  for (const f of files) {
    try {
      const bytes = new Uint8Array(f.data);
      if (f.mime === "application/pdf") {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        for (const copied of await doc.copyPages(src, src.getPageIndices())) {
          const page = doc.addPage(copied);
          if (f.addLetterhead) stamp(page);
        }
      } else {
        const image = f.mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const page = doc.addPage([A4.w, A4.h]);
        const lab = f.orderTest.test.outsourceLab?.name;
        const caption = `${f.orderTest.name}${lab ? ` (tested at ${lab})` : ""}`;
        // With the letterhead on, the photo sits between the header and the footer.
        const top = f.addLetterhead ? Math.max(headerH, MARGIN) : MARGIN;
        const bottom = f.addLetterhead ? Math.max(footerH, MARGIN) : MARGIN;
        page.drawText(caption, { x: MARGIN, y: A4.h - top - 10, size: 10, font, color: rgb(0.25, 0.25, 0.25) });
        const maxW = A4.w - 2 * MARGIN;
        const maxH = A4.h - top - bottom - 24;
        const scale = Math.min(maxW / image.width, maxH / image.height, 1.5);
        const w = image.width * scale;
        const h = image.height * scale;
        page.drawImage(image, { x: MARGIN + (maxW - w) / 2, y: A4.h - top - 24 - h, width: w, height: h });
        if (f.addLetterhead) stamp(page);
      }
    } catch (err) {
      logger.warn({ err, file: f.name }, "couldn't add an outsourced report file to the report");
    }
  }
  return Buffer.from(await doc.save());
}
