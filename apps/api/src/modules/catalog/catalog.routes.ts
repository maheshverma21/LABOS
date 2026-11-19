import { Router, type Request } from "express";
import {
  departmentSchema,
  priceListItemsSchema,
  priceListSchema,
  testSchema,
  testStatusSchema,
  type TestOutput,
} from "@lms/shared";
import { authenticate, ctx, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import * as catalog from "./catalog.service";

export const catalogRouter = Router();
catalogRouter.use(authenticate);

const read = requirePermission("catalog:read");
const write = requirePermission("catalog:write");

function actor(req: Request): catalog.Actor {
  const { auth } = ctx(req);
  return { tenantId: auth.tenantId, userId: auth.userId, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

const param = (req: Request, name: string) => String(req.params[name]);

// Departments
catalogRouter.get("/departments", read, async (req, res) => {
  res.json({ departments: await catalog.listDepartments(ctx(req).db) });
});

catalogRouter.post("/departments", write, validateBody(departmentSchema), async (req, res) => {
  res.status(201).json({ department: await catalog.createDepartment(ctx(req).db, actor(req), req.body.name) });
});

// Tests
catalogRouter.get("/tests", read, async (req, res) => {
  const q = req.query;
  const tests = await catalog.listTests(ctx(req).db, {
    search: typeof q.search === "string" ? q.search : undefined,
    departmentId: typeof q.departmentId === "string" && q.departmentId ? q.departmentId : undefined,
    includeInactive: q.includeInactive === "true",
  });
  res.json({ tests });
});

catalogRouter.get("/tests/:id", read, async (req, res) => {
  res.json({ test: await catalog.getTest(ctx(req).db, param(req, "id")) });
});

catalogRouter.post("/tests", write, validateBody(testSchema), async (req, res) => {
  res.status(201).json({ test: await catalog.createTest(ctx(req).db, actor(req), req.body as TestOutput) });
});

catalogRouter.put("/tests/:id", write, validateBody(testSchema), async (req, res) => {
  res.json({ test: await catalog.updateTest(ctx(req).db, actor(req), param(req, "id"), req.body as TestOutput) });
});

catalogRouter.post("/tests/:id/duplicate", write, async (req, res) => {
  res.status(201).json({ test: await catalog.duplicateTest(ctx(req).db, actor(req), param(req, "id")) });
});

catalogRouter.patch("/tests/:id/status", write, validateBody(testStatusSchema), async (req, res) => {
  await catalog.setTestActive(ctx(req).db, actor(req), param(req, "id"), req.body.isActive);
  res.status(204).end();
});

catalogRouter.delete("/tests/:id", write, async (req, res) => {
  await catalog.deleteTest(ctx(req).db, actor(req), param(req, "id"));
  res.status(204).end();
});

catalogRouter.post("/import-starter", write, async (req, res) => {
  res.json(await catalog.importStarterCatalog(ctx(req).db, actor(req)));
});

// Price lists
catalogRouter.get("/price-lists", read, async (req, res) => {
  res.json({ priceLists: await catalog.listPriceLists(ctx(req).db) });
});

catalogRouter.post("/price-lists", write, validateBody(priceListSchema), async (req, res) => {
  res.status(201).json({ priceList: await catalog.createPriceList(ctx(req).db, actor(req), req.body.name, req.body.type) });
});

catalogRouter.get("/price-lists/:id", read, async (req, res) => {
  res.json({ priceList: await catalog.getPriceList(ctx(req).db, param(req, "id")) });
});

catalogRouter.put("/price-lists/:id/items", write, validateBody(priceListItemsSchema), async (req, res) => {
  res.json({ priceList: await catalog.setPriceListItems(ctx(req).db, actor(req), param(req, "id"), req.body.items) });
});
