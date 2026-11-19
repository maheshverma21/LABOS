import { z } from "zod";
import { normalizeIndianMobile } from "./patients";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const optionalPhone = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    // Landlines are fine here (e.g. 022 2634 5678): keep digits, spaces, + and -.
    const mobile = normalizeIndianMobile(v);
    if (mobile) return mobile;
    if (!/^[+\d][\d\s-]{6,18}$/.test(v)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid phone number" });
      return z.NEVER;
    }
    return v;
  });

/** GSTIN: 2-digit state code, PAN, entity number, Z, check character. */
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const labProfileSchema = z.object({
  name: z.string().trim().min(2, "Lab name is required").max(120),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .nullable()
    .optional()
    .transform((v) => v || null)
    .pipe(z.string().regex(GSTIN_PATTERN, "Enter a valid 15-character GSTIN").nullable()),
  phone: optionalPhone,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .nullable()
    .optional()
    .transform((v) => v || null)
    .pipe(z.email("Enter a valid email").nullable()),
  tagline: optionalText(120),
  address: optionalText(300),
  website: z
    .string()
    .trim()
    .toLowerCase()
    .max(120)
    .nullable()
    .optional()
    .transform((v) => v || null)
    .pipe(z.string().regex(/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/, "Enter a website like www.yourlab.in").nullable()),
  accreditation: optionalText(120),
});
export type LabProfileInput = z.input<typeof labProfileSchema>;

export const branchSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,8}$/, "2 to 8 letters or numbers"),
  type: z.enum(["LAB", "COLLECTION_CENTRE"]),
  address: optionalText(300),
  phone: optionalPhone,
});
export type BranchInput = z.input<typeof branchSchema>;

export interface BranchItem {
  id: string;
  name: string;
  code: string;
  type: "LAB" | "COLLECTION_CENTRE";
  address: string | null;
  phone: string | null;
  isActive: boolean;
}

export interface LabProfile {
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  tagline: string | null;
  address: string | null;
  website: string | null;
  accreditation: string | null;
  logoId: string | null;
  branches: BranchItem[];
}
