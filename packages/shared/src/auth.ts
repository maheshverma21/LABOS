import { z } from "zod";
import type { Permission } from "./permissions";

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long");

export const signupSchema = z.object({
  labName: z.string().trim().min(2, "Lab name is required").max(120),
  ownerName: z.string().trim().min(2, "Your name is required").max(120),
  email: z.email("Enter a valid email").toLowerCase(),
  phone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number"),
  password: passwordSchema,
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.email("Enter a valid email").toLowerCase(),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  tenant: { id: string; name: string; slug: string };
  /** A B2B client's lab; null for lab staff. */
  account: { id: string; code: string; name: string } | null;
  branches: { id: string; name: string }[];
  roles: string[];
  permissions: Permission[];
  /** Someone else set this password: ask for a new one before anything else. */
  mustChangePassword: boolean;
}

export interface AuthResponse {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: SessionUser;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
    /** Extra data for specific errors, e.g. duplicate candidates. */
    details?: unknown;
  };
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export const forgotPasswordSchema = z.object({ email: z.email("Enter a valid email").toLowerCase() });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, { path: ["newPassword"], message: "Choose a different password" });
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

// ---------------------------------------------------------------------------
// Two-step sign-in (platform admins)
// ---------------------------------------------------------------------------

/** A 6-digit authenticator code, or a recovery code like "k3fp-9xq2". */
export const mfaCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v.replace(/\s/g, ""))
    .pipe(z.string().regex(/^(\d{6}|[a-z0-9]{4}-[a-z0-9]{4})$/, "Enter the 6-digit code")),
});

export const mfaLoginSchema = mfaCodeSchema.extend({ mfaToken: z.string().min(20).max(1000) });
