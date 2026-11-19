import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { SYSTEM_ROLES } from "@lms/shared";

export interface NewTenantInput {
  labName: string;
  ownerName: string;
  email: string;
  phone: string;
  passwordHash: string;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "lab"
  );
}

async function uniqueSlug(tx: Prisma.TransactionClient, name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken = await tx.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
    slug = `${base}-${randomBytes(2).toString("hex")}`;
  }
  return `${base}-${randomBytes(4).toString("hex")}`;
}

/**
 * Creates a lab with its main branch, the standard roles, and the owner account.
 * Run inside a transaction.
 */
/** Length of the free trial for a new lab. */
export const TRIAL_DAYS = 14;

export async function createTenantWithOwner(tx: Prisma.TransactionClient, input: NewTenantInput) {
  const tenant = await tx.tenant.create({
    data: {
      name: input.labName,
      slug: await uniqueSlug(tx, input.labName),
      email: input.email,
      phone: input.phone,
      // New labs start on a trial; the platform admin console flags it as it nears the end.
      planRenewsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
    },
  });

  const branch = await tx.branch.create({
    data: { tenantId: tenant.id, name: "Main lab", code: "MAIN", type: "LAB" },
  });

  await tx.role.createMany({
    data: SYSTEM_ROLES.map((r) => ({
      tenantId: tenant.id,
      key: r.key,
      name: r.name,
      permissions: [...r.permissions],
      isSystem: true,
    })),
  });

  const ownerRole = await tx.role.findUniqueOrThrow({
    where: { tenantId_key: { tenantId: tenant.id, key: "owner" } },
  });

  const owner = await tx.user.create({
    data: {
      tenantId: tenant.id,
      name: input.ownerName,
      email: input.email,
      phone: input.phone,
      passwordHash: input.passwordHash,
    },
  });

  await tx.userRole.create({
    data: { tenantId: tenant.id, userId: owner.id, roleId: ownerRole.id, branchId: null },
  });

  return { tenant, branch, owner };
}
