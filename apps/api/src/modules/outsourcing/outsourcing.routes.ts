import { Router, type Request } from "express";
import { outsourceLabSchema, outsourceTestSchema } from "@lms/shared";
import { authenticate, ctx, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { audit } from "../../lib/audit";
import * as outsourcing from "./outsourcing.service";

export const outsourcingRouter = Router();
outsourcingRouter.use(authenticate);

const read = requirePermission("catalog:read");
const write = requirePermission("catalog:write");

const meta = (req: Request) => {
  const { auth } = ctx(req);
  return { tenantId: auth.tenantId, actorId: auth.userId, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
};

outsourcingRouter.get("/labs", read, async (req, res) => {
  res.json({ labs: await outsourcing.listLabs(ctx(req).db) });
});

outsourcingRouter.post("/labs", write, validateBody(outsourceLabSchema), async (req, res) => {
  const { auth, db } = ctx(req);
  const lab = await outsourcing.createLab(db, auth.tenantId, req.body.name, req.body.testIds);
  await audit({ ...meta(req), action: "outsource_lab.create", entityType: "outsource_lab", entityId: lab.id, after: { name: lab.name } });
  res.status(201).json({ lab });
});

outsourcingRouter.put("/labs/:id", write, validateBody(outsourceLabSchema), async (req, res) => {
  const { db } = ctx(req);
  const { before, lab } = await outsourcing.updateLab(db, String(req.params.id), req.body.name, req.body.testIds);
  await audit({
    ...meta(req),
    action: "outsource_lab.update",
    entityType: "outsource_lab",
    entityId: lab.id,
    before: { name: before.name, tests: before.tests.map((t) => t.code) },
    after: { name: lab.name, tests: lab.tests.map((t) => t.code) },
  });
  res.json({ lab });
});

outsourcingRouter.delete("/labs/:id", write, async (req, res) => {
  const lab = await outsourcing.deleteLab(ctx(req).db, String(req.params.id));
  await audit({ ...meta(req), action: "outsource_lab.delete", entityType: "outsource_lab", entityId: lab.id, before: { name: lab.name, tests: lab.tests.map((t) => t.code) } });
  res.status(204).end();
});

outsourcingRouter.get("/tests", read, async (req, res) => {
  res.json({ tests: await outsourcing.listTests(ctx(req).db) });
});

outsourcingRouter.put("/tests/:id", write, validateBody(outsourceTestSchema), async (req, res) => {
  const r = await outsourcing.setTestLab(ctx(req).db, String(req.params.id), req.body.labId);
  await audit({ ...meta(req), action: "outsource_test.set", entityType: "test", entityId: String(req.params.id), before: { labId: r.before }, after: { labId: r.after, code: r.code } });
  res.status(204).end();
});
