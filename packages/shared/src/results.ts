import { z } from "zod";
import { flagNumericResult, pickReferenceRange, type RangeLike, type ResultFlag, type ResultType } from "./catalog";
import { cultureResultSchema, type CultureConfig, type CultureResult } from "./culture";
import type { PatientSex } from "./patients";
import type { OrderTestStatus } from "./samples";

// ---------------------------------------------------------------------------
// Formulas: codes, numbers, + - * / and brackets. Parsed, never eval'd.
// ---------------------------------------------------------------------------

type Token = { kind: "num"; value: number } | { kind: "code"; value: string } | { kind: "op"; value: string };

function tokenize(formula: string): Token[] | null {
  const tokens: Token[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z][A-Za-z0-9_]*)|([-+*/()]))/y;
  let i = 0;
  while (i < formula.length) {
    if (/\s/.test(formula[i]!)) {
      i++;
      continue;
    }
    re.lastIndex = i;
    const m = re.exec(formula);
    if (!m) return null;
    if (m[1]) tokens.push({ kind: "num", value: Number(m[1]) });
    else if (m[2]) tokens.push({ kind: "code", value: m[2].toUpperCase() });
    else tokens.push({ kind: "op", value: m[3]! });
    i = re.lastIndex;
  }
  return tokens;
}

/**
 * Evaluates a formula such as "TCHOL - HDL - TG / 5" with the given values.
 * Returns null if a value is missing, the formula is malformed, or it divides by zero.
 */
export function evaluateFormula(formula: string, values: Record<string, number | null | undefined>): number | null {
  const parsed = tokenize(formula);
  if (!parsed) return null;
  const tokens: Token[] = parsed;
  let pos = 0;
  const peek = () => tokens[pos];

  // expr := term (('+'|'-') term)* ; term := factor (('*'|'/') factor)* ; factor := num | code | '(' expr ')' | '-' factor
  function factor(): number | null {
    const t = tokens[pos++];
    if (!t) return null;
    if (t.kind === "num") return t.value;
    if (t.kind === "code") {
      const v = values[t.value];
      return v == null || Number.isNaN(v) ? null : v;
    }
    if (t.value === "-") {
      const v = factor();
      return v == null ? null : -v;
    }
    if (t.value === "(") {
      const v = expr();
      if (peek()?.kind !== "op" || peek()!.value !== ")") return null;
      pos++;
      return v;
    }
    return null;
  }
  function term(): number | null {
    let left = factor();
    while (left != null && peek()?.kind === "op" && (peek()!.value === "*" || peek()!.value === "/")) {
      const op = tokens[pos++]!.value;
      const right = factor();
      if (right == null) return null;
      if (op === "/" && right === 0) return null;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }
  function expr(): number | null {
    let left = term();
    while (left != null && peek()?.kind === "op" && (peek()!.value === "+" || peek()!.value === "-")) {
      const op = tokens[pos++]!.value;
      const right = term();
      if (right == null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  const result = expr();
  return pos === tokens.length && result != null && Number.isFinite(result) ? result : null;
}

// ---------------------------------------------------------------------------
// Ranges and flags for a patient
// ---------------------------------------------------------------------------

/** The reference range for a patient; patients of "other" sex get the ANY ranges only. */
export function rangeForPatient<R extends RangeLike>(ranges: R[], sex: PatientSex, ageDays: number): R | null {
  if (sex === "OTHER") return pickReferenceRange(ranges.filter((r) => r.sex === "ANY"), "MALE", ageDays);
  return pickReferenceRange(ranges, sex, ageDays);
}

export const FLAG_LABEL: Record<ResultFlag, string> = {
  CRITICAL_LOW: "Critical low",
  LOW: "Low",
  NORMAL: "",
  HIGH: "High",
  CRITICAL_HIGH: "Critical high",
};
export const FLAG_SHORT: Record<ResultFlag, string> = {
  CRITICAL_LOW: "L!",
  LOW: "L",
  NORMAL: "",
  HIGH: "H",
  CRITICAL_HIGH: "H!",
};
export const isCritical = (f: ResultFlag | null | undefined) => f === "CRITICAL_LOW" || f === "CRITICAL_HIGH";

/** Parses a typed numeric result: "13.4", " 13,4 ", "<0.5" is not numeric. */
export function parseNumericResult(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

export function flagFor(resultType: ResultType, value: string | null, range: RangeLike | null): ResultFlag | null {
  if (value == null || value === "" || !range) return null;
  if (resultType === "NUMERIC") {
    const n = parseNumericResult(value);
    return n == null ? null : flagNumericResult(n, range);
  }
  // Text and pick-from-list results are abnormal when they differ from the normal value.
  if (range.text) return value.trim().toLowerCase() === range.text.trim().toLowerCase() ? "NORMAL" : "HIGH";
  return null;
}

// ---------------------------------------------------------------------------
// API input
// ---------------------------------------------------------------------------

export const saveResultsSchema = z.object({
  /** parameterId -> typed value ("" or null clears it). */
  values: z.record(z.uuid(), z.string().trim().max(200).nullable()),
  remarks: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .optional()
    .transform((v) => v || null),
  /** Culture tests only: growth or no growth, with organisms and their sensitivities. Omit to leave unchanged. */
  culture: cultureResultSchema.nullable().optional(),
  /** Also send the test for approval. */
  submit: z.boolean().default(false),
});
export type SaveResultsInput = z.input<typeof saveResultsSchema>;

export const approveSchema = z.object({ orderTestIds: z.array(z.uuid()).min(1).max(100) });
export const sendBackSchema = z.object({ note: z.string().trim().min(3, "Say what needs checking").max(300) });
export const reopenSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(300) });

// ---------------------------------------------------------------------------
// API responses
// ---------------------------------------------------------------------------

export interface ResultParameter {
  parameterId: string;
  code: string;
  name: string;
  unit: string | null;
  resultType: ResultType;
  decimals: number;
  options: string[];
  formula: string | null;
  /** The range that applies to this patient, from the catalog (or as saved, once entered). */
  range: (RangeLike & { id?: string }) | null;
  value: string | null;
  flag: ResultFlag | null;
  /** The analyzer that sent the value, when it wasn't typed in. */
  source: string | null;
  previous: { value: string; flag: ResultFlag | null; date: string } | null;
}

export interface ResultTest {
  orderTestId: string;
  code: string;
  name: string;
  department: string;
  status: OrderTestStatus;
  sampleBarcode: string | null;
  remarks: string | null;
  sendBackNote: string | null;
  reportNotes: string | null;
  enteredBy: string | null;
  enteredAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  /** Set when the test is sent to another lab. */
  outsourceLab: string | null;
  /** The report file that came back from that lab, if uploaded. */
  outsourceFile: { name: string; mime: string; size: number; addLetterhead: boolean } | null;
  parameters: ResultParameter[];
  /** Set for culture & sensitivity tests: the catalog setup and what has been entered so far. */
  culture: { config: CultureConfig; data: CultureResult | null } | null;
}

export interface ResultSheet {
  order: { id: string; orderNo: string; createdAt: string; status: "ACTIVE" | "CANCELLED"; doctor: string | null };
  patient: { id: string; uhid: string; salutation: string | null; name: string; sex: PatientSex; dob: string; dobEstimated: boolean; ageDays: number };
  tests: ResultTest[];
}

export interface WorklistOrder {
  orderId: string;
  orderNo: string;
  createdAt: string;
  patient: { id: string; uhid: string; salutation: string | null; name: string; sex: PatientSex; dob: string; dobEstimated: boolean };
  tests: { orderTestId: string; code: string; name: string; department: string; status: OrderTestStatus; critical: boolean }[];
  /** Referring doctor and B2B account, as on the Reports page. */
  doctor: string | null;
  account: string | null;
  /** Every test on the order, not just those in this list. */
  totalTests: number;
  approvedTests: number;
  /** Sample barcodes of the order. */
  barcodes: string[];
}
