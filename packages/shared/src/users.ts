import { z } from "zod";
import type { SystemRoleKey } from "./permissions";
import { passwordSchema } from "./auth";

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  email: z.email("Enter a valid email").toLowerCase(),
  phone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  roleKeys: z.array(z.string()).min(1, "Pick at least one role"),
  /** Limit the roles to one branch. Omit for access to all branches. */
  branchId: z.uuid().optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export interface UserListItem {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  qualification: string | null;
  registrationNo: string | null;
  mustChangePassword: boolean;
  signatureId: string | null;
  stampId: string | null;
  /** The one branch this user is limited to, or null for all branches. */
  branchId: string | null;
  roles: { key: SystemRoleKey | string; name: string; branch: string | null }[];
}

export interface RoleListItem {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
}

const optionalLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);

/** Details printed under a pathologist's signature on reports. */
export const updateUserSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  phone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null))
    .transform((v) => v || null),
  qualification: optionalLine(120),
  registrationNo: optionalLine(60),
});
export type UpdateUserInput = z.input<typeof updateUserSchema>;

/** The owner changing what a user can do. */
export const updateUserAccessSchema = z.object({
  roleKeys: z.array(z.string()).min(1, "Pick at least one role"),
  /** Limit to one branch; null for all branches. */
  branchId: z.uuid().nullable(),
});
export type UpdateUserAccessInput = z.input<typeof updateUserAccessSchema>;

export const userStatusSchema = z.object({ isActive: z.boolean() });

/** The owner choosing a temporary password; the user must change it at next sign-in. */
export const setTemporaryPasswordSchema = z.object({ password: passwordSchema });
