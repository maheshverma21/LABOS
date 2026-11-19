import { z } from "zod";
import { normalizeIndianMobile, type PatientSex } from "./patients";

// ---------------------------------------------------------------------------
// Settings: each lab can use its own AiSensy account, or the platform's shared one.
// ---------------------------------------------------------------------------

export const whatsappSettingsSchema = z
  .object({
    enabled: z.boolean(),
    /** "own" uses the lab's AiSensy key; "shared" uses the platform account. */
    provider: z.enum(["own", "shared"]),
    /** Leave blank to keep the saved key. */
    apiKey: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .optional()
      .transform((v) => v || null),
    campaignName: z
      .string()
      .trim()
      .max(120)
      .nullable()
      .optional()
      .transform((v) => v || null),
  })
  .superRefine((v, ctx) => {
    if (v.enabled && v.provider === "own" && !v.campaignName) {
      ctx.addIssue({ code: "custom", path: ["campaignName"], message: "Enter the AiSensy campaign name" });
    }
  });
export type WhatsappSettingsInput = z.input<typeof whatsappSettingsSchema>;

export interface WhatsappSettings {
  enabled: boolean;
  provider: "own" | "shared";
  campaignName: string | null;
  /** The saved key is never sent back, only its last four characters. */
  apiKeyHint: string | null;
  /** Whether the platform's shared account is set up on this server. */
  sharedAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export const sendReportSchema = z.object({
  channel: z.literal("whatsapp"),
  /** Defaults to the patient's mobile. */
  to: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const m = normalizeIndianMobile(v);
      if (!m) {
        ctx.addIssue({ code: "custom", message: "Enter a 10-digit Indian mobile number" });
        return z.NEVER;
      }
      return m;
    }),
});
export type SendReportInput = z.input<typeof sendReportSchema>;

export const REPORT_LINK_DAYS = 90;

// ---------------------------------------------------------------------------
// API responses
// ---------------------------------------------------------------------------

export type DeliveryChannel = "WHATSAPP" | "LINK" | "COUNTER";

/** Marking a printed report as handed over; optionally who collected it. */
export const handOverSchema = z.object({
  to: z
    .string()
    .trim()
    .max(80)
    .nullable()
    .optional()
    .transform((v) => v || null),
});

/**
 * Where a report stands, for colour coding: tests still in progress, all
 * approved but not yet given to the patient, or given (WhatsApp or by hand)
 * since the last approval.
 */
export const REPORT_STATES = ["PENDING", "COMPLETED", "DELIVERED"] as const;
export type ReportState = (typeof REPORT_STATES)[number];
export const REPORT_STATE_LABEL: Record<ReportState, string> = { PENDING: "Pending", COMPLETED: "Completed", DELIVERED: "Delivered" };
export type DeliveryStatus = "SENT" | "FAILED";

export interface ReportDeliveryItem {
  id: string;
  channel: DeliveryChannel;
  to: string | null;
  status: DeliveryStatus;
  error: string | null;
  sentBy: string | null;
  createdAt: string;
}

/** Where an order's report stands. */
export interface ReportStatus {
  orderId: string;
  /** Tests that will print (not cancelled). */
  totalTests: number;
  approvedTests: number;
  amended: boolean;
  patientMobile: string | null;
  whatsappReady: boolean;
  deliveries: ReportDeliveryItem[];
}

export interface ReportListItem {
  orderId: string;
  orderNo: string;
  createdAt: string;
  patient: { id: string; uhid: string; salutation: string | null; name: string; sex: PatientSex; dob: string; dobEstimated: boolean; mobile: string | null };
  totalTests: number;
  approvedTests: number;
  lastApprovedAt: string | null;
  lastDelivery: ReportDeliveryItem | null;
  state: ReportState;
  tests: { name: string; status: string }[];
  doctor: string | null;
  account: string | null;
  /** Bill amount and what has been paid, in paise. */
  netPaise: number;
  paidPaise: number;
  /** Sample barcodes of the order. */
  barcodes: string[];
}

/** What the public report page shows before the PDF loads. */
export interface PublicReportInfo {
  lab: { name: string; phone: string | null };
  patientName: string;
  orderNo: string;
  orderDate: string;
  totalTests: number;
  approvedTests: number;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Report settings: which patient / order details print at the top of a report
// ---------------------------------------------------------------------------

/** Every detail the top of a printed report can show. */
export const REPORT_HEADER_FIELDS = [
  { key: "name", label: "Patient Name" },
  { key: "ageSex", label: "Age / Gender" },
  { key: "uhid", label: "Patient ID" },
  { key: "doctor", label: "Referred By" },
  { key: "patientType", label: "Patient Type" },
  { key: "phone", label: "Phone No." },
  { key: "email", label: "Email ID" },
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "district", label: "District" },
  { key: "pincode", label: "Pincode" },
  { key: "country", label: "Country" },
  { key: "passportNumber", label: "Passport Number" },
  { key: "orderNo", label: "Lab No." },
  { key: "barcode", label: "Barcode" },
  { key: "branch", label: "Collection Centre" },
  { key: "registeredAt", label: "Registration Date" },
  { key: "collectedAt", label: "Collected At" },
  { key: "receivedAt", label: "Received Date" },
  { key: "reportedAt", label: "Report Date" },
  { key: "reportStatus", label: "Report Status" },
] as const;

export type ReportHeaderFieldKey = (typeof REPORT_HEADER_FIELDS)[number]["key"];

const HEADER_KEYS = REPORT_HEADER_FIELDS.map((f) => f.key) as [ReportHeaderFieldKey, ...ReportHeaderFieldKey[]];

/** What reports print until a lab changes it: the layout reports have always had. */
export const DEFAULT_REPORT_HEADER_FIELDS: ReportHeaderFieldKey[] = [
  "name",
  "ageSex",
  "uhid",
  "doctor",
  "orderNo",
  "registeredAt",
  "collectedAt",
  "reportedAt",
];

export const reportHeaderSettingsSchema = z.object({
  /** Fields to print, in order. The number on each chip is its place in this list. */
  fields: z.array(z.enum(HEADER_KEYS)).min(1, "Pick at least one field").max(HEADER_KEYS.length)
    .refine((a) => new Set(a).size === a.length, "Each field can be picked once"),
  /** Custom labels by field key. A blank one keeps the default. */
  labels: z.record(z.string(), z.string().trim().max(40)).default({}),
});
export type ReportHeaderSettings = z.output<typeof reportHeaderSettingsSchema>;
export type ReportHeaderSettingsInput = z.input<typeof reportHeaderSettingsSchema>;

export const DEFAULT_REPORT_HEADER: ReportHeaderSettings = { fields: DEFAULT_REPORT_HEADER_FIELDS, labels: {} };
