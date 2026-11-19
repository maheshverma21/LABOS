import { formatBarcode, SAMPLE_TYPES } from "@lms/shared";
export type BarcodeMode = "patient" | "sample" | "department";
import type { TenantDb } from "../../lib/tenant-db";

// The tables this needs; works for the tenant-scoped client and its transactions.
type Tx = Pick<TenantDb, "testPanelItem" | "test" | "sample" | "orderTest">;

interface ItemRef {
  id: string;
  testId: string;
  isPanel: boolean;
  sortOrder: number;
}

/**
 * Turns an order's billed lines into the individual tests to run (panels
 * expanded, each test once) and one sample per sample type and container.
 * Run inside the order's transaction.
 */
export async function createWorkItems(
  tx: Tx,
  tenantId: string,
  order: { id: string; orderNo: string },
  items: ItemRef[],
  /** When adding to an order that already has work items: tests it already has, and where numbering carries on from. */
  existing: { testIds: Set<string>; samples: number; tests: number; firstBarcode?: string | null; mode?: BarcodeMode; sharedBarcode?: string | null } = { testIds: new Set(), samples: 0, tests: 0 },
): Promise<void> {
  const ordered = [...items].sort((a, b) => a.sortOrder - b.sortOrder);

  // Panel members, in report order.
  const panelIds = ordered.filter((i) => i.isPanel).map((i) => i.testId);
  const members = panelIds.length
    ? await tx.testPanelItem.findMany({
        where: { tenantId, panelId: { in: panelIds } },
        orderBy: { sortOrder: "asc" },
        select: { panelId: true, testId: true },
      })
    : [];

  // (billed line, test) pairs, each test once.
  const plan: { itemId: string; testId: string }[] = [];
  const seen = new Set<string>(existing.testIds);
  for (const item of ordered) {
    const testIds = item.isPanel ? members.filter((m) => m.panelId === item.testId).map((m) => m.testId) : [item.testId];
    for (const testId of testIds) {
      if (seen.has(testId)) continue;
      seen.add(testId);
      plan.push({ itemId: item.id, testId });
    }
  }

  const tests = await tx.test.findMany({
    where: { tenantId, id: { in: plan.map((p) => p.testId) } },
    select: { id: true, code: true, name: true, sampleType: true, container: true, department: { select: { name: true } } },
  });
  const byId = new Map(tests.map((t) => [t.id, t]));

  // One sample per sample type + container, in the order they first appear.
  const groups = new Map<string, { sampleType: string; container: string | null; testIds: string[] }>();
  for (const p of plan) {
    const t = byId.get(p.testId);
    if (!t) continue;
    const container = t.container || SAMPLE_TYPES.find((s) => s.key === t.sampleType)?.container || null;
    // Department wise: tests from different departments never share a barcode.
    const key = `${t.sampleType}|${container ?? ""}${existing.mode === "department" ? `|${t.department.name}` : ""}`;
    const g = groups.get(key) ?? { sampleType: t.sampleType, container, testIds: [] };
    g.testIds.push(t.id);
    groups.set(key, g);
  }

  const sampleOf = new Map<string, string>();
  let index = existing.samples + 1;
  // Patient wise: every tube of the visit carries the same barcode.
  const sharedBarcode = existing.mode === "patient" ? existing.sharedBarcode || existing.firstBarcode || formatBarcode(order.orderNo, 1) : null;
  for (const g of groups.values()) {
    const sample = await tx.sample.create({
      data: {
        tenantId,
        orderId: order.id,
        barcode: sharedBarcode ?? (index === 1 && existing.firstBarcode ? (index++, existing.firstBarcode) : formatBarcode(order.orderNo, index++)),
        sampleType: g.sampleType,
        container: g.container,
      },
      select: { id: true },
    });
    for (const id of g.testIds) sampleOf.set(id, sample.id);
  }

  await tx.orderTest.createMany({
    data: plan
      .filter((p) => byId.has(p.testId))
      .map((p, i) => {
        const t = byId.get(p.testId)!;
        return {
          tenantId,
          orderId: order.id,
          orderItemId: p.itemId,
          testId: t.id,
          sampleId: sampleOf.get(t.id) ?? null,
          code: t.code,
          name: t.name,
          departmentName: t.department.name,
          sampleType: t.sampleType,
          sortOrder: existing.tests + i,
        };
      }),
  });
}

/**
 * Orders billed before samples existed have no tests or samples yet: create
 * them the first time someone looks.
 */
export async function ensureWorkItems(db: TenantDb, orderId: string): Promise<void> {
  const order = await db.order.findFirst({
    where: { id: orderId },
    select: {
      id: true,
      tenantId: true,
      orderNo: true,
      status: true,
      _count: { select: { tests: true } },
      items: { select: { id: true, testId: true, isPanel: true, sortOrder: true } },
    },
  });
  if (!order || order.status !== "ACTIVE" || order._count.tests > 0) return;
  try {
    await db.$transaction((tx) => createWorkItems(tx, order.tenantId, order, order.items));
  } catch (err) {
    // Someone else created them at the same moment (duplicate barcode): that's fine.
    if ((err as { code?: string }).code !== "P2002") throw err;
  }
}
