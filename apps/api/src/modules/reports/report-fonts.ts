import { createRequire } from "node:module";
import path from "node:path";
import { Font } from "@react-pdf/renderer";
import type { ReportFontId } from "@lms/shared";

const require = createRequire(import.meta.url);

/** Family names to print with: one for normal text, one for bold. */
export interface PdfFont {
  regular: string;
  bold: string;
}

/** Built into every PDF viewer, nothing to load. */
const BUILT_IN: Partial<Record<ReportFontId, PdfFont>> = {
  helvetica: { regular: "Helvetica", bold: "Helvetica-Bold" },
  times: { regular: "Times-Roman", bold: "Times-Bold" },
  courier: { regular: "Courier", bold: "Courier-Bold" },
};

/** Fontsource package for each downloadable font, and the file prefix inside it. */
const FILES: Partial<Record<ReportFontId, { pkg: string; file: string }>> = {
  roboto: { pkg: "roboto", file: "roboto" },
  "open-sans": { pkg: "open-sans", file: "open-sans" },
  lato: { pkg: "lato", file: "lato" },
  "noto-sans": { pkg: "noto-sans", file: "noto-sans" },
  "source-sans": { pkg: "source-sans-3", file: "source-sans-3" },
  "pt-sans": { pkg: "pt-sans", file: "pt-sans" },
  merriweather: { pkg: "merriweather", file: "merriweather" },
};

const registered = new Map<ReportFontId, PdfFont>();

/** The font for a template, loading its files the first time it is used. Unknown ids fall back to Helvetica. */
export function pdfFont(id: string): PdfFont {
  const builtIn = BUILT_IN[id as ReportFontId];
  if (builtIn) return builtIn;
  const known = registered.get(id as ReportFontId);
  if (known) return known;
  const spec = FILES[id as ReportFontId];
  if (!spec) return BUILT_IN.helvetica!;
  try {
    const dir = path.join(path.dirname(require.resolve(`@fontsource/${spec.pkg}/package.json`)), "files");
    const font = { regular: `labos-${id}`, bold: `labos-${id}-bold` };
    Font.register({ family: font.regular, src: path.join(dir, `${spec.file}-latin-400-normal.woff`) });
    Font.register({ family: font.bold, src: path.join(dir, `${spec.file}-latin-700-normal.woff`) });
    registered.set(id as ReportFontId, font);
    return font;
  } catch {
    // Files missing from this install: print in Helvetica rather than fail the report.
    return BUILT_IN.helvetica!;
  }
}
