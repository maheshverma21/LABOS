/**
 * Every action in the system is guarded by one of these permissions.
 * Roles are just named bundles of permissions, so labs can build custom roles later.
 */
export const PERMISSIONS = [
  "patients:read",
  "patients:write",
  "orders:read",
  "orders:write",
  "billing:read",
  "billing:write",
  "billing:discount",
  /** B2B accounts: see accounts, invoices and what they owe. */
  "accounts:read",
  /** Create accounts, raise invoices, record account payments. */
  "accounts:write",
  "samples:read",
  "samples:write",
  "results:read",
  "results:write",
  "results:approve",
  "reports:read",
  "reports:deliver",
  "catalog:read",
  "catalog:write",
  "users:read",
  "users:write",
  "branches:write",
  "settings:write",
  "analytics:read",
  "audit:read",
  /** A B2B client's own portal: their orders, wallet and reports. Only the b2b_client role has it. */
  "b2b:portal",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type SystemRoleKey =
  | "owner"
  | "branch_manager"
  | "front_desk"
  | "phlebotomist"
  | "technician"
  | "pathologist";

export interface SystemRoleDefinition {
  key: SystemRoleKey;
  name: string;
  permissions: readonly Permission[];
}

/** Roles created for every new lab at signup. */
export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  { key: "owner", name: "Lab owner", permissions: PERMISSIONS.filter((p) => p !== "b2b:portal") },
  {
    key: "branch_manager",
    name: "Branch manager",
    permissions: [
      "patients:read",
      "patients:write",
      "orders:read",
      "orders:write",
      "billing:read",
      "billing:write",
      "billing:discount",
      "accounts:read",
      "accounts:write",
      "samples:read",
      "samples:write",
      "results:read",
      "reports:read",
      "reports:deliver",
      "catalog:read",
      "users:read",
      "analytics:read",
    ],
  },
  {
    key: "front_desk",
    name: "Front desk",
    permissions: [
      "patients:read",
      "patients:write",
      "orders:read",
      "orders:write",
      "billing:read",
      "billing:write",
      "accounts:read",
      "samples:read",
      "samples:write",
      "reports:read",
      "reports:deliver",
      "catalog:read",
    ],
  },
  {
    key: "phlebotomist",
    name: "Phlebotomist",
    permissions: ["patients:read", "orders:read", "samples:read", "samples:write"],
  },
  {
    key: "technician",
    name: "Lab technician",
    permissions: [
      "patients:read",
      "orders:read",
      "samples:read",
      "samples:write",
      "results:read",
      "results:write",
      "catalog:read",
    ],
  },
  {
    key: "pathologist",
    name: "Pathologist",
    permissions: [
      "patients:read",
      "orders:read",
      "samples:read",
      "results:read",
      "results:write",
      "results:approve",
      "reports:read",
      "reports:deliver",
      "catalog:read",
    ],
  },
];

/** The role every B2B client login gets. Created per lab when its first client login is made; never offered for staff. */
export const B2B_ROLE: SystemRoleDefinition = { key: "b2b_client" as SystemRoleKey, name: "B2B client", permissions: ["b2b:portal"] };

export function hasPermission(granted: readonly string[], required: Permission): boolean {
  return granted.includes(required);
}

// ---------------------------------------------------------------------------
// Plain-English names, for screens that show permissions
// ---------------------------------------------------------------------------

export const PERMISSION_LABEL: Record<Permission, string> = {
  "patients:read": "See patients",
  "patients:write": "Register and edit patients",
  "orders:read": "See orders",
  "orders:write": "Create orders",
  "billing:read": "See bills and the Finance module",
  "billing:write": "Take payments",
  "billing:discount": "Give discounts, cancel and refund",
  "accounts:read": "See B2B labs and their wallets",
  "accounts:write": "Manage B2B labs, wallets, price lists and invoices",
  "samples:read": "See samples",
  "samples:write": "Collect, receive and reject samples",
  "results:read": "See results",
  "results:write": "Enter results",
  "results:approve": "Approve results",
  "reports:read": "See and print reports",
  "reports:deliver": "Send reports to patients",
  "catalog:read": "See the test list",
  "catalog:write": "Edit tests and prices",
  "users:read": "See staff",
  "users:write": "Add and manage staff",
  "branches:write": "Add and edit branches",
  "settings:write": "Change lab settings",
  "analytics:read": "See analytics",
  "audit:read": "See the audit log",
  "b2b:portal": "Use the B2B client portal",
};

/** Permissions grouped the way screens list them. */
export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  { label: "Patients and orders", permissions: ["patients:read", "patients:write", "orders:read", "orders:write"] },
  { label: "Billing", permissions: ["billing:read", "billing:write", "billing:discount", "accounts:read", "accounts:write"] },
  { label: "Samples", permissions: ["samples:read", "samples:write"] },
  { label: "Results and reports", permissions: ["results:read", "results:write", "results:approve", "reports:read", "reports:deliver"] },
  { label: "Setup and admin", permissions: ["catalog:read", "catalog:write", "users:read", "users:write", "branches:write", "settings:write", "analytics:read", "audit:read"] },
];

// ---------------------------------------------------------------------------
// Modules a platform admin can switch off per lab (e.g. by plan)
// ---------------------------------------------------------------------------

export const MODULES = [
  { key: "accounts", label: "B2B labs", description: "B2B labs: prepaid wallets, price lists, invoices and the client portal.", permissions: ["accounts:read", "accounts:write", "b2b:portal"] },
  { key: "whatsapp", label: "WhatsApp report delivery", description: "Sending report PDFs on WhatsApp through AiSensy.", permissions: [] },
  { key: "branches", label: "Multiple branches", description: "Adding and editing branches and collection centres.", permissions: ["branches:write"] },
] as const satisfies readonly { key: string; label: string; description: string; permissions: readonly Permission[] }[];
export type ModuleKey = (typeof MODULES)[number]["key"];
export const MODULE_KEYS = MODULES.map((m) => m.key) as ModuleKey[];

/** Per role: permissions added to and taken from the built-in set, for one lab. */
export type PermissionOverrides = Partial<Record<string, { grant?: string[]; revoke?: string[] }>>;

/**
 * What a role can really do in a lab: its built-in permissions, plus and minus
 * the platform admin's overrides for that lab, minus anything in a switched-off module.
 */
export function effectivePermissions(
  roleKey: string,
  base: readonly string[],
  overrides: PermissionOverrides | null | undefined,
  disabledModules: readonly string[] | null | undefined,
): Permission[] {
  const valid = new Set<string>(PERMISSIONS);
  const o = overrides?.[roleKey];
  const set = new Set(base.filter((p) => valid.has(p)));
  for (const p of o?.grant ?? []) if (valid.has(p)) set.add(p);
  for (const p of o?.revoke ?? []) set.delete(p);
  for (const m of MODULES) {
    if (disabledModules?.includes(m.key)) for (const p of m.permissions) set.delete(p);
  }
  return PERMISSIONS.filter((p) => set.has(p));
}
