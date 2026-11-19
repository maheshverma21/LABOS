import type { OutsourceLabItem, OutsourceTestItem } from "@lms/shared";
import type { TenantDb } from "../../lib/tenant-db";
import { conflict, notFound } from "../../lib/errors";

const labSelect = { id: true, name: true, tests: { orderBy: { code: "asc" as const }, select: { id: true, code: true, name: true } } };
const toLab = (l: { id: string; name: string; tests: { id: string; code: string; name: string }[] }): OutsourceLabItem => ({
  ...l,
  testCount: l.tests.length,
});

export async function listLabs(db: TenantDb): Promise<OutsourceLabItem[]> {
  return (await db.outsourceLab.findMany({ orderBy: { name: "asc" }, select: labSelect })).map(toLab);
}

async function nameTaken(db: TenantDb, name: string, exceptId?: string) {
  const other = await db.outsourceLab.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (other) throw conflict("A lab with this name already exists");
}

export async function createLab(db: TenantDb, tenantId: string, name: string, testIds: string[] = []): Promise<OutsourceLabItem> {
  await nameTaken(db, name);
  const { id } = await db.outsourceLab.create({ data: { tenantId, name }, select: { id: true } });
  if (testIds.length) await db.test.updateMany({ where: { id: { in: testIds }, isPanel: false }, data: { outsourceLabId: id } });
  return toLab((await db.outsourceLab.findFirst({ where: { id }, select: labSelect }))!);
}

export async function updateLab(db: TenantDb, id: string, name: string, testIds?: string[]) {
  const before = await db.outsourceLab.findFirst({ where: { id }, select: labSelect });
  if (!before) throw notFound("Lab not found");
  await nameTaken(db, name, id);
  await db.outsourceLab.update({ where: { id }, data: { name } });
  if (testIds) {
    await db.test.updateMany({ where: { outsourceLabId: id, id: { notIn: testIds } }, data: { outsourceLabId: null } });
    if (testIds.length) await db.test.updateMany({ where: { id: { in: testIds }, isPanel: false }, data: { outsourceLabId: id } });
  }
  const after = (await db.outsourceLab.findFirst({ where: { id }, select: labSelect }))!;
  return { before: toLab(before), lab: toLab(after) };
}

export async function deleteLab(db: TenantDb, id: string) {
  const lab = await db.outsourceLab.findFirst({ where: { id }, select: labSelect });
  if (!lab) throw notFound("Lab not found");
  await db.outsourceLab.delete({ where: { id } });
  return toLab(lab);
}

export async function listTests(db: TenantDb): Promise<OutsourceTestItem[]> {
  const rows = await db.test.findMany({
    where: { isPanel: false, isActive: true },
    orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
    select: { id: true, code: true, name: true, outsourceLabId: true, department: { select: { name: true } } },
  });
  return rows.map((t) => ({ id: t.id, code: t.code, name: t.name, department: t.department.name, labId: t.outsourceLabId }));
}

export async function setTestLab(db: TenantDb, testId: string, labId: string | null) {
  const test = await db.test.findFirst({ where: { id: testId, isPanel: false }, select: { id: true, code: true, outsourceLabId: true } });
  if (!test) throw notFound("Test not found");
  if (labId && !(await db.outsourceLab.findFirst({ where: { id: labId }, select: { id: true } }))) throw notFound("Lab not found");
  await db.test.update({ where: { id: testId }, data: { outsourceLabId: labId } });
  return { code: test.code, before: test.outsourceLabId, after: labId };
}
