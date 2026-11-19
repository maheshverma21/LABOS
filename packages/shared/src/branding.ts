import { z } from "zod";

// ---------------------------------------------------------------------------
// Uploaded images: logo, letterhead header/footer, signatures and stamps
// ---------------------------------------------------------------------------

export const ASSET_KINDS = ["LOGO", "HEADER", "FOOTER", "SIGNATURE", "STAMP", "BACKGROUND", "DOCTOR_SIGNATURE"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** PDFs can only embed these. */
export const ASSET_MIME_TYPES = ["image/png", "image/jpeg"] as const;

/** Largest file accepted, per kind. Letterhead images are full page width, so they get more room. */
export const ASSET_MAX_BYTES: Record<AssetKind, number> = {
  LOGO: 1024 * 1024,
  HEADER: 2 * 1024 * 1024,
  FOOTER: 2 * 1024 * 1024,
  SIGNATURE: 512 * 1024,
  STAMP: 512 * 1024,
  BACKGROUND: 4 * 1024 * 1024,
  DOCTOR_SIGNATURE: 512 * 1024,
};

export const ASSET_LABEL: Record<AssetKind, string> = {
  LOGO: "Logo",
  HEADER: "Letterhead header",
  FOOTER: "Letterhead footer",
  SIGNATURE: "Signature",
  STAMP: "Stamp",
  BACKGROUND: "Report background",
  DOCTOR_SIGNATURE: "Doctor signature",
};

/** A person's signature or stamp, as used in /profile/:kind and /users/:id/:kind. */
export const PERSONAL_ASSETS = { signature: "SIGNATURE", stamp: "STAMP" } as const;
export type PersonalAssetSlug = keyof typeof PERSONAL_ASSETS;

export interface AssetInfo {
  id: string;
  kind: AssetKind;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Report templates (letterheads)
// ---------------------------------------------------------------------------

export const LETTERHEAD_STYLES = ["BUILT_IN", "IMAGE", "PREPRINTED"] as const;
export type LetterheadStyle = (typeof LETTERHEAD_STYLES)[number];

export const LETTERHEAD_STYLE_LABEL: Record<LetterheadStyle, string> = {
  BUILT_IN: "Made from your lab profile",
  IMAGE: "Your own header and footer images",
  PREPRINTED: "Blank space for pre-printed paper",
};

export const LETTERHEAD_STYLE_HINT: Record<LetterheadStyle, string> = {
  BUILT_IN: "Logo, name, address and contact details, in your colour.",
  IMAGE: "Upload the top and bottom of your letterhead as images, e.g. exported from your designer's file.",
  PREPRINTED: "Prints nothing at the top and bottom, so reports fit paper that already has your letterhead.",
};

const HEX = /^#[0-9a-fA-F]{6}$/;

const optionalLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);

/** Fonts a lab can print its reports in. The first one is the default. */
export const REPORT_FONTS = [
  { id: "helvetica", label: "Helvetica (Arial-like)" },
  { id: "times", label: "Times (Serif)" },
  { id: "courier", label: "Courier (Typewriter)" },
  { id: "roboto", label: "Roboto" },
  { id: "open-sans", label: "Open Sans" },
  { id: "lato", label: "Lato" },
  { id: "noto-sans", label: "Noto Sans" },
  { id: "source-sans", label: "Source Sans 3" },
  { id: "pt-sans", label: "PT Sans" },
  { id: "merriweather", label: "Merriweather (Serif)" },
] as const;
export type ReportFontId = (typeof REPORT_FONTS)[number]["id"];
const REPORT_FONT_IDS = REPORT_FONTS.map((f) => f.id) as [ReportFontId, ...ReportFontId[]];

export const reportTemplateSchema = z
  .object({
    name: z.string().trim().min(2, "Give it a name").max(60),
    style: z.enum(LETTERHEAD_STYLES),
    headerImageId: z.uuid().nullable().optional().transform((v) => v ?? null),
    footerImageId: z.uuid().nullable().optional().transform((v) => v ?? null),
    leftMarginMm: z.coerce.number().int().min(0, "At least 0 mm").max(60, "At most 60 mm").default(11),
    rightMarginMm: z.coerce.number().int().min(0, "At least 0 mm").max(60, "At most 60 mm").default(11),
    backgroundImageId: z.uuid().nullable().optional().transform((v) => v ?? null),
    outsourceHeaderImageId: z.uuid().nullable().optional().transform((v) => v ?? null),
    outsourceFooterImageId: z.uuid().nullable().optional().transform((v) => v ?? null),
    outsourceFooterHeightMm: z.coerce.number().int().min(0).max(150, "At most 150 mm").default(20),
    headerHeightMm: z.coerce.number().int().min(0, "At least 0 mm").max(150, "At most 150 mm"),
    footerHeightMm: z.coerce.number().int().min(0).max(150, "At most 150 mm"),
    accentColor: z.string().trim().regex(HEX, "Use a colour like #2D6A9F"),
    fontFamily: z.enum(REPORT_FONT_IDS).default("helvetica"),
    // Optional so older clients that don't send them keep working.
    lowColor: z.string().trim().regex(HEX, "Use a colour like #1D4ED8").default("#1D4ED8"),
    highColor: z.string().trim().regex(HEX, "Use a colour like #B91C1C").default("#B91C1C"),
    showLogo: z.boolean(),
    showSignatures: z.boolean(),
    showQr: z.boolean(),
    footerNote: optionalLine(200),
  })
  .superRefine((v, ctx) => {
    if (v.style === "IMAGE" && !v.headerImageId) {
      ctx.addIssue({ code: "custom", path: ["headerImageId"], message: "Upload a header image" });
    }
  });
export type ReportTemplateInput = z.input<typeof reportTemplateSchema>;
export type ReportTemplateValues = z.output<typeof reportTemplateSchema>;

export interface ReportTemplateItem extends ReportTemplateValues {
  id: string;
  isDefault: boolean;
  updatedAt: string;
}

/** What a new template starts as. */
export const DEFAULT_TEMPLATE: ReportTemplateValues = {
  name: "Standard",
  style: "BUILT_IN",
  headerImageId: null,
  footerImageId: null,
  leftMarginMm: 11,
  rightMarginMm: 11,
  backgroundImageId: null,
  outsourceHeaderImageId: null,
  outsourceFooterImageId: null,
  outsourceFooterHeightMm: 20,
  headerHeightMm: 35,
  footerHeightMm: 20,
  accentColor: "#2D6A9F",
  fontFamily: "helvetica",
  lowColor: "#1D4ED8",
  highColor: "#B91C1C",
  showLogo: true,
  showSignatures: true,
  showQr: true,
  footerNote: null,
};

/** A few starting colours; any hex colour works. */
export const ACCENT_SWATCHES = ["#2D6A9F", "#0F766E", "#7C3AED", "#B91C1C", "#C2410C", "#111827"] as const;
/** Starting colours for low and high values. */
export const FLAG_SWATCHES = ["#1D4ED8", "#0E7490", "#7C3AED", "#B91C1C", "#C2410C", "#111827"] as const;

// ---------------------------------------------------------------------------
// Report doctors: who signs the report, and how the signature is laid out
// ---------------------------------------------------------------------------

/** Where the signature sits across the page: 0 = flush left, 50 = centred, 100 = flush right. Anything in between works. */
export type DoctorPosition = number;
export const DOCTOR_ALIGNMENTS = ["LEFT", "CENTER", "RIGHT"] as const;
export type DoctorAlignment = (typeof DOCTOR_ALIGNMENTS)[number];
export const DOCTOR_MODES = ["FIXED", "SELECT"] as const;
export type DoctorMode = (typeof DOCTOR_MODES)[number];

export const reportDoctorSchema = z.object({
  name: z.string().trim().min(1, "Enter the doctor's name").max(80),
  degree: z
    .string()
    .trim()
    .max(300)
    .nullable()
    .optional()
    .transform((v) => v || null),
  signatureId: z.uuid().nullable().optional().transform((v) => v ?? null),
  hideName: z.boolean(),
  position: z.coerce.number().int("Whole number").min(0, "At least 0").max(100, "At most 100"),
  nameFontSize: z.coerce.number().int().min(6, "At least 6").max(30, "At most 30"),
  degreeFontSize: z.coerce.number().int().min(5, "At least 5").max(24, "At most 24"),
  signatureSize: z.coerce.number().int().min(10, "At least 10").max(150, "At most 150"),
  spacing: z.coerce.number().min(0, "At least 0").max(40, "At most 40"),
  nameDegreeSpacing: z.coerce.number().min(0, "At least 0").max(40, "At most 40"),
  alignment: z.enum(DOCTOR_ALIGNMENTS),
  mode: z.enum(DOCTOR_MODES),
  endOfReport: z.boolean(),
  /** Department names; empty means all departments. */
  departments: z.array(z.string().trim().min(1).max(80)).max(60),
});
export type ReportDoctorInput = z.input<typeof reportDoctorSchema>;
export type ReportDoctorValues = z.output<typeof reportDoctorSchema>;
export interface ReportDoctorItem extends ReportDoctorValues {
  id: string;
}

export const DEFAULT_REPORT_DOCTOR: ReportDoctorValues = {
  name: "",
  degree: null,
  signatureId: null,
  hideName: false,
  position: 100,
  nameFontSize: 12,
  degreeFontSize: 9,
  signatureSize: 41,
  spacing: 1,
  nameDegreeSpacing: 1.5,
  alignment: "RIGHT",
  mode: "FIXED",
  endOfReport: false,
  departments: [],
};

// ---------------------------------------------------------------------------
// Bill print settings
// ---------------------------------------------------------------------------

export const BILL_SIZES = ["A4", "A5"] as const;
export type BillSize = (typeof BILL_SIZES)[number];

export const billSettingsSchema = z.object({
  /** Off: bills use the default report letterhead. On: the settings below apply. */
  custom: z.boolean(),
  heading: z.string().trim().min(1, "Enter a heading").max(60),
  size: z.enum(BILL_SIZES),
  headerImageId: z.uuid().nullable().optional().transform((v) => v ?? null),
  footerImageId: z.uuid().nullable().optional().transform((v) => v ?? null),
  headerHeightMm: z.coerce.number().int().min(0, "At least 0 mm").max(150, "At most 150 mm"),
  footerHeightMm: z.coerce.number().int().min(0, "At least 0 mm").max(150, "At most 150 mm"),
});
export type BillSettingsInput = z.input<typeof billSettingsSchema>;
export type BillSettings = z.output<typeof billSettingsSchema>;

export const DEFAULT_BILL_SETTINGS: BillSettings = {
  custom: false,
  heading: "BILL OF SUPPLY",
  size: "A4",
  headerImageId: null,
  footerImageId: null,
  headerHeightMm: 35,
  footerHeightMm: 20,
};

// ---------------------------------------------------------------------------
// My profile
// ---------------------------------------------------------------------------

export interface MyProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  qualification: string | null;
  registrationNo: string | null;
  signatureId: string | null;
  stampId: string | null;
  /** True when this person can approve results, so their signature prints on reports. */
  signsReports: boolean;
}
