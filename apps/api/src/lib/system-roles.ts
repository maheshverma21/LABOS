import { SYSTEM_ROLES } from "@lms/shared";
import { prisma } from "./prisma";
import { logger } from "./logger";

/**
 * Brings every lab's built-in roles in line with SYSTEM_ROLES, so a permission
 * added in code (e.g. front desk collecting samples) reaches existing labs.
 * Labs can't edit built-in roles yet; custom roles, when added, won't be touched.
 */
export async function syncSystemRoles(): Promise<void> {
  let updated = 0;
  for (const role of SYSTEM_ROLES) {
    const r = await prisma.role.updateMany({
      where: { key: role.key, isSystem: true, NOT: { permissions: { equals: [...role.permissions] } } },
      data: { permissions: [...role.permissions], name: role.name },
    });
    updated += r.count;
  }
  if (updated) logger.info({ updated }, "updated built-in roles to the current permission set");
}
