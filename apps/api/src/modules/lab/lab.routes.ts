import { Router, type Request } from "express";
import { branchSchema, labProfileSchema, type LabProfile } from "@lms/shared";
import type { z } from "zod";
import { authenticate, ctx, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { audit } from "../../lib/audit";
import { conflict, notFound } from "../../lib/errors";
import { assertBranchSlot } from "../../lib/limits";

const profileFields = { name: true, gstin: true, phone: true, email: true, tagline: true, address: true, website: true, accreditation: true, logoId: true } as const;

const branchSelect = { id: true, name: true, code: true, type: true, address: true, phone: true, isActive: true } as const;

const meta = (req: Request) => {
  const { auth } = ctx(req);
  return { tenantId: auth.tenantId, actorId: auth.userId, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
};

async function profile(req: Request): Promise<LabProfile> {
  const { auth, db } = ctx(req);
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: auth.tenantId },
    select: profileFields,
  });
  const branches = await db.branch.findMany({ orderBy: { createdAt: "asc" }, select: branchSelect });
  return { ...tenant, branches };
}

export const labRouter = Router();
labRouter.use(authenticate);

// Everyone signed in can read the lab's own details (they print on bills).
labRouter.get("/", async (req, res) => {
  res.json({ lab: await profile(req) });
});

labRouter.put("/", requirePermission("settings:write"), validateBody(labProfileSchema), async (req, res) => {
  const { auth } = ctx(req);
  const input = req.body as z.output<typeof labProfileSchema>;
  const before = await prisma.tenant.findUniqueOrThrow({
    where: { id: auth.tenantId },
    select: profileFields,
  });
  // The tenant row itself isn't tenant-scoped, so update it by the signed-in user's tenant id.
  await prisma.tenant.update({ where: { id: auth.tenantId }, data: input });
  await audit({ ...meta(req), action: "lab.update", entityType: "tenant", entityId: auth.tenantId, before, after: input });
  res.json({ lab: await profile(req) });
});

labRouter.post("/branches", requirePermission("branches:write"), validateBody(branchSchema), async (req, res) => {
  const { db } = ctx(req);
  const input = req.body as z.output<typeof branchSchema>;
  await assertBranchSlot(ctx(req).auth.tenantId);
  if (await db.branch.findFirst({ where: { code: input.code } })) {
    throw conflict("Another branch uses this code", { code: ["Another branch uses this code"] });
  }
  const branch = await db.branch.create({ data: { tenantId: ctx(req).auth.tenantId, ...input }, select: branchSelect });
  await audit({ ...meta(req), action: "branch.create", entityType: "branch", entityId: branch.id, after: input });
  res.status(201).json({ branch });
});

labRouter.put("/branches/:id", requirePermission("branches:write"), validateBody(branchSchema), async (req, res) => {
  const { db } = ctx(req);
  const id = String(req.params.id);
  const input = req.body as z.output<typeof branchSchema>;
  const before = await db.branch.findFirst({ where: { id }, select: branchSelect });
  if (!before) throw notFound("Branch not found");
  if (await db.branch.findFirst({ where: { code: input.code, id: { not: id } } })) {
    throw conflict("Another branch uses this code", { code: ["Another branch uses this code"] });
  }
  const branch = await db.branch.update({ where: { id }, data: input, select: branchSelect });
  await audit({ ...meta(req), action: "branch.update", entityType: "branch", entityId: id, before, after: input });
  res.json({ branch });
});
