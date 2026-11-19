import { z } from "zod";

// ---------------------------------------------------------------------------
// Fixed lists
// ---------------------------------------------------------------------------

export const PATIENT_SEXES = ["MALE", "FEMALE", "OTHER"] as const;
export type PatientSex = (typeof PATIENT_SEXES)[number];
export const SEX_LABEL: Record<PatientSex, string> = { MALE: "Male", FEMALE: "Female", OTHER: "Other" };
export const SEX_SHORT: Record<PatientSex, string> = { MALE: "M", FEMALE: "F", OTHER: "O" };

/** Titles, and the sex each one implies (used to pre-fill the form). */
export const SALUTATIONS = [
  { key: "Mr", sex: "MALE" },
  { key: "Mrs", sex: "FEMALE" },
  { key: "Ms", sex: "FEMALE" },
  { key: "Master", sex: "MALE" },
  { key: "Baby", sex: null },
  { key: "Dr", sex: null },
] as const satisfies readonly { key: string; sex: PatientSex | null }[];
export type Salutation = (typeof SALUTATIONS)[number]["key"];
const SALUTATION_KEYS = SALUTATIONS.map((s) => s.key) as [Salutation, ...Salutation[]];

// ---------------------------------------------------------------------------
// Phones and IDs
// ---------------------------------------------------------------------------

/** "+91 98765-43210", "098765 43210" -> "9876543210"; anything else -> null. */
export function normalizeIndianMobile(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export const formatMobile = (m: string) => (m.length === 10 ? `${m.slice(0, 5)} ${m.slice(5)}` : m);

/** ABHA number: 14 digits, shown as 12-3456-7890-1234. */
export function normalizeAbhaNumber(input: string): string | null {
  const d = input.replace(/\D/g, "");
  return d.length === 14 ? d : null;
}
export const formatAbhaNumber = (d: string) =>
  d.length === 14 ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10)}` : d;

// ---------------------------------------------------------------------------
// Age and date of birth (dates are "YYYY-MM-DD" strings, no time zone)
// ---------------------------------------------------------------------------

export interface Age {
  years: number;
  months: number;
  days: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** A real calendar date as YYYY-MM-DD ("2026-02-30" and "2026-13-01" are not). */
export function isRealIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const toIsoDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
/** Today in India, as YYYY-MM-DD (labs report in IST whatever the server's zone). */
export function todayIST(now = new Date()) {
  return toIsoDate(new Date(now.getTime() + 330 * 60_000));
}

/** dob + n months, clamped to the end of a shorter month (31 Jan + 1 month = 28/29 Feb). */
function addMonthsClamped(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay)));
}

/** Exact age on a date (default: today in IST). */
export function ageOn(dob: string, on: string = todayIST()): Age {
  const b = parseIso(dob);
  const t = parseIso(on);
  // Whole months completed, then the days left over.
  let total = (t.getUTCFullYear() - b.getUTCFullYear()) * 12 + (t.getUTCMonth() - b.getUTCMonth());
  if (addMonthsClamped(b, total) > t) total -= 1;
  const days = Math.round((t.getTime() - addMonthsClamped(b, total).getTime()) / 86_400_000);
  return { years: Math.floor(total / 12), months: total % 12, days };
}

export function ageInDays(dob: string, on: string = todayIST()) {
  return Math.round((parseIso(on).getTime() - parseIso(dob).getTime()) / 86_400_000);
}

/**
 * Estimated date of birth for an age given in years, months and days.
 * Near month ends a few ages have no exact inverse (nothing is "1 month before
 * 31 March"), so ageOn() of the result can differ by up to 3 days.
 */
export function dobFromAge(age: Age, on: string = todayIST()): string {
  // The inverse of ageOn: step back the days first, then the whole months.
  const anchor = new Date(parseIso(on).getTime() - age.days * 86_400_000);
  return toIsoDate(addMonthsClamped(anchor, -(age.years * 12 + age.months)));
}

/** How labs write age on a report: "35 Y", "1 Y 4 M", "8 M 12 D", "5 D". */
export function formatAge(age: Age): string {
  if (age.years >= 5) return `${age.years} Y`;
  if (age.years >= 1) return age.months ? `${age.years} Y ${age.months} M` : `${age.years} Y`;
  if (age.months >= 1) return age.days ? `${age.months} M ${age.days} D` : `${age.months} M`;
  return `${age.days} D`;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const mobile = (message: string) =>
  z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const n = normalizeIndianMobile(v);
      if (!n) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return n;
    });

const isoDate = z.string().refine(isRealIsoDate, "Use a valid date");

export const ageSchema = z.object({
  years: z.number().int().min(0).max(120).default(0),
  months: z.number().int().min(0).max(11).default(0),
  days: z.number().int().min(0).max(30).default(0),
});

export const patientSchema = z
  .object({
    salutation: z.enum(SALUTATION_KEYS).nullable().optional().transform((v) => v ?? null),
    name: z.string().trim().min(2, "Name is required").max(120),
    sex: z.enum(PATIENT_SEXES, "Pick a sex"),
    /** Give either the date of birth... */
    dob: isoDate.nullable().optional().transform((v) => v ?? null),
    /** ...or the age; it's turned into an estimated date of birth. */
    age: ageSchema.nullable().optional().transform((v) => v ?? null),
    phone: mobile("Enter a 10-digit mobile number"),
    altPhone: mobile("Enter a 10-digit mobile number"),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .nullable()
      .optional()
      .transform((v) => v || null)
      .pipe(z.email("Enter a valid email").nullable()),
    address: optionalText(300),
    city: optionalText(80),
    pincode: z
      .string()
      .trim()
      .nullable()
      .optional()
      .transform((v) => v || null)
      .pipe(z.string().regex(/^[1-9]\d{5}$/, "Enter a 6-digit pincode").nullable()),
    abhaNumber: z
      .string()
      .trim()
      .nullable()
      .optional()
      .transform((v, ctx) => {
        if (!v) return null;
        const n = normalizeAbhaNumber(v);
        if (!n) {
          ctx.addIssue({ code: "custom", message: "ABHA number has 14 digits" });
          return z.NEVER;
        }
        return n;
      }),
    abhaAddress: z
      .string()
      .trim()
      .toLowerCase()
      .nullable()
      .optional()
      .transform((v) => v || null)
      .pipe(z.string().regex(/^[a-z0-9._]{4,32}@(abdm|sbx)$/, "Looks like name@abdm").nullable()),
    patientType: optionalText(40),
    phoneBelongsTo: optionalText(20),
    organisation: optionalText(120),
    referral: optionalText(120),
    state: optionalText(80),
    district: optionalText(80),
    passportNumber: optionalText(40),
    barcode: optionalText(40),
    country: optionalText(80),
    notes: optionalText(500),
  })
  .superRefine((p, ctx) => {
    if (!p.dob && !p.age) {
      ctx.addIssue({ code: "custom", path: ["dob"], message: "Enter the date of birth or the age" });
      return;
    }
    if (p.dob) {
      const today = todayIST();
      if (p.dob > today) ctx.addIssue({ code: "custom", path: ["dob"], message: "Date of birth can't be in the future" });
      else if (ageOn(p.dob, today).years > 120) ctx.addIssue({ code: "custom", path: ["dob"], message: "Check the date of birth" });
    }
    if (!p.dob && p.age && p.age.years + p.age.months + p.age.days === 0) {
      ctx.addIssue({ code: "custom", path: ["age"], message: "Enter the age" });
    }
  })
  .transform(({ age, ...p }) => ({
    ...p,
    dob: p.dob ?? dobFromAge(age!),
    dobEstimated: !p.dob,
  }));

export type PatientInput = z.input<typeof patientSchema>;
export type PatientOutput = z.output<typeof patientSchema>;

export const createPatientSchema = patientSchema.and(
  z.object({
    /** DPDP Act: the patient (or guardian) agreed to their data being processed. */
    consent: z.literal(true, "The patient's consent is required"),
    /** Register even though a similar patient exists. */
    allowDuplicate: z.boolean().default(false),
  }),
);
export type CreatePatientInput = z.input<typeof createPatientSchema>;

export const doctorSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  qualification: optionalText(80),
  specialty: optionalText(80),
  phone: mobile("Enter a 10-digit mobile number"),
  clinicName: optionalText(120),
  city: optionalText(80),
  /** Share of each order's net amount owed to the doctor; applied when they are picked on an order. */
  commissionPercent: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v == null || (typeof v === "string" && v.trim() === "")) return 0;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100 || Math.round(n * 100) !== n * 100) {
        ctx.addIssue({ code: "custom", message: "Enter a percentage from 0 to 100 (up to 2 decimals)" });
        return z.NEVER;
      }
      return n;
    }),
  /** Price list used when this doctor is picked at registration. */
  priceListId: z.uuid().nullable().optional().transform((v) => v ?? null),
});
export type DoctorInput = z.input<typeof doctorSchema>;

export const doctorStatusSchema = z.object({ isActive: z.boolean() });

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface PatientListItem {
  id: string;
  uhid: string;
  salutation: string | null;
  name: string;
  sex: PatientSex;
  dob: string;
  dobEstimated: boolean;
  phone: string | null;
  createdAt: string;
}

export interface PatientDetail extends PatientListItem {
  altPhone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  abhaNumber: string | null;
  abhaAddress: string | null;
  patientType: string | null;
  phoneBelongsTo: string | null;
  organisation: string | null;
  referral: string | null;
  state: string | null;
  district: string | null;
  passportNumber: string | null;
  barcode: string | null;
  country: string | null;
  notes: string | null;
  consentAt: string | null;
  registeredBranch: { id: string; name: string } | null;
  updatedAt: string;
}

export interface PatientPage {
  patients: PatientListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DoctorItem {
  id: string;
  name: string;
  qualification: string | null;
  specialty: string | null;
  phone: string | null;
  clinicName: string | null;
  city: string | null;
  commissionPercent: number;
  priceList: { id: string; name: string } | null;
  isActive: boolean;
}

/** Returned with a 409 when a similar patient already exists. */
export interface DuplicatePatientDetails {
  candidates: PatientListItem[];
}

const ABBREVIATED = new Set(["Mr", "Mrs", "Ms", "Dr"]);

/** "Mrs. Asha Rao", "Master Arjun", "Baby Riya". */
export const patientDisplayName = (p: { salutation: string | null; name: string }) =>
  p.salutation ? `${p.salutation}${ABBREVIATED.has(p.salutation) ? "." : ""} ${p.name}` : p.name;
