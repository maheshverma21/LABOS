import { z } from "zod";
import { isRealIsoDate } from "./patients";
import { GSTIN_PATTERN } from "./lab";

// ---------------------------------------------------------------------------
// B2B labs: hospitals, clinics, corporates and labs with a prepaid wallet and a credit limit.
// ---------------------------------------------------------------------------

export const ACCOUNT_TYPES = ["HOSPITAL", "CLINIC", "CORPORATE", "LAB", "OTHER"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  HOSPITAL: "Hospital",
  CLINIC: "Clinic",
  CORPORATE: "Corporate",
  LAB: "Lab",
  OTHER: "Other",
};

export type InvoiceStatus = "ISSUED" | "PAID" | "VOID";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);
const isoDate = z.string().refine(isRealIsoDate, "Pick a date");

const flag = (v: boolean) => z.boolean().default(v);

/** The switches on a B2B lab's page. Only some change what the system does today; the rest are kept for the lab. */
export const SETTING_FLAGS = [
  { key: "printingLock", label: "Printing Lock", on: false },
  { key: "noPatientEditAfterApproval", label: "No patient edit after report approval", on: true },
  { key: "registrationBelowCreditMain", label: "Registration access below credit limit at main lab", on: true },
  { key: "registrationBelowCreditB2b", label: "Registration access below credit limit at B2B lab", on: true, enforced: true },
  { key: "reportDownloadBelowCreditB2b", label: "Report Download Below Credit Limit at B2B lab", on: true, enforced: true },
  { key: "disableCustomization", label: "Disable Customization", on: false },
  { key: "disableMrpPriceEdit", label: "Disable MRP Price Edit", on: false },
  { key: "hidePriceColumnFromPatientList", label: "Hide Price Column from Patient List", on: false },
  { key: "hideBillFromPatientList", label: "Hide Bill from Patient List", on: false },
  { key: "barcodeEdit", label: "Barcode edit", on: true, enforced: true },
  { key: "hideB2bRateFromBilling", label: "Hide B2B rate from billing", on: false, enforced: true },
  { key: "allowPatientWiseDueClearance", label: "Allow Patient wise due clearance", on: true },
  { key: "allowAddReferralDoctor", label: "Allow Add Referral Doctor", on: true, enforced: true },
  { key: "allowManualWhatsapp", label: "Allow Manual WhatsApp", on: false },
  { key: "autoSendReport", label: "Auto Send Report", on: false },
  { key: "showTatColumn", label: "Show TAT Column in Billing & Price List", on: false },
] as const;
export type SettingFlagKey = (typeof SETTING_FLAGS)[number]["key"];

export const labSettingsSchema = z.object({
  ...(Object.fromEntries(SETTING_FLAGS.map((f) => [f.key, flag(f.on)])) as Record<SettingFlagKey, z.ZodDefault<z.ZodBoolean>>),
  payment: z
    .object({ manual: flag(true), online: flag(true) })
    .default({ manual: true, online: true })
    .refine((p) => p.manual || p.online, "Pick at least one payment method"),
  bank: z
    .object({ bankName: optionalText(80), accountNumber: optionalText(30), ifsc: optionalText(15), pan: optionalText(12) })
    .default({ bankName: null, accountNumber: null, ifsc: null, pan: null }),
});
export type LabSettings = z.output<typeof labSettingsSchema>;

/** A B2B lab's own report letterhead: a full-page background image, with blank margins for the content. */
export const labLetterheadSchema = z.object({
  enabled: z.boolean().default(false),
  backgroundAssetId: z.uuid().nullable().optional().transform((v) => v ?? null),
  headerHeightMm: z.number().int().min(0, "At least 0").max(150, "At most 150").default(35),
  footerHeightMm: z.number().int().min(0, "At least 0").max(150, "At most 150").default(20),
  leftMarginMm: z.number().int().min(0, "At least 0").max(60, "At most 60").default(11),
  rightMarginMm: z.number().int().min(0, "At least 0").max(60, "At most 60").default(11),
});
export type LabLetterhead = z.output<typeof labLetterheadSchema>;

export const accountSchema = z.object({
  city: optionalText(80),
  settings: labSettingsSchema.default(() => labSettingsSchema.parse({})),
  letterhead: labLetterheadSchema.default(() => labLetterheadSchema.parse({})),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,12}$/, "2 to 12 letters or numbers"),
  name: z.string().trim().min(2, "Name is required").max(120),
  type: z.enum(ACCOUNT_TYPES).default("LAB"),
  contactName: optionalText(120),
  phone: optionalText(20),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .nullable()
    .optional()
    .transform((v) => v || null)
    .pipe(z.email("Enter a valid email").nullable()),
  address: optionalText(300),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .nullable()
    .optional()
    .transform((v) => v || null)
    .pipe(z.string().regex(GSTIN_PATTERN, "Enter a valid 15-character GSTIN").nullable()),
  /** Paise the net balance may go below zero; null for no limit. */
  creditLimitPaise: z.number().int().min(0).nullable().optional().transform((v) => v ?? null),
  /** Percent off base rates for tests the lab's price list doesn't set. */
  discountPercent: z.number().min(0, "0 or more").max(100, "At most 100").default(0),
  notes: optionalText(500),
});
export type AccountInput = z.input<typeof accountSchema>;

export const accountStatusSchema = z.object({ isActive: z.boolean() });

/** A person who signs in for the lab (the B2B client portal). */
export const accountLoginSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  email: z.email("Enter a valid email").toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});
export type AccountLoginInput = z.input<typeof accountLoginSchema>;

export const createInvoiceSchema = z
  .object({ periodFrom: isoDate, periodTo: isoDate })
  .refine((v) => v.periodFrom <= v.periodTo, { path: ["periodTo"], message: "The end must be on or after the start" });

export const voidInvoiceSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(300) });

export const topUpSchema = z.object({
  accountId: z.uuid("Pick a lab"),
  mode: z.enum(["CASH", "UPI", "CARD", "ONLINE"]),
  amountPaise: z.number().int().positive("Enter an amount").max(100_000_000_00, "That's too much"),
  reference: optionalText(80),
});
export type TopUpInput = z.input<typeof topUpSchema>;

export const noteSchema = z.object({
  accountId: z.uuid("Pick a lab"),
  kind: z.enum(["CREDIT", "DEBIT"]),
  amountPaise: z.number().int().positive("Enter an amount").max(100_000_000_00, "That's too much"),
  reason: z.string().trim().min(3, "Give a reason").max(300),
});
export type NoteInput = z.input<typeof noteSchema>;


export const accountPriceListSchema = z.object({
  items: z
    .array(z.object({ testId: z.uuid(), pricePaise: z.number().int().min(0).max(100_000_000) }))
    .max(5000),
});

/** One price change applied to several labs: fixed prices for chosen tests, or a percentage on base prices. */
export const bulkPriceSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("FIXED"),
    accountIds: z.array(z.uuid()).min(1, "Pick at least one lab").max(500),
    items: z.array(z.object({ testId: z.uuid(), pricePaise: z.number().int().min(0).max(100_000_000) })).min(1, "Pick at least one test").max(5000),
  }),
  z.object({
    mode: z.literal("PERCENT"),
    accountIds: z.array(z.uuid()).min(1, "Pick at least one lab").max(500),
    /** Change from the base price: -20 is 20% cheaper, 10 is 10% dearer. */
    percent: z.number().min(-100, "At most 100% off").max(500),
    /** Empty means every test. */
    testIds: z.array(z.uuid()).max(5000).default([]),
  }),
]);
export type BulkPriceInput = z.input<typeof bulkPriceSchema>;

export const bulkAccountsSchema = z.object({ rows: z.array(z.unknown()).min(1, "The file has no rows").max(500, "Upload at most 500 labs at a time") });
export interface BulkAccountsResult {
  created: number;
  errors: { row: number; message: string }[];
}

/** The first and last day of the month before `isoDate`, e.g. for a monthly invoice. */
export function previousMonth(isoDate: string): { from: string; to: string } {
  const [y, m] = isoDate.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 2, 1));
  const last = new Date(Date.UTC(y, m - 1, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(first), to: iso(last) };
}

/** What a lab can still order: wallet minus holds, plus its credit. Null means no limit. */
export function availablePaise(a: { walletPaise: number; holdPaise: number; creditLimitPaise: number | null }): number | null {
  return a.creditLimitPaise == null ? null : a.walletPaise - a.holdPaise + a.creditLimitPaise;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface AccountListItem {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  priceList: { id: string; name: string } | null;
  creditLimitPaise: number | null;
  discountPercent: number;
  /** Prepaid money; negative once the lab is using its credit. */
  walletPaise: number;
  /** Reserved for orders the lab hasn't received a tube for yet. */
  holdPaise: number;
  /** Wallet minus hold. */
  netPaise: number;
  isActive: boolean;
  loginCount: number;
}

/** What a B2B client's screens may switch on or off. */
export interface PortalFeatures {
  barcodeEdit: boolean;
  allowAddReferralDoctor: boolean;
  hideB2bRateFromBilling: boolean;
}

export interface AccountLoginItem {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface AccountDetail extends AccountListItem {
  city: string | null;
  settings: LabSettings;
  letterhead: LabLetterhead;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  logins: AccountLoginItem[];
}

export type WalletTxnKind = "OPENING" | "TOPUP" | "ORDER" | "REFUND" | "CREDIT_NOTE" | "DEBIT_NOTE";
export const WALLET_KIND_LABEL: Record<WalletTxnKind, string> = {
  OPENING: "Opening balance",
  TOPUP: "Money added",
  ORDER: "Order",
  REFUND: "Order refund",
  CREDIT_NOTE: "Credit note",
  DEBIT_NOTE: "Debit note",
};

export interface WalletTxnItem {
  id: string;
  createdAt: string;
  kind: WalletTxnKind;
  /** Positive adds money, negative takes it. */
  amountPaise: number;
  balanceAfterPaise: number;
  mode: "CASH" | "UPI" | "CARD" | "ONLINE" | null;
  reference: string | null;
  narration: string | null;
  orderNo: string | null;
  account: { id: string; code: string; name: string };
}

export interface WalletHistoryPage {
  entries: WalletTxnItem[];
  /** True when more matched than were returned. */
  truncated: boolean;
}

export interface LedgerResponse {
  account: { id: string; code: string; name: string };
  from: string;
  to: string;
  openingPaise: number;
  closingPaise: number;
  creditPaise: number;
  debitPaise: number;
  entries: WalletTxnItem[];
}

export interface DayBalanceRow {
  date: string;
  creditPaise: number;
  debitPaise: number;
  /** All labs' wallets together at the end of the day. */
  closingPaise: number;
}

export interface LabBalanceRow {
  account: { id: string; code: string; name: string };
  openingPaise: number;
  creditPaise: number;
  debitPaise: number;
  closingPaise: number;
  holdPaise: number;
}

export interface AccountNoteItem {
  id: string;
  noteNo: string;
  kind: "CREDIT" | "DEBIT";
  amountPaise: number;
  reason: string;
  createdAt: string;
  account: { id: string; code: string; name: string };
}

export type InvoiceListItemBase = {
  id: string;
  invoiceNo: string;
  periodFrom: string;
  periodTo: string;
  totalPaise: number;
  status: InvoiceStatus;
  issuedAt: string;
  orderCount: number;
  voidReason: string | null;
};
export interface InvoiceListItem extends InvoiceListItemBase {
  account?: { id: string; code: string; name: string };
}

export interface AccountOrderItem {
  id: string;
  orderNo: string;
  createdAt: string;
  patient: { name: string; uhid: string };
  tests: string[];
  netPaise: number;
  invoiceNo: string | null;
}

export interface InvoiceDetail extends InvoiceListItemBase {
  account: { id: string; code: string; name: string; contactName: string | null; address: string | null; gstin: string | null; phone: string | null; email: string | null };
  lab: { name: string; gstin: string | null; phone: string | null; email: string | null };
  orders: AccountOrderItem[];
}

// ---------------------------------------------------------------------------
// The B2B client portal
// ---------------------------------------------------------------------------

export interface PortalSummary {
  account: { id: string; code: string; name: string; creditLimitPaise: number | null; walletPaise: number; holdPaise: number; netPaise: number; discountPercent: number };
  features: PortalFeatures;
  /** Report downloads are paused: the balance is below the credit limit. */
  reportsBlocked: boolean;
  /** What the lab can still order right now; null when there is no limit. */
  availablePaise: number | null;
  orders: { today: number; pendingReports: number; ready: number };
}

export interface PortalOrderItem {
  id: string;
  orderNo: string;
  createdAt: string;
  status: "ACTIVE" | "CANCELLED";
  patient: { id: string; name: string; uhid: string; phone: string | null };
  tests: string[];
  netPaise: number;
  /** Held until the lab receives a tube, then taken from the wallet. */
  settled: boolean;
  /** Tests approved / tests ordered. */
  approvedTests: number;
  totalTests: number;
  reportReady: boolean;
  cancellable: boolean;
}

export const portalOrderSchema = z.object({
  patientId: z.uuid("Pick a patient"),
  testIds: z.array(z.uuid()).min(1, "Pick at least one test").max(60),
  /** Tests marked urgent: the lab sees them in the order's notes. */
  urgentTestIds: z.array(z.uuid()).max(60).default([]),
  /** The client's own barcode for the sample, if they already stuck one on. */
  barcode: optionalText(40),
  notes: optionalText(300),
});
export type PortalOrderInput = z.input<typeof portalOrderSchema>;
export type PortalOrderOutput = z.output<typeof portalOrderSchema>;
