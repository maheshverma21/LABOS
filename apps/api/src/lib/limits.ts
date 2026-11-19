import { prisma } from "./prisma";
import { AppError } from "./errors";

/** Limits a platform admin set for a lab (null = none). */
async function limitsOf(tenantId: string) {
  return prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { maxUsers: true, maxBranches: true } });
}

/** Before adding (or re-enabling) a user: refuses if the lab is at its user limit. */
export async function assertUserSlot(tenantId: string) {
  const { maxUsers } = await limitsOf(tenantId);
  if (maxUsers == null) return;
  const active = await prisma.user.count({ where: { tenantId, isActive: true, accountId: null } });
  if (active >= maxUsers) {
    throw new AppError(409, "limit_reached", `Your plan allows ${maxUsers} active users. Disable someone, or contact support to raise the limit.`);
  }
}

/** Before adding a branch: refuses if the lab is at its branch limit. */
export async function assertBranchSlot(tenantId: string) {
  const { maxBranches } = await limitsOf(tenantId);
  if (maxBranches == null) return;
  const count = await prisma.branch.count({ where: { tenantId } });
  if (count >= maxBranches) {
    throw new AppError(409, "limit_reached", `Your plan allows ${maxBranches} branches. Contact support to raise the limit.`);
  }
}

/** Whether a platform admin switched a module off for this lab. */
export async function moduleDisabled(tenantId: string, key: string) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { disabledModules: true } });
  return t.disabledModules.includes(key);
}
