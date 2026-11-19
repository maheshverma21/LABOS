import { Router, type NextFunction, type Request, type Response } from "express";
import {
  INSTRUMENT_MESSAGE_STATUSES,
  instrumentMappingsSchema,
  instrumentSchema,
  interfaceHeartbeatSchema,
  interfaceKeySchema,
  interfaceMessageSchema,
  type InstrumentMessageStatus,
} from "@lms/shared";
import type { z } from "zod";
import { authenticate, ctx, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { audit } from "../../lib/audit";
import { badRequest, unauthorized } from "../../lib/errors";
import { rateLimit } from "../../lib/rate-limit";
import * as instruments from "./instruments.service";

const meta = (req: Request) => {
  const { auth } = ctx(req);
  return { tenantId: auth.tenantId, actorId: auth.userId, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
};

// ---------------------------------------------------------------------------
// /api/instruments: setting up analyzers (lab owner)
// ---------------------------------------------------------------------------

export const instrumentsRouter = Router();
instrumentsRouter.use(authenticate, requirePermission("settings:write"));

instrumentsRouter.get("/", async (req, res) => {
  res.json({ instruments: await instruments.listInstruments(ctx(req).db) });
});

instrumentsRouter.post("/", validateBody(instrumentSchema), async (req, res) => {
  const { auth, db } = ctx(req);
  const input = req.body as z.output<typeof instrumentSchema>;
  const instrument = await instruments.createInstrument(db, auth.tenantId, input);
  await audit({ ...meta(req), action: "instrument.create", entityType: "instrument", entityId: instrument.id, after: input });
  res.status(201).json({ instrument });
});

instrumentsRouter.get("/parameters", async (req, res) => {
  res.json({ parameters: await instruments.mappableParameters(ctx(req).db) });
});

instrumentsRouter.get("/keys", async (req, res) => {
  res.json({ keys: await instruments.listKeys(ctx(req).db) });
});

instrumentsRouter.post("/keys", validateBody(interfaceKeySchema), async (req, res) => {
  const { auth, db } = ctx(req);
  const { key, item } = await instruments.createKey(db, auth.tenantId, (req.body as z.output<typeof interfaceKeySchema>).name, auth.userId);
  await audit({ ...meta(req), action: "interface_key.create", entityType: "interface_key", entityId: item.id, after: { name: item.name } });
  // The key itself is shown this once; only its hash is kept.
  res.status(201).json({ key, item });
});

instrumentsRouter.delete("/keys/:id", async (req, res) => {
  const k = await instruments.revokeKey(ctx(req).db, String(req.params.id));
  await audit({ ...meta(req), action: "interface_key.revoke", entityType: "interface_key", entityId: k.id, before: { name: k.name } });
  res.status(204).end();
});

instrumentsRouter.put("/:id", validateBody(instrumentSchema), async (req, res) => {
  const input = req.body as z.output<typeof instrumentSchema>;
  const { before, instrument } = await instruments.updateInstrument(ctx(req).db, String(req.params.id), input);
  await audit({ ...meta(req), action: "instrument.update", entityType: "instrument", entityId: instrument.id, before, after: input });
  res.json({ instrument });
});

instrumentsRouter.delete("/:id", async (req, res) => {
  const i = await instruments.deleteInstrument(ctx(req).db, String(req.params.id));
  await audit({ ...meta(req), action: "instrument.delete", entityType: "instrument", entityId: i.id, before: { name: i.name } });
  res.status(204).end();
});

instrumentsRouter.get("/:id/mappings", async (req, res) => {
  res.json(await instruments.getMappings(ctx(req).db, String(req.params.id)));
});

instrumentsRouter.put("/:id/mappings", validateBody(instrumentMappingsSchema), async (req, res) => {
  const { auth, db } = ctx(req);
  const { mappings } = req.body as z.output<typeof instrumentMappingsSchema>;
  const result = await instruments.saveMappings(db, auth.tenantId, String(req.params.id), mappings);
  await audit({ ...meta(req), action: "instrument.mappings", entityType: "instrument", entityId: String(req.params.id), after: { count: mappings.length } });
  res.json(result);
});

instrumentsRouter.get("/:id/messages", async (req, res) => {
  const status = typeof req.query.status === "string" && req.query.status ? (req.query.status as InstrumentMessageStatus) : undefined;
  if (status && !INSTRUMENT_MESSAGE_STATUSES.includes(status)) throw badRequest("Unknown status");
  res.json({ messages: await instruments.listMessages(ctx(req).db, String(req.params.id), { status }) });
});

instrumentsRouter.post("/messages/:messageId/retry", async (req, res) => {
  const { auth, db } = ctx(req);
  res.json({ message: await instruments.retryMessage(db, auth.tenantId, String(req.params.messageId)) });
});

// ---------------------------------------------------------------------------
// /api/interface: the interface program on the lab PC, signed in with a key
// ---------------------------------------------------------------------------

type KeyedRequest = Request & { interfaceKey?: { tenantId: string; keyId: string } };

async function keyAuth(req: KeyedRequest, _res: Response, next: NextFunction) {
  await rateLimit(`interface-auth:${req.ip}`, 600, 60);
  const header = req.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const found = key ? await instruments.authenticateKey(key) : null;
  if (!found) throw unauthorized("Unknown or revoked interface key");
  req.interfaceKey = found;
  next();
}

const keyOf = (req: Request) => (req as KeyedRequest).interfaceKey!;

export const interfaceRouter = Router();
interfaceRouter.use(keyAuth);

interfaceRouter.get("/config", async (req, res) => {
  res.json(await instruments.interfaceConfig(keyOf(req).tenantId));
});

interfaceRouter.post("/heartbeat", validateBody(interfaceHeartbeatSchema), async (req, res) => {
  await instruments.heartbeat(keyOf(req).tenantId, (req.body as z.output<typeof interfaceHeartbeatSchema>).connected);
  res.status(204).end();
});

interfaceRouter.post("/messages", validateBody(interfaceMessageSchema), async (req, res) => {
  const { tenantId, keyId } = keyOf(req);
  // Analyzers send in bursts after a run; this is far above any real rate.
  await rateLimit(`interface-msg:${keyId}`, 2000, 60);
  const input = req.body as z.output<typeof interfaceMessageSchema>;
  res.status(201).json({ messages: await instruments.receive(tenantId, input.instrumentId, input.raw) });
});
