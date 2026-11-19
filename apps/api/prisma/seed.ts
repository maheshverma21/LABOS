/**
 * Creates a demo lab for local development:
 *   owner        owner@demo-lab.test
 *   front desk   frontdesk@demo-lab.test
 *   technician   tech@demo-lab.test
 *   pathologist  pathologist@demo-lab.test
 *   phlebotomist phleb@demo-lab.test
and two platform admins for the admin console (/admin):
 *   super admin  admin@platform.test
 *   support      support@platform.test
 * All demo accounts use the password below. It also imports the starter test catalog.
 * Safe to run more than once. Never run this against production.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { tenantDb } from "../src/lib/tenant-db";
import { createTenantWithOwner } from "../src/modules/tenants/tenant.service";
import { importStarterCatalog } from "../src/modules/catalog/catalog.service";

const DEMO_PASSWORD = "Demo@12345";

/** Made-up rupee prices for the demo lab only. WIDAL is left unpriced on purpose. */
const DEMO_PRICES: Record<string, number> = {
  CBC: 350, ESR: 120, BGRH: 150, FBS: 100, PPBS: 100, RBS: 100, HBA1C: 500, LIPID: 600, LFT: 650, KFT: 600,
  ELEC: 450, TFT: 550, TSH: 350, VITD: 1400, B12: 1100, URINE: 200, CRP: 450, NS1: 700, MPAG: 400, BHC: 1999,
};

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");

  const owner =
    (await prisma.user.findUnique({ where: { email: "owner@demo-lab.test" } })) ?? (await createDemoLab());

  const result = await importStarterCatalog(tenantDb(owner.tenantId), {
    tenantId: owner.tenantId,
    userId: owner.id,
    ip: null,
    userAgent: "seed",
  });
  console.log(`Starter catalog: ${result.created.length} added, ${result.skipped.length} already there.`);

  // Sample prices so the demo lab can bill straight away. Only tests still at 0 are touched.
  let priced = 0;
  for (const [code, rupees] of Object.entries(DEMO_PRICES)) {
    const r = await prisma.test.updateMany({
      where: { tenantId: owner.tenantId, code, pricePaise: 0 },
      data: { pricePaise: rupees * 100 },
    });
    priced += r.count;
  }
  if (priced) console.log(`Set demo prices on ${priced} tests.`);
  await ensureDemoPhlebotomist(owner.tenantId);
  await seedPlatformAdmins();
  console.log("Sign in as owner@demo-lab.test (password is in prisma/seed.ts).");
}

/** Added after the first version of the demo lab, so older local databases get it too. */
async function ensureDemoPhlebotomist(tenantId: string) {
  const email = "phleb@demo-lab.test";
  if (await prisma.user.findUnique({ where: { email } })) return;
  const role = await prisma.role.findFirst({ where: { tenantId, key: "phlebotomist" } });
  if (!role) return;
  const user = await prisma.user.create({
    data: { tenantId, name: "Ravi Phlebotomist", email, phone: "9876500011", passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12) },
  });
  await prisma.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id } });
  console.log("Demo phlebotomist added: phleb@demo-lab.test.");
}

async function seedPlatformAdmins() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const admins = [
    { name: "Platform Admin", email: "admin@platform.test", role: "SUPER_ADMIN" as const },
    { name: "Support Desk", email: "support@platform.test", role: "SUPPORT" as const },
  ];
  for (const a of admins) {
    await prisma.platformAdmin.upsert({ where: { email: a.email }, update: {}, create: { ...a, passwordHash } });
  }
  console.log("Platform admins: admin@platform.test, support@platform.test.");
}

async function createDemoLab() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  return prisma.$transaction(async (tx) => {
    const { tenant, owner } = await createTenantWithOwner(tx, {
      labName: "Demo Diagnostics",
      ownerName: "Demo Owner",
      email: "owner@demo-lab.test",
      phone: "9876543210",
      passwordHash,
    });

    await tx.tenant.update({ where: { id: tenant.id }, data: { status: "ACTIVE" } });

    const centre = await tx.branch.create({
      data: { tenantId: tenant.id, name: "Andheri collection centre", code: "AND", type: "COLLECTION_CENTRE" },
    });

    const roles = await tx.role.findMany({ where: { tenantId: tenant.id } });
    const roleId = (key: string) => {
      const role = roles.find((r) => r.key === key);
      if (!role) throw new Error(`missing role ${key}`);
      return role.id;
    };

    const staff = [
      { name: "Front Desk", email: "frontdesk@demo-lab.test", role: "front_desk", branchId: centre.id },
      { name: "Lab Technician", email: "tech@demo-lab.test", role: "technician", branchId: null },
      { name: "Dr. Pathologist", email: "pathologist@demo-lab.test", role: "pathologist", branchId: null },
    ];

    for (const s of staff) {
      const user = await tx.user.create({
        data: { tenantId: tenant.id, name: s.name, email: s.email, passwordHash },
      });
      await tx.userRole.create({
        data: { tenantId: tenant.id, userId: user.id, roleId: roleId(s.role), branchId: s.branchId },
      });
    }

    console.log("Demo lab created.");
    return owner;
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
