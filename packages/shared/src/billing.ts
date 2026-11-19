import { z } from "zod";
import type { PatientListItem } from "./patients";
import type { OrderSample } from "./samples";

// ---------------------------------------------------------------------------
// Fixed lists
// ---------------------------------------------------------------------------

export const PAYMENT_MODES = ["CASH", "UPI", "CARD", "ONLINE"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  ONLINE: "Online / link",
};

export const DISCOUNT_TYPES = ["AMOUNT", "PERCENT"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export type OrderStatus = "ACTIVE" | "CANCELLED";
/** ON_ACCOUNT: billed to a B2B account; the patient pays nothing. */
export type PaymentStatus = "PAID" | "PARTIAL" | "UNPAID" | "CANCELLED" | "ON_ACCOUNT";

// ---------------------------------------------------------------------------
// Money maths shared by the order screen and the API, so they always agree.
// All amounts are integer paise.
// ---------------------------------------------------------------------------

export interface DiscountInput {
  type: DiscountType;
  /** Paise for AMOUNT; percent (0-100, up to 2 decimals) for PERCENT. */
  value: number;
}

export interface OrderTotals {
  grossPaise: number;
  discountPaise: number;
  netPaise: number;
}

export function computeTotals(linePrices: number[], discount: DiscountInput | null): OrderTotals {
  const grossPaise = linePrices.reduce((a, b) => a + b, 0);
  let discountPaise = 0;
  if (discount && discount.value > 0) {
    discountPaise =
      discount.type === "PERCENT" ? Math.round((grossPaise * Math.min(discount.value, 100)) / 100) : discount.value;
  }
  discountPaise = Math.min(Math.max(discountPaise, 0), grossPaise);
  return { grossPaise, discountPaise, netPaise: grossPaise - discountPaise };
}

export function paymentStatus(netPaise: number, paidPaise: number, cancelled: boolean, onAccount = false): PaymentStatus {
  if (cancelled) return "CANCELLED";
  if (onAccount) return "ON_ACCOUNT";
  if (paidPaise >= netPaise) return "PAID";
  return paidPaise > 0 ? "PARTIAL" : "UNPAID";
}

// ---------------------------------------------------------------------------
// Numbers and dates
// ---------------------------------------------------------------------------

/** Indian financial year (April to March) for an IST date "YYYY-MM-DD": "2026-27". */
export function financialYear(isoDate: string): string {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Bill number, unique and in sequence within a financial year (GST rule 46/49: max 16 chars). */
export const formatBillNo = (fy: string, n: number) => `B/${fy}/${String(n).padStart(6, "0")}`;

/** Lab number for the day, printed on bills and sample labels: "261004-0007". */
export const formatOrderNo = (isoDate: string, n: number) =>
  `${isoDate.slice(2, 4)}${isoDate.slice(5, 7)}${isoDate.slice(8, 10)}-${String(n).padStart(4, "0")}`;

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)]! + (n % 10 ? ` ${ONES[n % 10]}` : ""));
  } else if (n > 0) {
    parts.push(ONES[n]!);
  }
  return parts.join(" ");
}

/** Indian numbering in words: 125050 -> "One Lakh Twenty Five Thousand Fifty". */
export function numberToIndianWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${numberToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${below1000(lakh)} Lakh`);
  if (thousand) parts.push(`${below1000(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(" ");
}

/** "Rupees One Thousand Two Hundred and Fifty Paise Only". */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  return `Rupees ${numberToIndianWords(rupees)}${p ? ` and ${numberToIndianWords(p)} Paise` : ""} Only`;
}

// ---------------------------------------------------------------------------
// API input schemas
// ---------------------------------------------------------------------------

const paise = z.number().int().min(0).max(100_000_000);

export const paymentInputSchema = z.object({
  mode: z.enum(PAYMENT_MODES, "Pick a payment mode"),
  amountPaise: paise.min(1, "Enter an amount"),
  reference: z
    .string()
    .trim()
    .max(60)
    .nullable()
    .optional()
    .transform((v) => v || null),
});
export type PaymentInput = z.input<typeof paymentInputSchema>;

export const discountSchema = z
  .object({
    type: z.enum(DISCOUNT_TYPES),
    value: z.number().min(0),
    reason: z.string().trim().max(200).default(""),
  })
  .superRefine((d, ctx) => {
    if (d.type === "PERCENT" && (d.value > 100 || Math.round(d.value * 100) !== d.value * 100)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a percentage up to 100" });
    }
    if (d.type === "AMOUNT" && !Number.isInteger(d.value)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Amount must be in paise" });
    }
    if (d.value > 0 && d.reason.length < 3) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Give a reason for the discount" });
    }
  });

export const createOrderSchema = z.object({
  patientId: z.uuid("Pick a patient"),
  doctorId: z.uuid().nullable().optional().transform((v) => v ?? null),
  priceListId: z.uuid().nullable().optional().transform((v) => v ?? null),
  testIds: z
    .array(z.uuid())
    .min(1, "Add at least one test")
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, "A test was added twice"),
  discount: discountSchema.nullable().optional().transform((v) => (v && v.value > 0 ? v : null)),
  payments: z.array(paymentInputSchema).max(5).default([]),
  /** Bill to a B2B account: its rates apply and the patient pays nothing now. */
  accountId: z.uuid().nullable().optional().transform((v) => v ?? null),
  notes: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((v) => v || null),
  /** How barcodes are assigned: one per visit (patient), per tube (sample) or per department. */
  barcodeMode: z.enum(["patient", "sample", "department"]).optional().default("sample"),
  /** The lab's own barcode for the first tube (every tube when patient wise), instead of the generated one. */
  barcode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{4,32}$/, "Use 4 to 32 letters, digits or dashes")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null))
    .transform((v) => v || null),
});
export type CreateOrderInput = z.input<typeof createOrderSchema>;
export type CreateOrderOutput = z.output<typeof createOrderSchema>;

/** Tests added to a bill that was already made (forgotten at billing). */
export const addOrderTestsSchema = z.object({
  testIds: z
    .array(z.uuid())
    .min(1, "Pick at least one test")
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, "A test was picked twice"),
});

export const addPaymentSchema = z.object({ payments: z.array(paymentInputSchema).min(1).max(5) });

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason").max(200),
  /** How paid money goes back; required when something was paid. */
  refundMode: z.enum(PAYMENT_MODES).nullable().optional().transform((v) => v ?? null),
  refundReference: z
    .string()
    .trim()
    .max(60)
    .nullable()
    .optional()
    .transform((v) => v || null),
});

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface OrderListItem {
  id: string;
  orderNo: string;
  billNo: string;
  createdAt: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  grossPaise: number;
  discountPaise: number;
  netPaise: number;
  paidPaise: number;
  duePaise: number;
  /** The referring doctor's share of the bill (percent set on the doctor when the order was made, and the amount it came to). */
  commissionPercent: number | null;
  commissionPaise: number;
  testCount: number;
  patient: Pick<PatientListItem, "id" | "uhid" | "salutation" | "name" | "sex" | "dob" | "dobEstimated" | "phone">;
  doctor: { id: string; name: string } | null;
  branch: { id: string; name: string } | null;
  /** The B2B account billed, if any. */
  account: { id: string; code: string; name: string } | null;
}

export interface OrderPage {
  orders: OrderListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OrderItemDetail {
  id: string;
  testId: string;
  code: string;
  name: string;
  isPanel: boolean;
  /** What the test costs on its base rate. */
  basePricePaise: number;
  /** What was charged (price list or base), before the order discount. */
  pricePaise: number;
}

export interface PaymentDetail {
  id: string;
  kind: "PAYMENT" | "REFUND";
  mode: PaymentMode;
  amountPaise: number;
  reference: string | null;
  receivedBy: string | null;
  createdAt: string;
}

export interface OrderDetail extends OrderListItem {
  discountType: DiscountType | null;
  discountValue: number | null;
  discountReason: string | null;
  priceList: { id: string; name: string } | null;
  notes: string | null;
  createdBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  items: OrderItemDetail[];
  payments: PaymentDetail[];
  /** Tubes for this order, with the tests run on each. */
  samples: OrderSample[];
  /** For orders billed to an account, the invoice they're on. */
  invoice: { id: string; invoiceNo: string } | null;
  patient: OrderListItem["patient"] & { address: string | null; city: string | null };
  doctor: { id: string; name: string; qualification: string | null } | null;
  lab: { name: string; gstin: string | null; phone: string | null; email: string | null };
  branch: { id: string; name: string; address: string | null; phone: string | null } | null;
}

export interface CollectionsSummary {
  date: string;
  dateTo?: string;
  branch: { id: string; name: string } | null;
  byMode: { mode: PaymentMode; collectedPaise: number; refundedPaise: number }[];
  collectedPaise: number;
  refundedPaise: number;
  netPaise: number;
  /** Net amount taken by each person (payments minus refunds), cash apart. */
  byCollector: { name: string; cashPaise: number; otherPaise: number }[];
  orders: {
    count: number;
    billedPaise: number;
    discountPaise: number;
    /** Still owed by patients (orders billed to accounts aren't counted). */
    duePaise: number;
    /** Billed to B2B accounts today. */
    onAccountPaise: number;
    cancelled: number;
  };
  payments: (PaymentDetail & { orderId: string; orderNo: string; patientName: string })[];
  /** Payments from B2B accounts (also counted in the totals above). */
  accountPayments: { id: string; mode: PaymentMode; amountPaise: number; reference: string | null; receivedBy: string | null; createdAt: string; account: { id: string; name: string } }[];
}
