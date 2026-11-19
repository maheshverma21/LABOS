import { effectivePermissions, type Permission, type PermissionOverrides } from "@lms/shared";
import { prisma } from "./prisma";
import { redis } from "./redis";
import { logger } from "./logger";

/** What a signed-in user is allowed to do. Cached in Redis for a few minutes. */
export interface Access {
  userId: string;
  tenantId: string;
  active: boolean;
  /** Set for a B2B client's login: the lab (account) they order for. */
  accountId: string | null;
  roles: string[];
  permissions: Permission[];
  /** null = every branch in the lab */
  branchIds: string[] | null;
}

const TTL_SECONDS = 300;
const key = (userId: string) => `access:${userId}`;

async function loadFromDb(userId: string): Promise<Access | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      tenantId: true,
      isActive: true,
      accountId: true,
      account: { select: { isActive: true } },
      tenant: { select: { status: true, disabledModules: true, permissionOverrides: true } },
      roles: { select: { branchId: true, role: { select: { key: true, permissions: true } } } },
    },
  });
  if (!user) return null;

  const overrides = (user.tenant.permissionOverrides ?? {}) as PermissionOverrides;
  const permissions = new Set<Permission>();
  const roles = new Set<string>();
  let allBranches = false;
  const branchIds = new Set<string>();

  for (const ur of user.roles) {
    roles.add(ur.role.key);
    // Built-in role permissions, adjusted by the platform admin for this lab.
    for (const p of effectivePermissions(ur.role.key, ur.role.permissions, overrides, user.tenant.disabledModules)) permissions.add(p);
    if (ur.branchId) branchIds.add(ur.branchId);
    else allBranches = true;
  }

  return {
    userId: user.id,
    tenantId: user.tenantId,
    active: user.isActive && user.tenant.status !== "SUSPENDED" && (!user.accountId || !!user.account?.isActive),
    accountId: user.accountId,
    roles: [...roles],
    permissions: [...permissions],
    branchIds: allBranches ? null : [...branchIds],
  };
}

export async function getAccess(userId: string): Promise<Access | null> {
  try {
    const cached = await redis.get(key(userId));
    if (cached) return JSON.parse(cached) as Access;
  } catch (err) {
    logger.warn({ err }, "access cache read failed; using database");
  }

  const access = await loadFromDb(userId);
  if (access) {
    redis.set(key(userId), JSON.stringify(access), "EX", TTL_SECONDS).catch(() => undefined);
  }
  return access;
}

/** Call after changing a user's roles, status, or their lab's status. */
export async function invalidateAccess(userId: string): Promise<void> {
  await redis.del(key(userId)).catch(() => undefined);
}
