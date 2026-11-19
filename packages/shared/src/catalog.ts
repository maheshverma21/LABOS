import { z } from "zod";
import { cultureConfigSchema, REPORT_KINDS, type CultureConfig, type ReportKind } from "./culture";

// ---------------------------------------------------------------------------
// Fixed lists
// ---------------------------------------------------------------------------

export const SAMPLE_TYPES = [
  { key: "WB_EDTA", label: "Whole blood (EDTA)", container: "Lavender top (EDTA)" },
  { key: "SERUM", label: "Serum", container: "Red / yellow top (SST)" },
  { key: "PLASMA_FLUORIDE", label: "Fluoride plasma", container: "Grey top (fluoride)" },
  { key: "PLASMA_CITRATE", label: "Citrate plasma", container: "Light blue top (citrate)" },
  { key: "PLASMA_HEPARIN", label: "Heparin plasma", container: "Green top (heparin)" },
  { key: "URINE", label: "Urine", container: "Sterile urine container" },
  { key: "STOOL", label: "Stool", container: "Stool container" },
  { key: "SWAB", label: "Swab", container: "Swab with transport medium" },
  { key: "CSF", label: "CSF", container: "Sterile tube" },
  { key: "BODY_FLUID", label: "Body fluid", container: "Sterile container" },
  { key: "OTHER", label: "Other", container: "" },
] as const;

export type SampleTypeKey = (typeof SAMPLE_TYPES)[number]["key"];
const SAMPLE_TYPE_KEYS = SAMPLE_TYPES.map((s) => s.key) as [SampleTypeKey, ...SampleTypeKey[]];

export const sampleTypeLabel = (key: string) => SAMPLE_TYPES.find((s) => s.key === key)?.label ?? key;

export const RESULT_TYPES = ["NUMERIC", "TEXT", "OPTIONS"] as const;
export type ResultType = (typeof RESULT_TYPES)[number];

export const SEXES = ["ANY", "MALE", "FEMALE"] as const;
export type Sex = (typeof SEXES)[number];

// ---------------------------------------------------------------------------
// Money: the API stores and sends paise (integers); the UI shows rupees.
// ---------------------------------------------------------------------------

export const rupeesToPaise = (rupees: number) => Math.round(rupees * 100);
export const paiseToRupees = (paise: number) => paise / 100;

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
export const formatINR = (paise: number) => inr.format(paise / 100);

// ---------------------------------------------------------------------------
// Ages: ranges store days; people think in years, months and days.
// ---------------------------------------------------------------------------

export const AGE_UNITS = { days: 1, months: 30, years: 365 } as const;
export type AgeUnit = keyof typeof AGE_UNITS;

export function toDays(value: number, unit: AgeUnit) {
  return Math.round(value * AGE_UNITS[unit]);
}

/** 6570 -> { value: 18, unit: "years" }; picks the largest unit that divides evenly. */
export function fromDays(days: number): { value: number; unit: AgeUnit } {
  if (days % 365 === 0) return { value: days / 365, unit: "years" };
  if (days % 30 === 0) return { value: days / 30, unit: "months" };
  return { value: days, unit: "days" };
}

export function formatAgeBand(minDays: number | null, maxDays: number | null) {
  const f = (d: number) => {
    const { value, unit } = fromDays(d);
    return `${value} ${value === 1 ? unit.slice(0, -1) : unit}`;
  };
  if (minDays == null && maxDays == null) return "All ages";
  if (minDays == null) return `Under ${f(maxDays!)}`;
  if (maxDays == null) return `${f(minDays)} and over`;
  return `${f(minDays)} to ${f(maxDays)}`;
}

// ---------------------------------------------------------------------------
// Picking a range and flagging a value (used when results are entered)
// ---------------------------------------------------------------------------

export interface RangeLike {
  sex: Sex;
  ageMinDays: number | null;
  ageMaxDays: number | null;
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  text: string | null;
}

/**
 * The range that applies to a patient. The narrowest matching age band wins
 * (a neonatal range beats an all-ages one); for the same band, a sex-specific
 * range beats an ANY range.
 */
export function pickReferenceRange<R extends RangeLike>(ranges: R[], sex: "MALE" | "FEMALE", ageDays: number): R | null {
  const fits = ranges.filter(
    (r) =>
      (r.sex === "ANY" || r.sex === sex) &&
      (r.ageMinDays == null || ageDays >= r.ageMinDays) &&
      (r.ageMaxDays == null || ageDays < r.ageMaxDays),
  );
  const width = (r: R) => (r.ageMaxDays ?? 1e9) - (r.ageMinDays ?? 0);
  fits.sort((a, b) => width(a) - width(b) || Number(b.sex !== "ANY") - Number(a.sex !== "ANY"));
  return fits[0] ?? null;
}

export type ResultFlag = "CRITICAL_LOW" | "LOW" | "NORMAL" | "HIGH" | "CRITICAL_HIGH";

export function flagNumericResult(value: number, range: RangeLike | null): ResultFlag | null {
  if (!range) return null;
  if (range.criticalLow != null && value < range.criticalLow) return "CRITICAL_LOW";
  if (range.criticalHigh != null && value > range.criticalHigh) return "CRITICAL_HIGH";
  if (range.low != null && value < range.low) return "LOW";
  if (range.high != null && value > range.high) return "HIGH";
  if (range.low == null && range.high == null) return null;
  return "NORMAL";
}

/** "13.0 - 17.0", "< 200", "> 40", or the range's text. */
export function formatRange(range: Pick<RangeLike, "low" | "high" | "text">, decimals = 1) {
  if (range.text) return range.text;
  const f = (n: number) => n.toFixed(decimals);
  if (range.low != null && range.high != null) return `${f(range.low)} - ${f(range.high)}`;
  if (range.high != null) return `< ${f(range.high)}`;
  if (range.low != null) return `> ${f(range.low)}`;
  return "";
}

// ---------------------------------------------------------------------------
// API input schemas
// ---------------------------------------------------------------------------

const optionalNumber = z.number().finite().nullable().optional().transform((v) => v ?? null);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const referenceRangeSchema = z
  .object({
    sex: z.enum(SEXES).default("ANY"),
    ageMinDays: z.number().int().min(0).nullable().optional().transform((v) => v ?? null),
    ageMaxDays: z.number().int().min(1).nullable().optional().transform((v) => v ?? null),
    low: optionalNumber,
    high: optionalNumber,
    criticalLow: optionalNumber,
    criticalHigh: optionalNumber,
    text: optionalText(120),
  })
  .superRefine((r, ctx) => {
    if (isBlankRange(r)) return; // dropped by parameterSchema
    if (r.low != null && r.high != null && r.low > r.high) {
      ctx.addIssue({ code: "custom", path: ["high"], message: "High must be at least low" });
    }
    if (r.ageMinDays != null && r.ageMaxDays != null && r.ageMinDays >= r.ageMaxDays) {
      ctx.addIssue({ code: "custom", path: ["ageMaxDays"], message: "Max age must be above min age" });
    }
    if (r.criticalLow != null && r.low != null && r.criticalLow > r.low) {
      ctx.addIssue({ code: "custom", path: ["criticalLow"], message: "Critical low must be at or below low" });
    }
    if (r.criticalHigh != null && r.high != null && r.criticalHigh < r.high) {
      ctx.addIssue({ code: "custom", path: ["criticalHigh"], message: "Critical high must be at or above high" });
    }
    if (r.low == null && r.high == null && !r.text) {
      ctx.addIssue({ code: "custom", path: ["low"], message: "Enter a low or high limit, or a text range" });
    }
  });
export type ReferenceRangeInput = z.input<typeof referenceRangeSchema>;

function isBlankRange(r: unknown): boolean {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  const empty = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");
  return ["ageMinDays", "ageMaxDays", "low", "high", "criticalLow", "criticalHigh", "text"].every((k) => empty(o[k]));
}

export const parameterSchema = z
  .object({
    /** Present when editing an existing parameter. */
    id: z.uuid().optional(),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9_]{0,19}$/, "Letters, numbers and _ only, starting with a letter"),
    name: z.string().trim().min(1, "Name is required").max(120),
    unit: optionalText(30),
    /** Method this value is measured by, printed on the report. */
    method: optionalText(120),
    resultType: z.enum(RESULT_TYPES).default("NUMERIC"),
    decimals: z.number().int().min(0).max(4).default(1),
    options: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
    formula: optionalText(200),
    // Rows left completely blank in the editor are dropped rather than rejected.
    ranges: z
      .array(referenceRangeSchema)
      .max(20)
      .default([])
      .transform((rows) => rows.filter((r) => !isBlankRange(r))),
  })
  .superRefine((p, ctx) => {
    if (p.resultType === "OPTIONS" && p.options.length < 2) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Add at least two options" });
    }
    if (p.formula && p.resultType !== "NUMERIC") {
      ctx.addIssue({ code: "custom", path: ["formula"], message: "Only numeric parameters can be calculated" });
    }
  });
export type ParameterInput = z.input<typeof parameterSchema>;

export const testSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, "Up to 20 letters, numbers, - or _"),
    name: z.string().trim().min(2, "Name is required").max(160),
    departmentId: z.uuid("Pick a department"),
    isPanel: z.boolean().default(false),
    sampleType: z.enum(SAMPLE_TYPE_KEYS, "Pick a sample type"),
    container: optionalText(80),
    method: optionalText(120),
    tatHours: z.number().int().min(1, "At least 1 hour").max(24 * 60),
    pricePaise: z.number().int().min(0, "Price can't be negative").max(100_000_000),
    reportNotes: optionalText(2000),
    /** Clinical interpretation printed on the report after the results. */
    interpretation: optionalText(4000),
    /** STANDARD = numeric / text parameters; CULTURE = organism growth with an antibiotic sensitivity table. */
    reportKind: z.enum(REPORT_KINDS).default("STANDARD"),
    /** Antibiotic list and no-growth wording. Required for culture tests, ignored otherwise. */
    cultureConfig: cultureConfigSchema.nullable().optional(),
    parameters: z.array(parameterSchema).max(80).default([]),
    /** Tests inside a panel, in report order. */
    panelTestIds: z.array(z.uuid()).max(50).default([]),
  })
  .superRefine((t, ctx) => {
    if (t.isPanel) {
      if (t.panelTestIds.length < 2) {
        ctx.addIssue({ code: "custom", path: ["panelTestIds"], message: "A panel needs at least two tests" });
      }
      return;
    }
    if (t.reportKind === "CULTURE") {
      if (!t.cultureConfig) {
        ctx.addIssue({ code: "custom", path: ["cultureConfig"], message: "Set up the culture report" });
      } else if (t.cultureConfig.antibiotics.length === 0) {
        ctx.addIssue({ code: "custom", path: ["cultureConfig", "antibiotics"], message: "Add at least one antibiotic" });
      }
      return;
    }
    if (t.parameters.length === 0) {
      ctx.addIssue({ code: "custom", path: ["parameters"], message: "Add at least one parameter" });
    }
    const codes = new Set<string>();
    t.parameters.forEach((p, i) => {
      if (codes.has(p.code)) {
        ctx.addIssue({ code: "custom", path: ["parameters", i, "code"], message: "Codes must be unique in this test" });
      }
      codes.add(p.code);
    });
    t.parameters.forEach((p, i) => {
      if (!p.formula) return;
      const refs = p.formula.toUpperCase().match(/[A-Z][A-Z0-9_]*/g) ?? [];
      const unknown = refs.filter((r) => !codes.has(r) || r === p.code);
      if (unknown.length) {
        ctx.addIssue({
          code: "custom",
          path: ["parameters", i, "formula"],
          message: `Unknown code${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`,
        });
      }
      if (!/^[A-Z0-9_+\-*/(). ]+$/i.test(p.formula)) {
        ctx.addIssue({ code: "custom", path: ["parameters", i, "formula"], message: "Use codes, numbers and + - * / ( ) only" });
      }
    });
  });
export type TestInput = z.input<typeof testSchema>;
export type TestOutput = z.output<typeof testSchema>;

export const departmentSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80),
});

export const testStatusSchema = z.object({ isActive: z.boolean() });

export const PRICE_LIST_TYPES = ["DOCTOR", "HOSPITAL", "B2B"] as const;
export type PriceListType = (typeof PRICE_LIST_TYPES)[number];
export const PRICE_LIST_TYPE_LABELS: Record<PriceListType, string> = { DOCTOR: "Doctor", HOSPITAL: "Hospital", B2B: "B2B" };

export const priceListSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80),
  type: z.enum(PRICE_LIST_TYPES).default("B2B"),
});

export const COMMISSION_MODES = ["PERCENT", "AMOUNT"] as const;
export type CommissionMode = (typeof COMMISSION_MODES)[number];

/** A referring doctor's own price list: price and commission for each test or package. */
export const doctorPriceListSchema = z.object({
  commissionMode: z.enum(COMMISSION_MODES),
  items: z
    .array(
      z.object({
        testId: z.uuid(),
        pricePaise: z.number().int().min(0).max(100_000_000),
        commissionPercent: z.number().min(0, "At least 0").max(100, "At most 100").nullable(),
        commissionPaise: z.number().int().min(0).max(100_000_000).nullable(),
      }),
    )
    .max(5000),
});
export type DoctorPriceListInput = z.input<typeof doctorPriceListSchema>;

export const priceListItemsSchema = z.object({
  /** null price = remove the override and use the base price. */
  items: z
    .array(z.object({ testId: z.uuid(), pricePaise: z.number().int().min(0).max(100_000_000).nullable() }))
    .max(2000),
});

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface DepartmentItem {
  id: string;
  name: string;
  testCount: number;
}

export interface TestListItem {
  id: string;
  code: string;
  name: string;
  isPanel: boolean;
  isActive: boolean;
  sampleType: string;
  tatHours: number;
  pricePaise: number;
  department: { id: string; name: string };
  parameterCount: number;
  panelTestCount: number;
  reportKind?: ReportKind;
  /** Lab this test is sent to; null/absent when processed in-house. */
  outsourceLab?: { id: string; name: string } | null;
}

export interface ReferenceRangeDetail extends RangeLike {
  id: string;
}

export interface ParameterDetail {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  method: string | null;
  resultType: ResultType;
  decimals: number;
  options: string[];
  formula: string | null;
  ranges: ReferenceRangeDetail[];
}

export interface TestDetail extends Omit<TestListItem, "parameterCount" | "panelTestCount"> {
  departmentId: string;
  container: string | null;
  method: string | null;
  reportNotes: string | null;
  interpretation: string | null;
  cultureConfig: CultureConfig | null;
  parameters: ParameterDetail[];
  panelTests: { id: string; code: string; name: string; pricePaise: number }[];
  /** Panels that include this test. */
  usedInPanels: { id: string; code: string; name: string }[];
}

export interface PriceListSummary {
  id: string;
  name: string;
  type: PriceListType;
  itemCount: number;
}

export interface PriceListDetail {
  id: string;
  name: string;
  type: PriceListType;
  commissionMode: CommissionMode;
  items: { testId: string; pricePaise: number; commissionPercent: number | null; commissionPaise: number | null }[];
}
