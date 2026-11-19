import type { Prisma } from "@prisma/client";
import {
  effectivePermissions,
  MODULES,
  PERMISSIONS,
  SYSTEM_ROLES,
  type LabAccess,
  type PermissionOverrides,
  TENANT_PLANS,
  TENANT_STATUSES,
  type AdminAuditItem,
  type AdminLabDetail,
  type AdminLabRow,
  type AdminUserDetail,
  type AdminUserRow,
  type PlatformAdminItem,
  type PlatformOverview,
  type TenantPlan,
  type TenantStatus,
} from "@lms/shared";
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import type { adminUserAccessSchema, createPlatformAdminSchema, updateLabAccessSchema, updateSubscriptionSchema } from "@lms/shared";
import { prisma } from "../../lib/prisma";
import { hashPassword } from "../../lib/password";
import { invalidateAccess } from "../../lib/access";
import { audit } from "../../lib/audit";
import { redis } from "../../lib/redis";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { revokeAllSessions, sendResetLink, setTemporaryPassword } from "../auth/auth.service";
import { platformAudit, type Meta } from "./admin-auth";

// The admin console deliberately reads across every lab, so it uses the raw
// Prisma client. Nothing here is reachable without a platform admin token.

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

// ---------------------------------------------------------------------------
// Labs
// ---------------------------------------------------------------------------

const tenantRowSelect = {
  id: true,
  name: true,
  slug: true,
  plan: true,
  status: true,
  planRenewsAt: true,
  createdAt: true,
  _count: { select: { users: true, branches: true } },
} as const;

type TenantRowData = Prisma.TenantGetPayload<{ select: typeof tenantRowSelect }>;

/** Adds owner, active users, recent orders and last activity to tenant rows. */
async function toLabRows(tenants: TenantRowData[]): Promise<AdminLabRow[]> {
  if (tenants.length === 0) return [];
  const ids = tenants.map((t) => t.id);
  const [owners, active, orders, activity] = await Promise.all([
    prisma.userRole.findMany({
      where: { tenantId: { in: ids }, role: { key: "owner" } },
      orderBy: { createdAt: "asc" },
      select: { tenantId: true, user: { select: { name: true, email: true, phone: true } } },
    }),
    prisma.user.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, isActive: true }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, createdAt: { gte: daysAgo(30) } }, _count: { _all: true } }),
    prisma.session.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids } }, _max: { lastUsedAt: true } }),
  ]);
  return tenants.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    plan: t.plan,
    status: t.status,
    planRenewsAt: t.planRenewsAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    owner: owners.find((o) => o.tenantId === t.id)?.user ?? null,
    users: t._count.users,
    activeUsers: active.find((a) => a.tenantId === t.id)?._count._all ?? 0,
    branches: t._count.branches,
    orders30d: orders.find((o) => o.tenantId === t.id)?._count._all ?? 0,
    lastActivityAt: activity.find((a) => a.tenantId === t.id)?._max.lastUsedAt?.toISOString() ?? null,
  }));
}

export async function listLabs(f: { q?: string; plan?: string; status?: string }): Promise<AdminLabRow[]> {
  const q = f.q?.trim();
  const where: Prisma.TenantWhereInput = {
    ...(f.plan && (TENANT_PLANS as readonly string[]).includes(f.plan) ? { plan: f.plan as TenantPlan } : {}),
    ...(f.status && (TENANT_STATUSES as readonly string[]).includes(f.status) ? { status: f.status as TenantStatus } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { slug: { contains: q.toLowerCase() } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { users: { some: { email: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const tenants = await prisma.tenant.findMany({ where, orderBy: { createdAt: "desc" }, take: 500, select: tenantRowSelect });
  return toLabRows(tenants);
}

export async function overview(): Promise<PlatformOverview> {
  const soon = new Date(Date.now() + 30 * DAY);
  const [byStatus, byPlan, new30d, usersTotal, usersActive, signedIn30d, orders30d, renewing, recent] = await Promise.all([
    prisma.tenant.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.tenant.groupBy({ by: ["plan"], _count: { _all: true } }),
    prisma.tenant.count({ where: { createdAt: { gte: daysAgo(30) } } }),
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count({ where: { lastLoginAt: { gte: daysAgo(30) } } }),
    prisma.order.count({ where: { createdAt: { gte: daysAgo(30) } } }),
    prisma.tenant.findMany({
      where: { status: { not: "SUSPENDED" }, planRenewsAt: { lte: soon } },
      orderBy: { planRenewsAt: "asc" },
      take: 20,
      select: tenantRowSelect,
    }),
    prisma.tenant.findMany({ orderBy: { createdAt: "desc" }, take: 8, select: tenantRowSelect }),
  ]);
  const statusCounts = Object.fromEntries(TENANT_STATUSES.map((s) => [s, byStatus.find((x) => x.status === s)?._count._all ?? 0])) as Record<TenantStatus, number>;
  const planCounts = Object.fromEntries(TENANT_PLANS.map((p) => [p, byPlan.find((x) => x.plan === p)?._count._all ?? 0])) as Record<TenantPlan, number>;
  return {
    labs: { total: Object.values(statusCounts).reduce((a, b) => a + b, 0), byStatus: statusCounts, byPlan: planCounts, new30d },
    users: { total: usersTotal, active: usersActive, signedIn30d },
    orders30d,
    renewals: await toLabRows(renewing),
    recentLabs: await toLabRows(recent),
  };
}

export async function labDetail(id: string): Promise<AdminLabDetail> {
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    select: {
      ...tenantRowSelect,
      gstin: true,
      phone: true,
      email: true,
      branches: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, code: true, type: true, isActive: true } },
    },
  });
  if (!tenant) throw notFound("Lab not found");
  const since = daysAgo(30);
  const [row] = await toLabRows([tenant]);
  const [patients, ordersTotal, billed, reportsSent30d, testsInCatalog, users, history] = await Promise.all([
    prisma.patient.count({ where: { tenantId: id } }),
    prisma.order.count({ where: { tenantId: id } }),
    prisma.order.aggregate({ where: { tenantId: id, status: "ACTIVE", createdAt: { gte: since } }, _sum: { netPaise: true } }),
    prisma.reportDelivery.count({ where: { tenantId: id, status: "SENT", createdAt: { gte: since } } }),
    prisma.test.count({ where: { tenantId: id, isActive: true } }),
    userRows({ tenantId: id }),
    auditItems({ tenantId: id }, 50),
  ]);
  return {
    ...row!,
    gstin: tenant.gstin,
    phone: tenant.phone,
    email: tenant.email,
    branchList: tenant.branches,
    userList: users,
    usage: {
      patients,
      ordersTotal,
      orders30d: row!.orders30d,
      billed30dPaise: billed._sum.netPaise ?? 0,
      reportsSent30d,
      testsInCatalog,
    },
    history,
  };
}

export async function updateSubscription(
  adminId: string,
  tenantId: string,
  input: z.output<typeof updateSubscriptionSchema>,
  meta: Meta,
): Promise<AdminLabDetail> {
  const before = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: true, status: true, planRenewsAt: true } });
  if (!before) throw notFound("Lab not found");
  const planRenewsAt = input.planRenewsAt ? new Date(`${input.planRenewsAt}T23:59:59+05:30`) : null;
  const after = { plan: input.plan, status: input.status, planRenewsAt: planRenewsAt?.toISOString() ?? null };
  const beforeJson = { ...before, planRenewsAt: before.planRenewsAt?.toISOString() ?? null };

  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({ where: { id: tenantId }, data: { plan: input.plan, status: input.status, planRenewsAt } });
    await platformAudit(
      { adminId, action: "lab.subscription", tenantId, entityType: "tenant", entityId: tenantId, before: beforeJson, after: { ...after, reason: input.reason }, ...meta },
      tx,
    );
    // The lab's own audit log shows the change too, so its owner can see what support did.
    await audit({ tenantId, actorId: null, action: "platform.subscription", entityType: "tenant", entityId: tenantId, before: beforeJson, after }, tx);
  });

  if (before.status !== input.status) {
    // Suspending (or lifting it) changes whether every user in the lab can sign in.
    const users = await prisma.user.findMany({ where: { tenantId }, select: { id: true } });
    await Promise.all(users.map((u) => invalidateAccess(u.id)));
  }
  return labDetail(tenantId);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const userRowSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  isActive: true,
  createdAt: true,
  lastLoginAt: true,
  tenant: { select: { id: true, name: true, plan: true, status: true } },
  roles: { select: { role: { select: { key: true, name: true, permissions: true } }, branch: { select: { name: true } }, branchId: true } },
} as const;

type UserRowData = Prisma.UserGetPayload<{ select: typeof userRowSelect }>;

const toUserRow = (u: UserRowData, activeSessions: number): AdminUserRow => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  isActive: u.isActive,
  createdAt: u.createdAt.toISOString(),
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  lab: u.tenant,
  roles: u.roles.map((r) => ({ key: r.role.key, name: r.role.name, branch: r.branch?.name ?? null })),
  activeSessions,
});

async function activeSessionCounts(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, number>();
  const rows = await prisma.session.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds }, revokedAt: null, expiresAt: { gt: new Date() } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.userId, r._count._all]));
}

export async function userRows(where: Prisma.UserWhereInput, take = 500): Promise<AdminUserRow[]> {
  const users = await prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, take, select: userRowSelect });
  const sessions = await activeSessionCounts(users.map((u) => u.id));
  return users.map((u) => toUserRow(u, sessions.get(u.id) ?? 0));
}

export function listUsers(f: { q?: string; labId?: string; role?: string; status?: string }) {
  const q = f.q?.trim();
  return userRows({
    ...(f.labId ? { tenantId: f.labId } : {}),
    ...(f.role ? { roles: { some: { role: { key: f.role } } } } : {}),
    ...(f.status === "active" ? { isActive: true } : f.status === "disabled" ? { isActive: false } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { tenant: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  });
}

export async function userDetail(id: string): Promise<AdminUserDetail> {
  const user = await prisma.user.findUnique({ where: { id }, select: { ...userRowSelect, qualification: true, registrationNo: true } });
  if (!user) throw notFound("User not found");
  const [sessions, activity, history] = await Promise.all([
    prisma.session.findMany({
      where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastUsedAt: true },
    }),
    prisma.auditLog.findMany({
      where: { actorId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, action: true, entityType: true, createdAt: true, ip: true },
    }),
    auditItems({ entityType: "user", entityId: id }, 30),
  ]);
  const granted = new Set(user.roles.flatMap((r) => r.role.permissions));
  const allBranches = user.roles.some((r) => !r.branchId);
  return {
    ...toUserRow(user, sessions.length),
    qualification: user.qualification,
    registrationNo: user.registrationNo,
    permissions: PERMISSIONS.filter((p) => granted.has(p)),
    branchScope: allBranches ? null : [...new Set(user.roles.map((r) => r.branch?.name).filter((n): n is string => !!n))],
    sessions: sessions.map((s) => ({ ...s, createdAt: s.createdAt.toISOString(), lastUsedAt: s.lastUsedAt.toISOString() })),
    activity: activity.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    history,
  };
}

export async function setUserStatus(adminId: string, userId: string, isActive: boolean, reason: string, meta: Meta) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, tenantId: true, isActive: true, email: true } });
  if (!user) throw notFound("User not found");
  if (user.isActive === isActive) throw conflict(isActive ? "This user is already active" : "This user is already disabled");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive } });
    await platformAudit(
      { adminId, action: isActive ? "user.enable" : "user.disable", tenantId: user.tenantId, entityType: "user", entityId: userId, after: { email: user.email, reason }, ...meta },
      tx,
    );
    await audit({ tenantId: user.tenantId, actorId: null, action: isActive ? "platform.user_enable" : "platform.user_disable", entityType: "user", entityId: userId }, tx);
  });
  if (isActive) await invalidateAccess(userId);
  else await revokeAllSessions(userId, "disabled_by_platform");
  return userDetail(userId);
}

export async function signOutUser(adminId: string, userId: string, reason: string, meta: Meta) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tenantId: true, email: true } });
  if (!user) throw notFound("User not found");
  await revokeAllSessions(userId, "signed_out_by_platform");
  await platformAudit({ adminId, action: "user.sign_out", tenantId: user.tenantId, entityType: "user", entityId: userId, after: { email: user.email, reason }, ...meta });
  return userDetail(userId);
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export async function auditItems(where: Prisma.PlatformAuditLogWhereInput, take = 200): Promise<AdminAuditItem[]> {
  const rows = await prisma.platformAuditLog.findMany({ where, orderBy: { createdAt: "desc" }, take });
  const adminIds = [...new Set(rows.map((r) => r.adminId).filter((x): x is string => !!x))];
  const tenantIds = [...new Set(rows.map((r) => r.tenantId).filter((x): x is string => !!x))];
  const [admins, tenants] = await Promise.all([
    adminIds.length ? prisma.platformAdmin.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } }) : [],
    tenantIds.length ? prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }) : [],
  ]);
  return rows.map((r) => ({
    id: r.id,
    admin: admins.find((a) => a.id === r.adminId)?.name ?? null,
    action: r.action,
    lab: tenants.find((t) => t.id === r.tenantId) ?? null,
    entityType: r.entityType,
    entityId: r.entityId,
    before: r.before,
    after: r.after,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Platform admins
// ---------------------------------------------------------------------------

const adminItemSelect = { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true, totpEnabledAt: true } as const;
const toAdminItem = ({ totpEnabledAt, ...a }: Prisma.PlatformAdminGetPayload<{ select: typeof adminItemSelect }>): PlatformAdminItem => ({
  ...a,
  mfaEnabled: !!totpEnabledAt,
  lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
  createdAt: a.createdAt.toISOString(),
});

export async function listAdmins(): Promise<PlatformAdminItem[]> {
  return (await prisma.platformAdmin.findMany({ orderBy: { createdAt: "asc" }, select: adminItemSelect })).map(toAdminItem);
}

export async function createAdmin(actorId: string, input: z.output<typeof createPlatformAdminSchema>, meta: Meta) {
  if (await prisma.platformAdmin.findUnique({ where: { email: input.email }, select: { id: true } })) {
    throw conflict("An admin with this email already exists", { email: ["An admin with this email already exists"] });
  }
  const admin = await prisma.platformAdmin.create({
    data: { name: input.name, email: input.email, role: input.role, passwordHash: await hashPassword(input.password) },
    select: adminItemSelect,
  });
  await platformAudit({ adminId: actorId, action: "admin.create", entityType: "platform_admin", entityId: admin.id, after: { email: admin.email, role: admin.role }, ...meta });
  return toAdminItem(admin);
}

export async function setAdminStatus(actorId: string, id: string, isActive: boolean, meta: Meta) {
  if (id === actorId) throw badRequest("You can't disable your own account");
  const admin = await prisma.platformAdmin.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!admin) throw notFound("Admin not found");
  if (!isActive && admin.role === "SUPER_ADMIN") {
    const others = await prisma.platformAdmin.count({ where: { role: "SUPER_ADMIN", isActive: true, id: { not: id } } });
    if (others === 0) throw badRequest("Keep at least one active super admin");
  }
  const updated = await prisma.platformAdmin.update({ where: { id }, data: { isActive }, select: adminItemSelect });
  if (!isActive) await prisma.platformSession.updateMany({ where: { adminId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await platformAudit({ adminId: actorId, action: isActive ? "admin.enable" : "admin.disable", entityType: "platform_admin", entityId: id, ...meta });
  return toAdminItem(updated);
}

// ---------------------------------------------------------------------------
// Per-lab access: modules, role permissions, limits
// ---------------------------------------------------------------------------

export async function labAccess(tenantId: string): Promise<LabAccess> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { disabledModules: true, permissionOverrides: true, maxUsers: true, maxBranches: true },
  });
  if (!t) throw notFound("Lab not found");
  const overrides = (t.permissionOverrides ?? {}) as PermissionOverrides;
  const [roles, users, branches] = await Promise.all([
    prisma.role.findMany({
      where: { tenantId, key: { not: "b2b_client" } },
      orderBy: { createdAt: "asc" },
      select: { key: true, name: true, permissions: true, _count: { select: { userRoles: true } } },
    }),
    prisma.user.count({ where: { tenantId, isActive: true, accountId: null } }),
    prisma.branch.count({ where: { tenantId } }),
  ]);
  const order = SYSTEM_ROLES.map((r) => r.key as string);
  roles.sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99));
  return {
    modules: MODULES.map((m) => ({ key: m.key, label: m.label, description: m.description, enabled: !t.disabledModules.includes(m.key) })),
    roles: roles.map((r) => ({
      key: r.key,
      name: r.name,
      defaults: PERMISSIONS.filter((p) => r.permissions.includes(p)),
      current: effectivePermissions(r.key, r.permissions, overrides, []),
      effective: effectivePermissions(r.key, r.permissions, overrides, t.disabledModules),
      users: r._count.userRoles,
    })),
    limits: { maxUsers: t.maxUsers, maxBranches: t.maxBranches },
    usage: { users, branches },
  };
}

/** Everyone in a lab picks up new permissions on their next request. */
async function refreshLabAccess(tenantId: string) {
  const users = await prisma.user.findMany({ where: { tenantId }, select: { id: true } });
  await Promise.all(users.map((u) => invalidateAccess(u.id)));
}

export async function updateLabAccess(adminId: string, tenantId: string, input: z.output<typeof updateLabAccessSchema>, meta: Meta) {
  const before = await labAccess(tenantId);
  // Store only the differences from each role's built-in permissions.
  const overrides: PermissionOverrides = {};
  for (const role of before.roles) {
    const wanted = input.roles[role.key] ?? role.current;
    const grant = wanted.filter((p) => !role.defaults.includes(p));
    const revoke = role.defaults.filter((p) => !wanted.includes(p));
    if (grant.length || revoke.length) overrides[role.key] = { grant, revoke };
  }
  const after = {
    disabledModules: input.disabledModules,
    maxUsers: input.maxUsers,
    maxBranches: input.maxBranches,
  };
  const beforeJson = {
    disabledModules: before.modules.filter((m) => !m.enabled).map((m) => m.key),
    roles: Object.fromEntries(before.roles.map((r) => [r.key, r.current])),
    ...before.limits,
  };
  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({ where: { id: tenantId }, data: { ...after, permissionOverrides: overrides as Prisma.InputJsonObject } });
    await platformAudit(
      {
        adminId,
        action: "lab.access",
        tenantId,
        entityType: "tenant",
        entityId: tenantId,
        before: beforeJson as Prisma.InputJsonValue,
        after: { ...after, overrides, reason: input.reason } as Prisma.InputJsonValue,
        ...meta,
      },
      tx,
    );
    // The lab's own audit log shows the change too.
    await audit({ tenantId, actorId: null, action: "platform.access", entityType: "tenant", entityId: tenantId, after: { ...after, overrides } as Prisma.InputJsonValue }, tx);
  });
  await refreshLabAccess(tenantId);
  return labAccess(tenantId);
}

// ---------------------------------------------------------------------------
// Any user's access, from the console (support, or a lab without a working owner)
// ---------------------------------------------------------------------------

export async function setUserAccess(adminId: string, userId: string, input: z.output<typeof adminUserAccessSchema>, meta: Meta) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, tenantId: true, isActive: true, roles: { select: { branchId: true, role: { select: { key: true } } } } },
  });
  if (!user) throw notFound("User not found");
  const roles = await prisma.role.findMany({ where: { tenantId: user.tenantId, key: { in: input.roleKeys } }, select: { id: true, key: true } });
  if (roles.length !== new Set(input.roleKeys).size) throw badRequest("Unknown role", { roleKeys: ["One or more roles don't exist in this lab"] });
  if (input.branchId && !(await prisma.branch.findFirst({ where: { id: input.branchId, tenantId: user.tenantId }, select: { id: true } }))) {
    throw badRequest("Unknown branch", { branchId: ["Branch not found in this lab"] });
  }
  const wasOwner = user.roles.some((r) => r.role.key === "owner");
  const staysOwner = roles.some((r) => r.key === "owner");
  if (wasOwner && !staysOwner && user.isActive) {
    const others = await prisma.user.count({
      where: { tenantId: user.tenantId, id: { not: userId }, isActive: true, roles: { some: { role: { key: "owner" } } } },
    });
    if (others === 0) throw badRequest("This is the lab's only active owner. Make someone else an owner first.");
  }
  const before = { roles: user.roles.map((r) => r.role.key), branchId: user.roles.find((r) => r.branchId)?.branchId ?? null };
  await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId } });
    await tx.userRole.createMany({ data: roles.map((r) => ({ tenantId: user.tenantId, userId, roleId: r.id, branchId: input.branchId })) });
    await platformAudit(
      {
        adminId,
        action: "user.access",
        tenantId: user.tenantId,
        entityType: "user",
        entityId: userId,
        before,
        after: { email: user.email, roleKeys: input.roleKeys, branchId: input.branchId, reason: input.reason },
        ...meta,
      },
      tx,
    );
    await audit(
      { tenantId: user.tenantId, actorId: null, action: "platform.user_access", entityType: "user", entityId: userId, before, after: { roleKeys: input.roleKeys, branchId: input.branchId } },
      tx,
    );
  });
  await invalidateAccess(userId);
  return userDetail(userId);
}

export async function setUserTempPassword(adminId: string, userId: string, password: string, reason: string, meta: Meta) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tenantId: true, email: true, isActive: true } });
  if (!user) throw notFound("User not found");
  if (!user.isActive) throw badRequest("Enable this user first");
  await setTemporaryPassword(userId, password);
  await platformAudit({ adminId, action: "user.temporary_password", tenantId: user.tenantId, entityType: "user", entityId: userId, after: { email: user.email, reason }, ...meta });
  await audit({ tenantId: user.tenantId, actorId: null, action: "platform.user_password", entityType: "user", entityId: userId });
  return userDetail(userId);
}

export async function sendUserReset(adminId: string, userId: string, reason: string, meta: Meta) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tenantId: true, email: true, isActive: true } });
  if (!user) throw notFound("User not found");
  if (!user.isActive) throw badRequest("Enable this user first");
  const sent = await sendResetLink(userId, meta);
  await platformAudit({ adminId, action: "user.reset_link", tenantId: user.tenantId, entityType: "user", entityId: userId, after: { email: user.email, sent, reason }, ...meta });
  return { sent };
}

// ---------------------------------------------------------------------------
// "Log in as" a lab: a one-time, 60-second ticket that the lab app swaps for a normal session
// ---------------------------------------------------------------------------

export const LOGIN_TICKET_PREFIX = "labticket:";

export async function createLabLoginTicket(adminId: string, tenantId: string, meta: Meta): Promise<string> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, status: true } });
  if (!tenant) throw notFound("Lab not found");
  if (tenant.status === "SUSPENDED") throw badRequest("This lab is suspended. Reactivate it before signing in to it.");
  const owner = await prisma.user.findFirst({
    where: { tenantId, isActive: true, roles: { some: { role: { key: "owner" } } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });
  if (!owner) throw badRequest("This lab has no active owner to sign in as.");

  const ticket = randomBytes(32).toString("base64url");
  await redis.set(LOGIN_TICKET_PREFIX + ticket, JSON.stringify({ userId: owner.id, tenantId, adminId }), "EX", 60);
  await platformAudit({ adminId, action: "lab.login_as", tenantId, entityType: "user", entityId: owner.id, after: { email: owner.email }, ...meta });
  await audit({ tenantId, actorId: null, action: "platform.login_as", entityType: "user", entityId: owner.id });
  return ticket;
}
