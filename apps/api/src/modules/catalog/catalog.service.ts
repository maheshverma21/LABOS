import { Prisma } from "@prisma/client";
import type {
  DepartmentItem,
  ParameterDetail,
  PriceListDetail,
  PriceListSummary,
  PriceListType,
  TestDetail,
  TestListItem,
  TestOutput,
} from "@lms/shared";
import { cultureConfigSchema, parameterSchema, SAMPLE_TYPES, type ReportKind } from "@lms/shared";
import type { TenantDb } from "../../lib/tenant-db";
import { audit } from "../../lib/audit";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { STARTER_DEPARTMENTS, STARTER_PANELS, STARTER_TESTS } from "./starter-catalog";

export interface Actor {
  tenantId: string;
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

const auditMeta = (a: Actor) => ({ tenantId: a.tenantId, actorId: a.userId, ip: a.ip, userAgent: a.userAgent });

type ParameterIn = TestOutput["parameters"][number];

function rangeRows(tenantId: string, ranges: ParameterIn["ranges"]) {
  return ranges.map((r) => ({ tenantId, ...r }));
}

function parameterRow(tenantId: string, p: ParameterIn, sortOrder: number) {
  return {
    tenantId,
    code: p.code,
    name: p.name,
    unit: p.unit,
    method: p.method,
    resultType: p.resultType,
    decimals: p.decimals,
    options: p.resultType === "OPTIONS" ? p.options : [],
    formula: p.formula,
    sortOrder,
  };
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export async function listDepartments(db: TenantDb): Promise<DepartmentItem[]> {
  const rows = await db.department.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, _count: { select: { tests: { where: { isActive: true } } } } },
  });
  return rows.map((d) => ({ id: d.id, name: d.name, testCount: d._count.tests }));
}

export async function createDepartment(db: TenantDb, actor: Actor, name: string) {
  const exists = await db.department.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (exists) throw conflict("A department with this name already exists", { name: ["Already exists"] });
  const count = await db.department.count();
  const dept = await db.department.create({
    data: { tenantId: actor.tenantId, name, sortOrder: count },
    select: { id: true, name: true },
  });
  await audit({ ...auditMeta(actor), action: "department.create", entityType: "department", entityId: dept.id, after: dept });
  return dept;
}

// ---------------------------------------------------------------------------
// Tests: reading
// ---------------------------------------------------------------------------

export async function listTests(
  db: TenantDb,
  filters: { search?: string; departmentId?: string; includeInactive?: boolean },
): Promise<TestListItem[]> {
  const search = filters.search?.trim();
  const rows = await db.test.findMany({
    where: {
      ...(filters.includeInactive ? {} : { isActive: true }),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { code: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ department: { sortOrder: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      isPanel: true,
      isActive: true,
      reportKind: true,
      sampleType: true,
      tatHours: true,
      pricePaise: true,
      department: { select: { id: true, name: true } },
      outsourceLab: { select: { id: true, name: true } },
      _count: { select: { parameters: { where: { isActive: true } }, panelItems: true } },
    },
  });
  return rows.map(({ _count, ...t }) => ({
    ...t,
    reportKind: t.reportKind as ReportKind,
    parameterCount: _count.parameters,
    panelTestCount: _count.panelItems,
  }));
}

export async function getTest(db: TenantDb, id: string): Promise<TestDetail> {
  const t = await db.test.findFirst({
    where: { id },
    include: {
      department: { select: { id: true, name: true } },
      parameters: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        include: { ranges: { orderBy: [{ sex: "asc" }, { ageMinDays: "asc" }] } },
      },
      panelItems: {
        orderBy: { sortOrder: "asc" },
        select: { test: { select: { id: true, code: true, name: true, pricePaise: true } } },
      },
      inPanels: { select: { panel: { select: { id: true, code: true, name: true, isActive: true } } } },
    },
  });
  if (!t) throw notFound("Test not found");

  const parameters: ParameterDetail[] = t.parameters.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    unit: p.unit,
    method: p.method,
    resultType: p.resultType,
    decimals: p.decimals,
    options: p.options,
    formula: p.formula,
    ranges: p.ranges.map((r) => ({
      id: r.id,
      sex: r.sex,
      ageMinDays: r.ageMinDays,
      ageMaxDays: r.ageMaxDays,
      low: r.low,
      high: r.high,
      criticalLow: r.criticalLow,
      criticalHigh: r.criticalHigh,
      text: r.text,
    })),
  }));

  return {
    id: t.id,
    code: t.code,
    name: t.name,
    isPanel: t.isPanel,
    isActive: t.isActive,
    sampleType: t.sampleType,
    container: t.container,
    method: t.method,
    tatHours: t.tatHours,
    pricePaise: t.pricePaise,
    reportNotes: t.reportNotes,
    interpretation: t.interpretation,
    reportKind: t.reportKind as ReportKind,
    cultureConfig: t.reportKind === "CULTURE" && t.cultureConfig ? cultureConfigSchema.parse(t.cultureConfig) : null,
    departmentId: t.departmentId,
    department: t.department,
    parameters,
    panelTests: t.panelItems.map((i) => i.test),
    usedInPanels: t.inPanels.filter((i) => i.panel.isActive).map(({ panel: { isActive: _, ...p } }) => p),
  };
}

// ---------------------------------------------------------------------------
// Tests: writing
// ---------------------------------------------------------------------------

async function checkReferences(db: TenantDb, input: TestOutput, selfId?: string) {
  const dept = await db.department.findFirst({ where: { id: input.departmentId, isActive: true }, select: { id: true } });
  if (!dept) throw badRequest("Unknown department", { departmentId: ["Department not found"] });

  const sameCode = await db.test.findFirst({
    where: { code: input.code, ...(selfId ? { id: { not: selfId } } : {}) },
    select: { id: true },
  });
  if (sameCode) throw conflict("Another test already uses this code", { code: ["Another test already uses this code"] });

  if (input.isPanel) {
    const ids = [...new Set(input.panelTestIds)];
    if (selfId && ids.includes(selfId)) throw badRequest("A panel can't contain itself", { panelTestIds: ["A panel can't contain itself"] });
    const members = await db.test.findMany({ where: { id: { in: ids } }, select: { id: true, isPanel: true, isActive: true } });
    if (members.length !== ids.length) throw badRequest("Unknown test in panel", { panelTestIds: ["One or more tests weren't found"] });
    if (members.some((m) => m.isPanel)) throw badRequest("Panels can't contain other panels", { panelTestIds: ["Panels can't contain other panels"] });
    if (members.some((m) => !m.isActive)) throw badRequest("Inactive test in panel", { panelTestIds: ["Remove inactive tests"] });
  }
}

function testRow(tenantId: string, input: TestOutput) {
  const culture = !input.isPanel && input.reportKind === "CULTURE";
  return {
    reportKind: culture ? "CULTURE" : "STANDARD",
    cultureConfig: culture ? (input.cultureConfig as Prisma.InputJsonValue) : Prisma.JsonNull,
    tenantId,
    code: input.code,
    name: input.name,
    departmentId: input.departmentId,
    isPanel: input.isPanel,
    sampleType: input.sampleType,
    container: input.container,
    method: input.method,
    tatHours: input.tatHours,
    pricePaise: input.pricePaise,
    reportNotes: input.reportNotes,
    interpretation: input.interpretation,
  };
}

export async function createTest(db: TenantDb, actor: Actor, input: TestOutput) {
  await checkReferences(db, input);
  const tenantId = actor.tenantId;

  const test = await db.$transaction(async (tx) => {
    const created = await tx.test.create({
      data: {
        ...testRow(tenantId, input),
        ...(input.isPanel
          ? {
              panelItems: {
                create: input.panelTestIds.map((testId, i) => ({ tenantId, testId, sortOrder: i })),
              },
            }
          : {
              parameters: {
                create: (input.reportKind === "CULTURE" ? [] : input.parameters).map((p, i) => ({
                  ...parameterRow(tenantId, p, i),
                  ranges: { create: rangeRows(tenantId, p.ranges) },
                })),
              },
            }),
      },
      select: { id: true, code: true, name: true },
    });
    await audit({ ...auditMeta(actor), action: "test.create", entityType: "test", entityId: created.id, after: { ...input } as Prisma.InputJsonValue }, tx);
    return created;
  });
  return test;
}

export async function updateTest(db: TenantDb, actor: Actor, id: string, input: TestOutput) {
  const before = await getTest(db, id);
  if (before.isPanel !== input.isPanel) {
    throw badRequest("A test can't be turned into a panel or back. Create a new one instead.");
  }
  await checkReferences(db, input, id);
  const tenantId = actor.tenantId;

  // A culture test has no parameters; any left from when it was a standard test are retired.
  if (input.reportKind === "CULTURE") input = { ...input, parameters: [] };
  const existingIds = new Set(before.parameters.map((p) => p.id));
  const unknown = input.parameters.filter((p) => p.id && !existingIds.has(p.id));
  if (unknown.length) throw badRequest("Unknown parameter id in request");

  await db.$transaction(
    async (tx) => {
      await tx.test.update({ where: { id }, data: testRow(tenantId, input) });

      if (input.isPanel) {
        await tx.testPanelItem.deleteMany({ where: { panelId: id } });
        await tx.testPanelItem.createMany({
          data: input.panelTestIds.map((testId, i) => ({ tenantId, panelId: id, testId, sortOrder: i })),
        });
      } else {
        const keep = new Set<string>();
        for (const [i, p] of input.parameters.entries()) {
          if (p.id) {
            keep.add(p.id);
            await tx.parameter.update({ where: { id: p.id }, data: parameterRow(tenantId, p, i) });
            await tx.referenceRange.deleteMany({ where: { parameterId: p.id } });
            await tx.referenceRange.createMany({ data: rangeRows(tenantId, p.ranges).map((r) => ({ ...r, parameterId: p.id! })) });
          } else {
            await tx.parameter.create({
              data: { ...parameterRow(tenantId, p, i), testId: id, ranges: { create: rangeRows(tenantId, p.ranges) } },
            });
          }
        }
        // Removed parameters are deactivated so existing results keep pointing at them.
        const removed = [...existingIds].filter((pid) => !keep.has(pid));
        if (removed.length) {
          await tx.parameter.updateMany({ where: { id: { in: removed } }, data: { isActive: false } });
        }
      }

      await audit(
        {
          ...auditMeta(actor),
          action: "test.update",
          entityType: "test",
          entityId: id,
          before: before as unknown as Prisma.InputJsonValue,
          after: input as unknown as Prisma.InputJsonValue,
        },
        tx,
      );
    },
    { timeout: 20_000 },
  );

  return getTest(db, id);
}

/** A free code for a copy: "CBC" -> "CBC-COPY", then "CBC-COPY2", ... (codes are at most 20 characters). */
async function copyCode(db: TenantDb, code: string): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const suffix = n === 1 ? "-COPY" : `-COPY${n}`;
    const candidate = `${code.slice(0, 20 - suffix.length)}${suffix}`;
    if (!(await db.test.findFirst({ where: { code: candidate }, select: { id: true } }))) return candidate;
  }
  throw conflict("Couldn't find a free code for the copy. Rename some existing copies first.");
}

/** Copies a test or panel (parameters, ranges, panel members, culture set-up) under a new code and "(Copy)" name. */
export async function duplicateTest(db: TenantDb, actor: Actor, id: string) {
  const src = await getTest(db, id);
  const input: TestOutput = {
    code: await copyCode(db, src.code),
    name: `${src.name.slice(0, 160 - " (Copy)".length)} (Copy)`,
    departmentId: src.departmentId,
    isPanel: src.isPanel,
    sampleType: src.sampleType as TestOutput["sampleType"],
    container: src.container,
    method: src.method,
    tatHours: src.tatHours,
    pricePaise: src.pricePaise,
    reportNotes: src.reportNotes,
    interpretation: src.interpretation,
    reportKind: src.reportKind ?? "STANDARD",
    cultureConfig: src.cultureConfig,
    parameters: src.parameters.map((p) => ({
      code: p.code,
      name: p.name,
      unit: p.unit,
      method: p.method,
      resultType: p.resultType,
      decimals: p.decimals,
      options: p.options,
      formula: p.formula,
      ranges: p.ranges.map(({ id: _id, ...r }) => r),
    })),
    panelTestIds: src.panelTests.map((t) => t.id),
  };
  const created = await createTest(db, actor, input);
  await audit({ ...auditMeta(actor), action: "test.duplicate", entityType: "test", entityId: created.id, after: { copiedFrom: id } });
  return created;
}

export async function setTestActive(db: TenantDb, actor: Actor, id: string, isActive: boolean) {
  const test = await getTest(db, id);
  if (!isActive && test.usedInPanels.length) {
    const names = test.usedInPanels.map((p) => p.name).join(", ");
    throw conflict(`This test is part of: ${names}. Remove it from ${test.usedInPanels.length > 1 ? "those panels" : "that panel"} first.`);
  }
  await db.test.update({ where: { id }, data: { isActive } });
  await audit({
    ...auditMeta(actor),
    action: isActive ? "test.activate" : "test.deactivate",
    entityType: "test",
    entityId: id,
  });
}

export async function deleteTest(db: TenantDb, actor: Actor, id: string) {
  const test = await getTest(db, id);
  if (test.usedInPanels.length) {
    const names = test.usedInPanels.map((p) => p.name).join(", ");
    throw conflict(`This test is part of: ${names}. Remove it from ${test.usedInPanels.length > 1 ? "those panels" : "that panel"} first.`);
  }
  const used = await db.orderItem.count({ where: { testId: id } });
  if (used > 0) {
    throw conflict("This test has been used on patient orders, so it can't be deleted. Mark it inactive instead.");
  }
  await db.test.delete({ where: { id } });
  await audit({ ...auditMeta(actor), action: "test.delete", entityType: "test", entityId: id });
}

// ---------------------------------------------------------------------------
// Starter catalog
// ---------------------------------------------------------------------------

export async function importStarterCatalog(db: TenantDb, actor: Actor) {
  const tenantId = actor.tenantId;

  return db.$transaction(
    async (tx) => {
      // Departments: reuse ones the lab already has (by name), add the rest.
      const existingDepts = await tx.department.findMany({ select: { id: true, name: true } });
      const deptId = new Map(existingDepts.map((d) => [d.name.toLowerCase(), d.id]));
      let order = existingDepts.length;
      for (const name of STARTER_DEPARTMENTS) {
        if (!deptId.has(name.toLowerCase())) {
          const d = await tx.department.create({ data: { tenantId, name, sortOrder: order++ } });
          deptId.set(name.toLowerCase(), d.id);
        }
      }
      const dept = (name: string) => deptId.get(name.toLowerCase())!;

      const existingCodes = new Set((await tx.test.findMany({ select: { code: true } })).map((t) => t.code));
      const created: string[] = [];
      const skipped: string[] = [];

      for (const t of STARTER_TESTS) {
        if (existingCodes.has(t.code)) {
          skipped.push(t.code);
          continue;
        }
        const parameters = t.parameters.map((p) => parameterSchema.parse(p));
        const cultureConfig = t.culture ? cultureConfigSchema.parse(t.culture) : null;
        await tx.test.create({
          data: {
            tenantId,
            reportKind: cultureConfig ? "CULTURE" : "STANDARD",
            cultureConfig: cultureConfig ?? Prisma.JsonNull,
            code: t.code,
            name: t.name,
            departmentId: dept(t.department),
            sampleType: t.sampleType,
            container: SAMPLE_TYPES.find((s) => s.key === t.sampleType)?.container || null,
            method: t.method ?? null,
            tatHours: t.tatHours,
            reportNotes: t.reportNotes ?? null,
            pricePaise: 0,
            parameters: {
              create: parameters.map((p, i) => ({
                ...parameterRow(tenantId, p, i),
                ranges: { create: rangeRows(tenantId, p.ranges) },
              })),
            },
          },
        });
        existingCodes.add(t.code);
        created.push(t.code);
      }

      for (const panel of STARTER_PANELS) {
        if (existingCodes.has(panel.code)) {
          skipped.push(panel.code);
          continue;
        }
        const members = await tx.test.findMany({
          where: { code: { in: panel.testCodes }, isPanel: false, isActive: true },
          select: { id: true, code: true },
        });
        if (members.length < 2) continue;
        const ordered = panel.testCodes.map((c) => members.find((m) => m.code === c)).filter((m) => !!m);
        await tx.test.create({
          data: {
            tenantId,
            code: panel.code,
            name: panel.name,
            departmentId: dept(panel.department),
            isPanel: true,
            sampleType: panel.sampleType,
            container: SAMPLE_TYPES.find((s) => s.key === panel.sampleType)?.container || null,
            tatHours: panel.tatHours,
            pricePaise: 0,
            panelItems: { create: ordered.map((m, i) => ({ tenantId, testId: m.id, sortOrder: i })) },
          },
        });
        existingCodes.add(panel.code);
        created.push(panel.code);
      }

      await audit({ ...auditMeta(actor), action: "catalog.import_starter", entityType: "catalog", after: { created, skipped } }, tx);
      return { created, skipped };
    },
    { timeout: 60_000 },
  );
}

// ---------------------------------------------------------------------------
// Price lists
// ---------------------------------------------------------------------------

export async function listPriceLists(db: TenantDb): Promise<PriceListSummary[]> {
  const rows = await db.priceList.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, type: true, _count: { select: { items: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, type: r.type, itemCount: r._count.items }));
}

export async function createPriceList(db: TenantDb, actor: Actor, name: string, type: PriceListType) {
  const exists = await db.priceList.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (exists) throw conflict("A price list with this name already exists", { name: ["Already exists"] });
  const list = await db.priceList.create({ data: { tenantId: actor.tenantId, name, type }, select: { id: true, name: true, type: true } });
  await audit({ ...auditMeta(actor), action: "price_list.create", entityType: "price_list", entityId: list.id, after: list });
  return list;
}

export async function getPriceList(db: TenantDb, id: string): Promise<PriceListDetail> {
  const list = await db.priceList.findFirst({
    where: { id, isActive: true },
    select: { id: true, name: true, type: true, commissionMode: true, items: { select: { testId: true, pricePaise: true, commissionPercent: true, commissionPaise: true } } },
  });
  if (!list) throw notFound("Price list not found");
  return list;
}

export async function setPriceListItems(
  db: TenantDb,
  actor: Actor,
  id: string,
  items: { testId: string; pricePaise: number | null }[],
) {
  const before = await getPriceList(db, id);
  const testIds = [...new Set(items.map((i) => i.testId))];
  const found = await db.test.count({ where: { id: { in: testIds } } });
  if (found !== testIds.length) throw badRequest("One or more tests weren't found");

  await db.$transaction(
    async (tx) => {
      for (const item of items) {
        if (item.pricePaise == null) {
          await tx.priceListItem.deleteMany({ where: { priceListId: id, testId: item.testId } });
        } else {
          await tx.priceListItem.upsert({
            where: { priceListId_testId: { priceListId: id, testId: item.testId } },
            create: { tenantId: actor.tenantId, priceListId: id, testId: item.testId, pricePaise: item.pricePaise },
            update: { pricePaise: item.pricePaise },
          });
        }
      }
      await audit(
        {
          ...auditMeta(actor),
          action: "price_list.update_items",
          entityType: "price_list",
          entityId: id,
          before: before.items,
          after: items,
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
  return getPriceList(db, id);
}

