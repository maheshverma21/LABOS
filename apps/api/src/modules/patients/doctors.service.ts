import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import type { DoctorItem, doctorSchema, doctorPriceListSchema, PriceListDetail } from "@lms/shared";
import type { TenantDb } from "../../lib/tenant-db";
import { audit } from "../../lib/audit";
import { badRequest, conflict, notFound } from "../../lib/errors";
import type { Actor } from "./patients.service";

type DoctorOut = z.output<typeof doctorSchema>;

const select = {
  id: true,
  name: true,
  qualification: true,
  specialty: true,
  phone: true,
  clinicName: true,
  city: true,
  commissionPercent: true,
  priceList: { select: { id: true, name: true } },
  isActive: true,
} satisfies Prisma.DoctorSelect;

const auditMeta = (a: Actor) => ({ tenantId: a.tenantId, actorId: a.userId, ip: a.ip, userAgent: a.userAgent });

/** "dr. a. k. sharma" and "A K Sharma" are the same doctor. */
const normalize = (name: string) =>
  name
    .toLowerCase()
    .replace(/^dr\.?\s*/, "")
    .replace(/[^a-z]/g, "");

async function assertDoctorPriceList(db: TenantDb, id: string | null) {
  if (!id) return;
  const list = await db.priceList.findFirst({ where: { id, isActive: true, type: "DOCTOR" }, select: { id: true } });
  if (!list) throw badRequest("Pick a doctor price list", { priceListId: ["Pick a doctor price list"] });
}

export async function listDoctors(
  db: TenantDb,
  opts: { q?: string; includeInactive?: boolean },
): Promise<DoctorItem[]> {
  const q = opts.q?.trim();
  return db.doctor.findMany({
    where: {
      ...(opts.includeInactive ? {} : { isActive: true }),
      ...(q
        ? {
            OR: [
              { name: { contains: q.replace(/^dr\.?\s*/i, ""), mode: "insensitive" } },
              { clinicName: { contains: q, mode: "insensitive" } },
              { phone: { contains: q.replace(/\D/g, "") || q } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    select,
    take: 200,
  });
}

export async function createDoctor(db: TenantDb, actor: Actor, input: DoctorOut): Promise<DoctorItem> {
  const [existing] = await similarDoctors(db, input.name);
  if (existing) {
    throw conflict(`${existing.name} is already in the list`, { name: [`${existing.name} is already in the list`] });
  }
  await assertDoctorPriceList(db, input.priceListId);
  const doctor = await db.doctor.create({ data: { tenantId: actor.tenantId, ...input }, select });
  await audit({ ...auditMeta(actor), action: "doctor.create", entityType: "doctor", entityId: doctor.id, after: input });
  return doctor;
}

export async function updateDoctor(db: TenantDb, actor: Actor, id: string, input: DoctorOut): Promise<DoctorItem> {
  const before = await db.doctor.findFirst({ where: { id }, select });
  if (!before) throw notFound("Doctor not found");
  await assertDoctorPriceList(db, input.priceListId);
  const doctor = await db.doctor.update({ where: { id }, data: input, select });
  await audit({ ...auditMeta(actor), action: "doctor.update", entityType: "doctor", entityId: id, before, after: input });
  return doctor;
}

export async function setDoctorActive(db: TenantDb, actor: Actor, id: string, isActive: boolean) {
  const found = await db.doctor.findFirst({ where: { id }, select: { id: true } });
  if (!found) throw notFound("Doctor not found");
  await db.doctor.update({ where: { id }, data: { isActive } });
  await audit({
    ...auditMeta(actor),
    action: isActive ? "doctor.activate" : "doctor.deactivate",
    entityType: "doctor",
    entityId: id,
  });
}

/** Doctors whose names match once titles, dots and spaces are ignored. */
async function similarDoctors(db: TenantDb, name: string): Promise<DoctorItem[]> {
  const target = normalize(name);
  if (target.length < 3) return [];
  const all = await db.doctor.findMany({ where: { isActive: true }, select, take: 1000 });
  return all.filter((d) => normalize(d.name) === target);
}

// ---------------------------------------------------------------------------
// A doctor's own price list: price and commission per test
// ---------------------------------------------------------------------------

export async function getDoctorPriceList(db: TenantDb, id: string): Promise<PriceListDetail | null> {
  const doctor = await db.doctor.findFirst({ where: { id }, select: { priceListId: true } });
  if (!doctor) throw notFound("Doctor not found");
  if (!doctor.priceListId) return null;
  const list = await db.priceList.findFirst({
    where: { id: doctor.priceListId },
    select: { id: true, name: true, type: true, commissionMode: true, items: { select: { testId: true, pricePaise: true, commissionPercent: true, commissionPaise: true } } },
  });
  return list;
}

export async function saveDoctorPriceList(
  db: TenantDb,
  actor: Actor,
  id: string,
  input: z.output<typeof doctorPriceListSchema>,
): Promise<PriceListDetail> {
  const doctor = await db.doctor.findFirst({ where: { id }, select: { id: true, name: true, priceListId: true } });
  if (!doctor) throw notFound("Doctor not found");
  const testIds = [...new Set(input.items.map((i) => i.testId))];
  if (testIds.length !== input.items.length) throw badRequest("A test was listed twice");
  const found = await db.test.count({ where: { id: { in: testIds } } });
  if (found !== testIds.length) throw badRequest("One or more tests weren't found");

  await db.$transaction(
    async (tx) => {
      let listId = doctor.priceListId;
      if (!listId) {
        // A name nobody else is using, so lists stay unique per lab.
        const base = `${doctor.name} (price list)`;
        let name = base;
        for (let n = 2; await tx.priceList.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } }); n++) name = `${base} ${n}`;
        const list = await tx.priceList.create({ data: { tenantId: actor.tenantId, name, type: "DOCTOR", commissionMode: input.commissionMode }, select: { id: true } });
        listId = list.id;
        await tx.doctor.update({ where: { id }, data: { priceListId: listId } });
      } else {
        await tx.priceList.update({ where: { id: listId }, data: { commissionMode: input.commissionMode } });
      }
      await tx.priceListItem.deleteMany({ where: { priceListId: listId } });
      if (input.items.length) {
        await tx.priceListItem.createMany({
          data: input.items.map((i) => ({
            tenantId: actor.tenantId,
            priceListId: listId!,
            testId: i.testId,
            pricePaise: i.pricePaise,
            commissionPercent: i.commissionPercent,
            commissionPaise: i.commissionPaise,
          })),
        });
      }
      await audit(
        { ...auditMeta(actor), action: "doctor.price_list", entityType: "doctor", entityId: id, after: { commissionMode: input.commissionMode, items: input.items.length } },
        tx,
      );
    },
    { timeout: 30_000 },
  );
  return (await getDoctorPriceList(db, id))!;
}
