import { z } from "zod";
import type { PatientListItem } from "./patients";

export const SAMPLE_STATUSES = ["PENDING", "COLLECTED", "RECEIVED", "REJECTED", "CANCELLED"] as const;
export type SampleStatus = (typeof SAMPLE_STATUSES)[number];
export const SAMPLE_STATUS_LABEL: Record<SampleStatus, string> = {
  PENDING: "To collect",
  COLLECTED: "Collected",
  RECEIVED: "In lab",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

/** Where each ordered test is in its journey. */
export const ORDER_TEST_STATUSES = ["AWAITING_SAMPLE", "IN_LAB", "ENTERED", "SUBMITTED", "APPROVED", "CANCELLED"] as const;
export type OrderTestStatus = (typeof ORDER_TEST_STATUSES)[number];
export const ORDER_TEST_STATUS_LABEL: Record<OrderTestStatus, string> = {
  AWAITING_SAMPLE: "Awaiting sample",
  IN_LAB: "In lab",
  ENTERED: "Results entered",
  SUBMITTED: "Awaiting approval",
  APPROVED: "Approved",
  CANCELLED: "Cancelled",
};

export const REJECT_REASONS = [
  "Haemolysed",
  "Clotted",
  "Insufficient quantity",
  "Wrong container",
  "Unlabelled or mislabelled",
  "Leaked or broken",
  "Lipaemic",
  "Other",
] as const;

/** Barcode for the nth sample of an order: lab number digits + 2-digit index, e.g. 261004000701. */
export const formatBarcode = (orderNo: string, index: number) =>
  `${orderNo.replace(/\D/g, "")}${String(index).padStart(2, "0")}`;

/** Barcodes are the generated lab-number digits, or whatever the lab typed in when relabelling a tube. */
export const SAMPLE_BARCODE_PATTERN = /^[A-Za-z0-9-]{4,32}$/;

export const editBarcodeSchema = z.object({
  barcode: z
    .string()
    .trim()
    .regex(SAMPLE_BARCODE_PATTERN, "Use 4 to 32 letters, numbers or dashes")
    .transform((v) => v.toUpperCase()),
});

export const sampleIdsSchema = z.object({ sampleIds: z.array(z.uuid()).min(1).max(50) });

export const receiveSchema = z.object({
  /** Scanned barcodes or sample ids; at least one of them. */
  barcodes: z.array(z.string().trim().regex(SAMPLE_BARCODE_PATTERN, "Not a sample barcode")).max(50).default([]),
  sampleIds: z.array(z.uuid()).max(50).default([]),
}).refine((v) => v.barcodes.length + v.sampleIds.length > 0, "Scan or pick at least one sample");

export const rejectSampleSchema = z.object({
  reason: z.enum(REJECT_REASONS, "Pick a reason"),
  note: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => v || null),
});

export interface SampleTest {
  id: string;
  code: string;
  name: string;
  status: OrderTestStatus;
}

export interface SampleItem {
  id: string;
  barcode: string;
  sampleType: string;
  container: string | null;
  status: SampleStatus;
  createdAt: string;
  collectedAt: string | null;
  collectedBy: string | null;
  receivedAt: string | null;
  receivedBy: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  tests: SampleTest[];
  order: {
    id: string;
    orderNo: string;
    createdAt: string;
    patient: Pick<PatientListItem, "id" | "uhid" | "salutation" | "name" | "sex" | "dob" | "dobEstimated">;
    branch: { id: string; name: string } | null;
  };
}

export interface SamplePage {
  samples: SampleItem[];
  total: number;
}

export interface ReceiveResult {
  received: SampleItem[];
  /** Barcodes that couldn't be received, with why. */
  problems: { barcode: string; message: string }[];
}

/** A sample as shown on an order. */
export interface OrderSample {
  id: string;
  barcode: string;
  sampleType: string;
  container: string | null;
  status: SampleStatus;
  collectedAt: string | null;
  receivedAt: string | null;
  rejectReason: string | null;
  tests: SampleTest[];
}
