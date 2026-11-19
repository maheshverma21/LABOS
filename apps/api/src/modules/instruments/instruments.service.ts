import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  parseNumericResult,
  type InstrumentItem,
  type InstrumentMappingItem,
  type InstrumentMessageItem,
  type InstrumentMessageStatus,
  type InstrumentValueOutcome,
  type InterfaceConfig,
  type InterfaceKeyItem,
  type MappableParameter,
} from "@lms/shared";
import { prisma } from "../../lib/prisma";
import { tenantDb, type TenantDb } from "../../lib/tenant-db";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors";
import { istDayRange } from "../orders/orders.service";
import { saveResults } from "../results/results.service";
import { todayIST } from "@lms/shared";
import { parseMessage, type ParsedSample } from "./parse";

// ---------------------------------------------------------------------------
// Interface keys: what the interface program signs in with
// ---------------------------------------------------------------------------

const KEY_PREFIX = "lif_";
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export async function createKey(db: TenantDb, tenantId: string, name: string, createdById: string) {
  const key = KEY_PREFIX + randomBytes(24).toString("base64url");
  const row = await db.interfaceKey.create({
    data: { tenantId, name, prefix: key.slice(0, 10), keyHash: hashKey(key), createdById },
    select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true },
  });
  return { key, item: toKeyItem(row) };
}

const toKeyItem = (k: { id: string; name: string; prefix: string; lastUsedAt: Date | null; createdAt: Date }): InterfaceKeyItem => ({
  ...k,
  lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  createdAt: k.createdAt.toISOString(),
});

export async function listKeys(db: TenantDb): Promise<InterfaceKeyItem[]> {
  const rows = await db.interfaceKey.findMany({
    where: { revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true },
  });
  return rows.map(toKeyItem);
}

export async function revokeKey(db: TenantDb, id: string) {
  const k = await db.interfaceKey.findFirst({ where: { id, revokedAt: null }, select: { id: true, name: true } });
  if (!k) throw notFound("Key not found");
  await db.interfaceKey.update({ where: { id }, data: { revokedAt: new Date() } });
  return k;
}

/** The lab a key belongs to, or null if it's unknown or revoked. */
export async function authenticateKey(key: string): Promise<{ tenantId: string; keyId: string } | null> {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const k = await prisma.interfaceKey.findUnique({ where: { keyHash: hashKey(key) }, select: { id: true, tenantId: true, revokedAt: true, lastUsedAt: true } });
  if (!k || k.revokedAt) return null;
  // Note use about once a minute, not on every message.
  if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 60_000) {
    await prisma.interfaceKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } });
  }
  return { tenantId: k.tenantId, keyId: k.id };
}

// ---------------------------------------------------------------------------
// Instruments and their code mappings
// ---------------------------------------------------------------------------

const instrumentSelect = {
  id: true,
  name: true,
  model: true,
  protocol: true,
  connection: true,
  host: true,
  port: true,
  isActive: true,
  lastSeenAt: true,
  _count: { select: { mappings: true } },
} as const;

type InstrumentValues = Omit<InstrumentItem, "id" | "lastSeenAt" | "mappingCount" | "messagesToday">;

export async function listInstruments(db: TenantDb): Promise<InstrumentItem[]> {
  const rows = await db.instrument.findMany({ orderBy: { createdAt: "asc" }, select: instrumentSelect });
  const today = await db.instrumentMessage.groupBy({
    by: ["instrumentId"],
    where: { createdAt: istDayRange(todayIST()) },
    _count: { _all: true },
  });
  return rows.map(({ _count, lastSeenAt, ...r }) => ({
    ...r,
    lastSeenAt: lastSeenAt?.toISOString() ?? null,
    mappingCount: _count.mappings,
    messagesToday: today.find((t) => t.instrumentId === r.id)?._count._all ?? 0,
  }));
}

async function assertPortFree(db: TenantDb, v: InstrumentValues, exceptId?: string) {
  // Two analyzers can't both wait on the same port of the interface PC.
  if (v.connection !== "LISTEN") return;
  const clash = await db.instrument.findFirst({ where: { connection: "LISTEN", port: v.port, isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true } });
  if (clash) throw conflict(`${clash.name} already uses port ${v.port}`, { port: [`${clash.name} already uses this port`] });
}

export async function createInstrument(db: TenantDb, tenantId: string, v: InstrumentValues) {
  await assertPortFree(db, v);
  const row = await db.instrument.create({ data: { tenantId, ...v }, select: { id: true } });
  return (await listInstruments(db)).find((i) => i.id === row.id)!;
}

export async function updateInstrument(db: TenantDb, id: string, v: InstrumentValues) {
  const before = await db.instrument.findFirst({ where: { id }, select: { id: true, name: true, port: true, connection: true, isActive: true } });
  if (!before) throw notFound("Analyzer not found");
  await assertPortFree(db, v, id);
  await db.instrument.update({ where: { id }, data: v });
  return { before, instrument: (await listInstruments(db)).find((i) => i.id === id)! };
}

export async function deleteInstrument(db: TenantDb, id: string) {
  const i = await db.instrument.findFirst({ where: { id }, select: { id: true, name: true } });
  if (!i) throw notFound("Analyzer not found");
  await db.instrument.delete({ where: { id } });
  return i;
}

/** Every parameter a machine can fill: typed-in values of active tests (not calculated ones). */
export async function mappableParameters(db: TenantDb): Promise<MappableParameter[]> {
  const rows = await db.parameter.findMany({
    where: { isActive: true, formula: null, test: { isActive: true } },
    orderBy: [{ test: { name: "asc" } }, { sortOrder: "asc" }],
    select: { id: true, code: true, name: true, unit: true, test: { select: { code: true, name: true } } },
  });
  return rows.map((p) => ({ id: p.id, code: p.code, name: p.name, unit: p.unit, testCode: p.test.code, testName: p.test.name }));
}

/**
 * Codes analyzers commonly use for tests that LabOS's starter catalog names
 * differently, e.g. Sysmex "HGB" for "HB". Only used to suggest links.
 */
const COMMON_CODES: Record<string, string> = {
  WBC: "TLC", HGB: "HB", HB: "HB", HCT: "PCV", "RDW-CV": "RDW", RDWCV: "RDW",
  "NEUT%": "NEUT", "NEU%": "NEUT", "LYMPH%": "LYMPH", "LYM%": "LYMPH", "MONO%": "MONO", "MON%": "MONO",
  "EO%": "EOS", "EOS%": "EOS", "BASO%": "BASO", "BAS%": "BASO",
  CHOL: "TCHOL", TC: "TCHOL", TRIG: "TG", "HDL-C": "HDL", HDLC: "HDL",
  "BIL-T": "TBIL", TBILI: "TBIL", "BIL-D": "DBIL", DBILI: "DBIL",
  GOT: "AST", SGOT: "AST", GPT: "ALT", SGPT: "ALT", CREA: "CREAT", CRE: "CREAT", URIC: "UA", "UA-": "UA",
  A1C: "HBA1C", HBA1C: "HBA1C", "GGT-": "GGT",
};

export async function getMappings(
  db: TenantDb,
  instrumentId: string,
): Promise<{ mappings: InstrumentMappingItem[]; unmapped: string[]; suggestions: { analyzerCode: string; parameterId: string }[] }> {
  if (!(await db.instrument.findFirst({ where: { id: instrumentId }, select: { id: true } }))) throw notFound("Analyzer not found");
  const rows = await db.instrumentMapping.findMany({ where: { instrumentId }, orderBy: { analyzerCode: "asc" } });
  const params = rows.length
    ? await db.parameter.findMany({
        where: { id: { in: rows.map((r) => r.parameterId) } },
        select: { id: true, code: true, name: true, unit: true, test: { select: { name: true } } },
      })
    : [];
  // Codes the machine sent recently that went nowhere: the ones still to link.
  const recent = await db.instrumentMessage.findMany({
    where: { instrumentId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { detail: true },
  });
  const mapped = new Set(rows.map((r) => r.analyzerCode.toUpperCase()));
  const unmapped = new Set<string>();
  for (const m of recent) {
    for (const d of m.detail as unknown as InstrumentValueOutcome[]) {
      if (!d.applied && d.reason === NOT_LINKED && !mapped.has(d.code.toUpperCase())) unmapped.add(d.code);
    }
  }
  // A suggestion only when exactly one typed-in parameter has the matching code.
  const suggestions: { analyzerCode: string; parameterId: string }[] = [];
  if (unmapped.size) {
    const params = await db.parameter.findMany({ where: { isActive: true, formula: null, test: { isActive: true } }, select: { id: true, code: true } });
    for (const code of unmapped) {
      const want = COMMON_CODES[code.toUpperCase()] ?? code.toUpperCase().replace(/%$/, "");
      const hits = params.filter((p) => p.code.toUpperCase() === want);
      if (hits.length === 1) suggestions.push({ analyzerCode: code, parameterId: hits[0]!.id });
    }
  }
  return {
    suggestions,
    mappings: rows.map((r) => {
      const p = params.find((x) => x.id === r.parameterId);
      return {
        analyzerCode: r.analyzerCode,
        parameterId: r.parameterId,
        factor: r.factor,
        parameter: p ? { code: p.code, name: p.name, unit: p.unit, test: p.test.name } : null,
      };
    }),
    unmapped: [...unmapped].sort(),
  };
}

export async function saveMappings(
  db: TenantDb,
  tenantId: string,
  instrumentId: string,
  mappings: { analyzerCode: string; parameterId: string; factor: number | null }[],
) {
  if (!(await db.instrument.findFirst({ where: { id: instrumentId }, select: { id: true } }))) throw notFound("Analyzer not found");
  const codes = mappings.map((m) => m.analyzerCode.toUpperCase());
  const dup = codes.find((c, i) => codes.indexOf(c) !== i);
  if (dup) throw badRequest(`The code ${dup} is listed twice`);
  const ids = [...new Set(mappings.map((m) => m.parameterId))];
  const found = await db.parameter.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw badRequest("One of the test parameters no longer exists");
  await db.$transaction(async (tx) => {
    await tx.instrumentMapping.deleteMany({ where: { tenantId, instrumentId } });
    if (mappings.length) {
      await tx.instrumentMapping.createMany({
        data: mappings.map((m) => ({ tenantId, instrumentId, analyzerCode: m.analyzerCode.trim(), parameterId: m.parameterId, factor: m.factor })),
      });
    }
  });
  return getMappings(db, instrumentId);
}

export async function listMessages(db: TenantDb, instrumentId: string, f: { status?: InstrumentMessageStatus } = {}): Promise<InstrumentMessageItem[]> {
  const rows = await db.instrumentMessage.findMany({
    where: { instrumentId, ...(f.status ? { status: f.status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const orderIds = [...new Set(rows.map((r) => r.orderId).filter((x): x is string => !!x))];
  const orders = orderIds.length ? await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNo: true } }) : [];
  return rows.map((r) => ({
    id: r.id,
    sampleId: r.sampleId,
    orderId: r.orderId,
    orderNo: orders.find((o) => o.id === r.orderId)?.orderNo ?? null,
    status: r.status,
    summary: r.summary,
    detail: r.detail as unknown as InstrumentValueOutcome[],
    raw: r.raw,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Receiving results
// ---------------------------------------------------------------------------

const NOT_LINKED = "This code isn't linked to a LabOS test yet";

export async function interfaceConfig(tenantId: string): Promise<InterfaceConfig> {
  const lab = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
  const instruments = await prisma.instrument.findMany({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, protocol: true, connection: true, host: true, port: true },
  });
  return { lab: lab.name, instruments };
}

export async function heartbeat(tenantId: string, connected: string[]) {
  if (connected.length) await prisma.instrument.updateMany({ where: { tenantId, id: { in: connected } }, data: { lastSeenAt: new Date() } });
}

/** Barcodes as analyzers send them: sometimes zero-padded, sometimes with spaces. */
function idCandidates(ids: string[]) {
  const out = new Set<string>();
  for (const id of ids) {
    const t = id.replace(/\s+/g, "");
    if (!t) continue;
    out.add(t);
    out.add(t.replace(/^0+(?=\d)/, ""));
  }
  return [...out];
}

type Param = { id: string; code: string; name: string; resultType: string; options: string[]; formula: string | null; isActive: boolean };

/**
 * Puts one sample's values into its tests. Values go in as "entered" for the
 * technician to check and submit; tests already submitted or approved are left alone.
 */
async function applySample(
  db: TenantDb,
  tenantId: string,
  instrument: { id: string; name: string },
  sample: ParsedSample,
): Promise<{ status: InstrumentMessageStatus; sampleId: string | null; orderId: string | null; summary: string; detail: InstrumentValueOutcome[] }> {
  const outcome = (v: ParsedSample["values"][number], applied: boolean, target: string | null, reason: string | null): InstrumentValueOutcome => ({
    code: v.codes[0]!,
    value: v.value,
    unit: v.unit,
    applied,
    target,
    reason,
  });
  const sentId = sample.ids[0] ?? null;
  const candidates = idCandidates(sample.ids);
  const tube = candidates.length
    ? await db.sample.findFirst({
        where: { barcode: { in: candidates }, status: { not: "REJECTED" } },
        select: { id: true, barcode: true, orderId: true, order: { select: { status: true } } },
      })
    : null;
  // Patient wise: one barcode can sit on several tubes of the same visit; the analyzer's values may belong to any of them.
  const tubeIds = tube
    ? (await db.sample.findMany({ where: { orderId: tube.orderId, barcode: tube.barcode, status: { not: "REJECTED" } }, select: { id: true } })).map((s) => s.id)
    : [];
  if (!tube) {
    const detail = sample.values.map((v) => outcome(v, false, null, "No tube with this barcode in LabOS"));
    return { status: "NOT_APPLIED", sampleId: sentId, orderId: null, summary: sentId ? `No tube with barcode ${sentId}` : "The message had no sample ID", detail };
  }
  if (tube.order.status !== "ACTIVE") {
    const detail = sample.values.map((v) => outcome(v, false, null, "The order is cancelled"));
    return { status: "NOT_APPLIED", sampleId: tube.barcode, orderId: tube.orderId, summary: "The order is cancelled", detail };
  }

  const tests = await db.orderTest.findMany({
    where: { sampleId: { in: tubeIds }, status: { not: "CANCELLED" } },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      remarks: true,
      test: { select: { parameters: { select: { id: true, code: true, name: true, resultType: true, options: true, formula: true, isActive: true } } } },
    },
  });
  const mappings = await db.instrumentMapping.findMany({ where: { instrumentId: instrument.id }, select: { analyzerCode: true, parameterId: true, factor: true } });
  const mapByCode = new Map(mappings.map((m) => [m.analyzerCode.toUpperCase(), m]));

  const detail: InstrumentValueOutcome[] = [];
  const pending = new Map<string, { test: (typeof tests)[number]; values: Record<string, string>; items: { v: ParsedSample["values"][number]; p: Param }[] }>();

  for (const v of sample.values) {
    // A linked code first; otherwise a parameter on this tube with the same code (e.g. WBC = WBC).
    const linked = v.codes.map((c) => mapByCode.get(c.toUpperCase())).find(Boolean);
    let hit: { test: (typeof tests)[number]; p: Param } | null = null;
    for (const t of tests) {
      const p = linked
        ? t.test.parameters.find((x) => x.id === linked.parameterId)
        : t.test.parameters.find((x) => x.isActive && !x.formula && v.codes.some((c) => c.toUpperCase() === x.code.toUpperCase()));
      if (p) {
        hit = { test: t, p };
        break;
      }
    }
    if (!hit) {
      detail.push(outcome(v, false, null, linked ? "That test isn't ordered on this tube" : NOT_LINKED));
      continue;
    }
    const { test, p } = hit;
    const target = `${test.code} · ${p.name}`;
    if (p.formula) {
      detail.push(outcome(v, false, target, "LabOS calculates this one"));
      continue;
    }
    let value: string | null = v.value;
    if (p.resultType === "NUMERIC") {
      const n = parseNumericResult(v.value);
      if (n == null) {
        detail.push(outcome(v, false, target, "Not a number"));
        continue;
      }
      value = String(linked?.factor ? Number((n * linked.factor).toPrecision(12)) : n);
    } else if (p.resultType === "OPTIONS") {
      value = p.options.find((o) => o.toLowerCase() === v.value.toLowerCase()) ?? null;
      if (!value) {
        detail.push(outcome(v, false, target, `Not one of: ${p.options.join(", ")}`));
        continue;
      }
    }
    const group = pending.get(test.id) ?? { test, values: {}, items: [] };
    group.values[p.id] = value;
    group.items.push({ v, p });
    pending.set(test.id, group);
  }

  const machine = { tenantId, userId: null, ip: null, userAgent: `instrument:${instrument.name}` };
  for (const { test, values, items } of pending.values()) {
    const blocked =
      test.status === "AWAITING_SAMPLE"
        ? "The tube hasn't been received in the lab yet"
        : test.status === "SUBMITTED"
          ? "Already submitted for approval, so not changed"
          : test.status === "APPROVED"
            ? "Already approved, so not changed"
            : null;
    if (!blocked) {
      try {
        await saveResults(db, machine, test.id, { values, remarks: test.remarks, submit: false }, { source: instrument.name });
      } catch (err) {
        const reason = err instanceof AppError ? err.message : "Couldn't save";
        for (const { v, p } of items) detail.push(outcome(v, false, `${test.code} · ${p.name}`, reason));
        continue;
      }
    }
    for (const { v, p } of items) detail.push(outcome(v, !blocked, `${test.code} · ${p.name}`, blocked));
  }

  const applied = detail.filter((d) => d.applied).length;
  const status: InstrumentMessageStatus = applied === 0 ? "NOT_APPLIED" : applied === detail.length ? "APPLIED" : "PARTIAL";
  const summary =
    status === "APPLIED"
      ? `${applied} value${applied === 1 ? "" : "s"} filled in`
      : status === "PARTIAL"
        ? `${applied} of ${detail.length} values filled in`
        : (detail.find((d) => d.reason)?.reason ?? "No values in the message");
  return { status, sampleId: tube.barcode, orderId: tube.orderId, summary, detail };
}

/** Handles one message from an analyzer: one log row per sample in it. */
export async function receive(tenantId: string, instrumentId: string, raw: string): Promise<InstrumentMessageItem[]> {
  const db = tenantDb(tenantId);
  const instrument = await db.instrument.findFirst({ where: { id: instrumentId }, select: { id: true, name: true, protocol: true } });
  if (!instrument) throw notFound("Analyzer not found");
  await db.instrument.update({ where: { id: instrument.id }, data: { lastSeenAt: new Date() } });

  let samples: ParsedSample[];
  try {
    samples = parseMessage(raw, instrument.protocol).samples;
  } catch (err) {
    const row = await db.instrumentMessage.create({
      data: { tenantId, instrumentId, status: "ERROR", summary: err instanceof Error ? err.message : "Couldn't read the message", raw },
    });
    return listMessagesByIds(db, [row.id]);
  }
  // Queries and keep-alives carry no results; nothing to log.
  samples = samples.filter((s) => s.values.length);
  const ids: string[] = [];
  for (const s of samples) {
    const r = await applySample(db, tenantId, instrument, s);
    const row = await db.instrumentMessage.create({
      data: {
        tenantId,
        instrumentId,
        sampleId: r.sampleId,
        orderId: r.orderId,
        status: r.status,
        summary: r.summary,
        detail: r.detail as unknown as Prisma.InputJsonValue,
        raw,
      },
    });
    ids.push(row.id);
  }
  return listMessagesByIds(db, ids);
}

async function listMessagesByIds(db: TenantDb, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.instrumentMessage.findMany({ where: { id: { in: ids } }, select: { instrumentId: true } });
  const all = rows.length ? await listMessages(db, rows[0]!.instrumentId) : [];
  return all.filter((m) => ids.includes(m.id));
}

/** Tries a logged message again, e.g. after linking a code or receiving the tube. */
export async function retryMessage(db: TenantDb, tenantId: string, messageId: string) {
  const m = await db.instrumentMessage.findFirst({ where: { id: messageId }, select: { instrumentId: true, raw: true, sampleId: true } });
  if (!m) throw notFound("Message not found");
  const results = await receive(tenantId, m.instrumentId, m.raw);
  // A message with several samples is retried whole; return the row for the same sample.
  return results.find((r) => r.sampleId === m.sampleId) ?? results[0] ?? null;
}
