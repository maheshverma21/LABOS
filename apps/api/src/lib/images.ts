import { Document, Image, Page, renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";

export interface ImageInfo {
  mime: "image/png" | "image/jpeg";
  format: "png" | "jpg";
  width: number;
  height: number;
}

/** Largest side we accept. Bigger images only make PDFs slow and heavy. */
export const MAX_IMAGE_SIDE = 5000;

/**
 * Works out what an uploaded file really is from its bytes (never trusting the
 * file name or Content-Type). Returns null for anything but a PNG or JPEG.
 */
export function sniffImage(buf: Buffer): ImageInfo | null {
  // PNG: fixed signature, then the IHDR chunk with width and height.
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a && buf.toString("latin1", 12, 16) === "IHDR") {
    return { mime: "image/png", format: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: walk the markers to the start-of-frame, which holds the size.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { mime: "image/jpeg", format: "jpg", width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

/**
 * True if the PDF renderer can embed this image. A file can have the right
 * header and still be damaged or oddly encoded, and it's better to say so at
 * upload than to break every report later.
 */
export async function embedsInPdf(buf: Buffer, format: ImageInfo["format"]): Promise<boolean> {
  try {
    await renderToBuffer(
      createElement(Document, null, createElement(Page, { size: [100, 100] }, createElement(Image, { src: { data: buf, format }, style: { width: 50 } }))),
    );
    return true;
  } catch {
    return false;
  }
}
