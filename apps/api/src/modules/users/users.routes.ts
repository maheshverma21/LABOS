import { Router } from "express";
import {
  createUserSchema,
  setTemporaryPasswordSchema,
  updateUserAccessSchema,
  updateUserSchema,
  userStatusSchema,
  type CreateUserInput, type RoleListItem, type UserListItem } from "@lms/shared";
import { authenticate, ctx, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { hashPassword } from "../../lib/password";
import { audit } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors";
import { invalidateAccess } from "../../lib/access";
import { assertUserSlot } from "../../lib/limits";
import { revokeAllSessions, sendResetLink, setTemporaryPassword } from "../auth/auth.service";
import type { Request } from "express";
import type { z } from "zod";

export const usersRouter = Router();
usersRouter.use(authenticate);

usersRouter.get("/roles", requirePermission("users:read"), async (req, res) => {
  const { db } = ctx(req);
  const roles = await db.role.findMany({
    where: { key: { not: "b2b_client" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, key: true, name: true, isSystem: true, permissions: true },
  });
  res.json({ roles: roles satisfies RoleListItem[] });
});

usersRouter.get("/", requirePermission("users:read"), async (req, res) => {
  const { db } = ctx(req);
  const users = await db.user.findMany({
    // B2B clients' logins are managed under B2B labs, not here.
    where: { accountId: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      isActive: true,
      lastLoginAt: true,
      qualification: true,
      registrationNo: true,
      mustChangePassword: true,
      signatureId: true,
      stampId: true,
      roles: { select: { branchId: true, role: { select: { key: true, name: true } }, branch: { select: { name: true } } } },
    },
  });

  const body: UserListItem[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    qualification: u.qualification,
    registrationNo: u.registrationNo,
    mustChangePassword: u.mustChangePassword,
    signatureId: u.signatureId,
    stampId: u.stampId,
    branchId: u.roles.find((r) => r.branchId)?.branchId ?? null,
    roles: u.roles.map((r) => ({ key: r.role.key, name: r.role.name, branch: r.branch?.name ?? null })),
  }));
  res.json({ users: body });
});

usersRouter.post("/", requirePermission("users:write"), validateBody(createUserSchema), async (req, res) => {
  const { auth, db } = ctx(req);
  const input = req.body as CreateUserInput;

  await assertUserSlot(auth.tenantId);
  // Emails are unique across all labs, so check globally.
  const taken = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (taken) throw conflict("This email is already in use", { email: ["This email is already in use"] });

  const roles = await db.role.findMany({ where: { key: { in: input.roleKeys } }, select: { id: true, key: true } });
  if (roles.length !== new Set(input.roleKeys).size) {
    throw badRequest("Unknown role", { roleKeys: ["One or more roles don't exist"] });
  }
  // Only an owner can create another owner.
  if (roles.some((r) => r.key === "owner") && !auth.roles.includes("owner")) {
    throw badRequest("Only a lab owner can add another owner", { roleKeys: ["Only a lab owner can add another owner"] });
  }

  if (input.branchId) {
    const branch = await db.branch.findFirst({ where: { id: input.branchId }, select: { id: true } });
    if (!branch) throw badRequest("Unknown branch", { branchId: ["Branch not found"] });
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        tenantId: auth.tenantId,
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        passwordHash,
      },
      select: { id: true, name: true, email: true },
    });
    await tx.userRole.createMany({
      data: roles.map((r) => ({
        tenantId: auth.tenantId,
        userId: created.id,
        roleId: r.id,
        branchId: input.branchId ?? null,
      })),
    });
    await audit(
      {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: "user.create",
        entityType: "user",
        entityId: created.id,
        after: { name: created.name, email: created.email, roles: input.roleKeys, branchId: input.branchId ?? null },
        ip: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
      },
      tx,
    );
    return created;
  });

  res.status(201).json({ user });
});

usersRouter.patch("/:id", requirePermission("users:write"), validateBody(updateUserSchema), async (req, res) => {
  const { auth, db } = ctx(req);
  const id = String(req.params.id);
  const input = req.body as z.output<typeof updateUserSchema>;
  const fields = { name: true, phone: true, qualification: true, registrationNo: true } as const;
  const before = await db.user.findFirst({ where: { id, accountId: null }, select: fields });
  if (!before) throw notFound("User not found");
  const user = await db.user.update({ where: { id }, data: input, select: { id: true, ...fields } });
  await audit({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    action: "user.update",
    entityType: "user",
    entityId: id,
    before,
    after: input,
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  });
  res.json({ user });
});

// ---------------------------------------------------------------------------
// Owner controls: access, status, passwords
// ---------------------------------------------------------------------------

const auditMeta = (req: Request) => {
  const { auth } = ctx(req);
  return { tenantId: auth.tenantId, actorId: auth.userId, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
};

/** The user being managed, with what's needed to check the rules below. */
async function target(req: Request) {
  const { db } = ctx(req);
  const user = await db.user.findFirst({
    where: { id: String(req.params.id), accountId: null },
    select: { id: true, name: true, email: true, isActive: true, roles: { select: { branchId: true, role: { select: { key: true } } } } },
  });
  if (!user) throw notFound("User not found");
  return { ...user, isOwner: user.roles.some((r) => r.role.key === "owner") };
}

/** Owners are only managed by owners, and nobody manages themselves here. */
function assertCanManage(req: Request, user: { id: string; isOwner: boolean }) {
  const { auth } = ctx(req);
  if (user.id === auth.userId) throw badRequest("Use Settings, Security to change your own account");
  if (user.isOwner && !auth.roles.includes("owner")) throw forbidden("Only a lab owner can change another owner");
}

async function otherActiveOwners(req: Request, exceptId: string) {
  return ctx(req).db.user.count({ where: { id: { not: exceptId }, isActive: true, roles: { some: { role: { key: "owner" } } } } });
}

usersRouter.put("/:id/access", requirePermission("users:write"), validateBody(updateUserAccessSchema), async (req, res) => {
  const { auth, db } = ctx(req);
  const input = req.body as z.output<typeof updateUserAccessSchema>;
  const user = await target(req);
  assertCanManage(req, user);

  const roles = await db.role.findMany({ where: { key: { in: input.roleKeys } }, select: { id: true, key: true } });
  if (roles.length !== new Set(input.roleKeys).size) throw badRequest("Unknown role", { roleKeys: ["One or more roles don't exist"] });
  const makesOwner = roles.some((r) => r.key === "owner");
  if (makesOwner && !auth.roles.includes("owner")) {
    throw badRequest("Only a lab owner can add another owner", { roleKeys: ["Only a lab owner can add another owner"] });
  }
  if (user.isOwner && !makesOwner && (await otherActiveOwners(req, user.id)) === 0) {
    throw badRequest("The lab must keep at least one active owner", { roleKeys: ["The lab must keep at least one active owner"] });
  }
  if (input.branchId && !(await db.branch.findFirst({ where: { id: input.branchId }, select: { id: true } }))) {
    throw badRequest("Unknown branch", { branchId: ["Branch not found"] });
  }

  const before = { roles: user.roles.map((r) => r.role.key), branchId: user.roles.find((r) => r.branchId)?.branchId ?? null };
  await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { tenantId: auth.tenantId, userId: user.id } });
    await tx.userRole.createMany({
      data: roles.map((r) => ({ tenantId: auth.tenantId, userId: user.id, roleId: r.id, branchId: input.branchId })),
    });
    await audit({ ...auditMeta(req), action: "user.access", entityType: "user", entityId: user.id, before, after: input }, tx);
  });
  await invalidateAccess(user.id);
  res.status(204).end();
});

usersRouter.post("/:id/status", requirePermission("users:write"), validateBody(userStatusSchema), async (req, res) => {
  const { db } = ctx(req);
  const user = await target(req);
  assertCanManage(req, user);
  const isActive = req.body.isActive as boolean;
  if (isActive && !user.isActive) await assertUserSlot(ctx(req).auth.tenantId);
  if (user.isActive === isActive) throw conflict(isActive ? "This user is already active" : "This user is already disabled");
  if (!isActive && user.isOwner && (await otherActiveOwners(req, user.id)) === 0) {
    throw badRequest("The lab must keep at least one active owner");
  }
  await db.user.update({ where: { id: user.id }, data: { isActive } });
  if (isActive) await invalidateAccess(user.id);
  else await revokeAllSessions(user.id, "disabled_by_lab");
  await audit({ ...auditMeta(req), action: isActive ? "user.enable" : "user.disable", entityType: "user", entityId: user.id, after: { email: user.email } });
  res.status(204).end();
});

usersRouter.post("/:id/send-reset", requirePermission("users:write"), async (req, res) => {
  const user = await target(req);
  assertCanManage(req, user);
  if (!user.isActive) throw badRequest("Enable this user first");
  const sent = await sendResetLink(user.id, { ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null });
  await audit({ ...auditMeta(req), action: "user.reset_link_sent", entityType: "user", entityId: user.id, after: { email: user.email, sent } });
  res.json({ sent });
});

usersRouter.post("/:id/password", requirePermission("users:write"), validateBody(setTemporaryPasswordSchema), async (req, res) => {
  const user = await target(req);
  assertCanManage(req, user);
  if (!user.isActive) throw badRequest("Enable this user first");
  await setTemporaryPassword(user.id, req.body.password);
  await audit({ ...auditMeta(req), action: "user.temporary_password", entityType: "user", entityId: user.id, after: { email: user.email } });
  res.status(204).end();
});
