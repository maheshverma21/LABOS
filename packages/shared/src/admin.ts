import { z } from "zod";
import { isRealIsoDate } from "./patients";
import { MODULE_KEYS, PERMISSIONS, type ModuleKey, type Permission } from "./permissions";

// ---------------------------------------------------------------------------
// Platform admin console: the SaaS operator's view across every lab.
// ---------------------------------------------------------------------------

export type PlatformRole = "SUPER_ADMIN" | "SUPPORT";
export const PLATFORM_ROLE_LABEL: Record<PlatformRole, string> = { SUPER_ADMIN: "Super admin", SUPPORT: "Support (read-only)" };

export const TENANT_PLANS = ["STARTER", "GROWTH", "ENTERPRISE"] as const;
export type TenantPlan = (typeof TENANT_PLANS)[number];
export const PLAN_LABEL: Record<TenantPlan, string> = { STARTER: "Starter", GROWTH: "Growth", ENTERPRISE: "Enterprise" };

export const TENANT_STATUSES = ["TRIAL", "ACTIVE", "SUSPENDED"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];
export const TENANT_STATUS_LABEL: Record<TenantStatus, string> = { TRIAL: "Trial", ACTIVE: "Active", SUSPENDED: "Suspended" };

export interface AdminSessionUser {
  id: string;
  name: string;
  email: string;
  role: PlatformRole;
  /** Two-step sign-in is set up. */
  mfaEnabled: boolean;
  /** This server requires two-step sign-in; until it's set up, only the setup screen works. */
  mfaRequired: boolean;
}

/** Password accepted; now the authenticator code is needed. */
export interface AdminMfaChallenge {
  mfaRequired: true;
  mfaToken: string;
}

export interface AdminMfaSetup {
  secret: string;
  otpauthUrl: string;
  /** The same as a QR code image (data URL) to scan. */
  qrDataUrl: string;
}

export const adminChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(12, "At least 12 characters").max(128),
  })
  .refine((v) => v.currentPassword !== v.newPassword, { path: ["newPassword"], message: "Choose a different password" });

export interface AdminAuthResponse {
  accessToken: string;
  expiresIn: number;
  admin: AdminSessionUser;
}

/** "2 y 3 m", "5 m", "12 days": how long since a date. */
export function formatTenure(fromIso: string, now = new Date()): string {
  const from = new Date(fromIso);
  const days = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000));
  if (days < 31) return days === 1 ? "1 day" : `${days} days`;
  let months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  if (now.getDate() < from.getDate()) months--;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y ? (m ? `${y} y ${m} m` : `${y} y`) : `${m} m`;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const reason = z.string().trim().min(3, "Give a reason").max(300);

export const updateSubscriptionSchema = z.object({
  plan: z.enum(TENANT_PLANS),
  status: z.enum(TENANT_STATUSES),
  /** YYYY-MM-DD, or null for no end date. */
  planRenewsAt: z
    .string()
    .refine(isRealIsoDate, "Pick a date")
    .nullable(),
  reason,
});
export type UpdateSubscriptionInput = z.input<typeof updateSubscriptionSchema>;

export const adminUserStatusSchema = z.object({ isActive: z.boolean(), reason });
export const adminSignOutSchema = z.object({ reason });

export const createPlatformAdminSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  email: z.email("Enter a valid email").toLowerCase(),
  password: z.string().min(12, "At least 12 characters").max(128),
  role: z.enum(["SUPER_ADMIN", "SUPPORT"]),
});
export type CreatePlatformAdminInput = z.input<typeof createPlatformAdminSchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface AdminLabRow {
  id: string;
  name: string;
  slug: string;
  plan: TenantPlan;
  status: TenantStatus;
  planRenewsAt: string | null;
  createdAt: string;
  owner: { name: string; email: string; phone: string | null } | null;
  users: number;
  activeUsers: number;
  branches: number;
  orders30d: number;
  lastActivityAt: string | null;
}

export interface AdminUserRole {
  key: string;
  name: string;
  branch: string | null;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  lab: { id: string; name: string; plan: TenantPlan; status: TenantStatus };
  roles: AdminUserRole[];
  activeSessions: number;
}

export interface AdminAuditItem {
  id: string;
  admin: string | null;
  action: string;
  lab: { id: string; name: string } | null;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface AdminLabDetail extends AdminLabRow {
  gstin: string | null;
  phone: string | null;
  email: string | null;
  branchList: { id: string; name: string; code: string; type: "LAB" | "COLLECTION_CENTRE"; isActive: boolean }[];
  userList: AdminUserRow[];
  usage: {
    patients: number;
    ordersTotal: number;
    orders30d: number;
    billed30dPaise: number;
    reportsSent30d: number;
    testsInCatalog: number;
  };
  history: AdminAuditItem[];
}

export interface AdminUserDetail extends AdminUserRow {
  qualification: string | null;
  registrationNo: string | null;
  permissions: string[];
  /** null = every branch */
  branchScope: string[] | null;
  sessions: { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastUsedAt: string }[];
  activity: { id: string; action: string; entityType: string; createdAt: string; ip: string | null }[];
  history: AdminAuditItem[];
}

export interface PlatformOverview {
  labs: { total: number; byStatus: Record<TenantStatus, number>; byPlan: Record<TenantPlan, number>; new30d: number };
  users: { total: number; active: number; signedIn30d: number };
  orders30d: number;
  /** Paid or trial labs whose plan ends in the next 30 days, or has already ended. */
  renewals: AdminLabRow[];
  recentLabs: AdminLabRow[];
}

export interface PlatformAdminItem {
  id: string;
  name: string;
  email: string;
  role: PlatformRole;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Per-lab access control by platform admins
// ---------------------------------------------------------------------------

export interface LabAccess {
  modules: { key: ModuleKey; label: string; description: string; enabled: boolean }[];
  /** Each role in the lab: its built-in permissions and what it can do now (after overrides and modules). */
  roles: { key: string; name: string; defaults: Permission[]; current: Permission[]; effective: Permission[]; users: number }[];
  limits: { maxUsers: number | null; maxBranches: number | null };
  usage: { users: number; branches: number };
}

const limit = z.number().int().min(1, "At least 1").max(10_000).nullable();

export const updateLabAccessSchema = z.object({
  disabledModules: z.array(z.enum(MODULE_KEYS as [ModuleKey, ...ModuleKey[]])).max(20),
  /** Per role key, the permissions it should have (before modules are applied). */
  roles: z.record(z.string(), z.array(z.enum(PERMISSIONS))),
  maxUsers: limit,
  maxBranches: limit,
  reason: z.string().trim().min(3, "Give a reason").max(300),
});
export type UpdateLabAccessInput = z.input<typeof updateLabAccessSchema>;

export const adminUserAccessSchema = z.object({
  roleKeys: z.array(z.string()).min(1, "Pick at least one role"),
  branchId: z.uuid().nullable(),
  reason: z.string().trim().min(3, "Give a reason").max(300),
});

export const adminTempPasswordSchema = z.object({
  password: z.string().min(8, "At least 8 characters").max(128),
  reason: z.string().trim().min(3, "Give a reason").max(300),
});
