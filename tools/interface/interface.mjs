#!/usr/bin/env node
/**
 * LabOS analyzer interface. Runs on a PC on the same network as the
 * analyzers, receives their results (ASTM or HL7 over TCP) and sends them to
 * LabOS. Results are saved to a queue on disk first, so nothing is lost if
 * LabOS or the network is down for a while.
 *
 *   First run:   node tools/interface/interface.mjs --url http://localhost:4000 --key lif_...
 *   After that:  node tools/interface/interface.mjs   (settings are remembered)
 *
 * No packages needed: only Node's own modules.
 */
import { createServer, connect } from "node:net";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataDir = process.env.LABOS_INTERFACE_DIR ?? join(root, ".local-data");
const settingsFile = join(dataDir, "interface.json");
const queueFile = join(dataDir, "interface-queue.jsonl");
const failedFile = join(dataDir, "interface-failed.jsonl");
mkdirSync(dataDir, { recursive: true });

const ENQ = 0x05, ACK = 0x06, NAK = 0x15, STX = 0x02, ETX = 0x03, ETB = 0x17, EOT = 0x04, VT = 0x0b, FS = 0x1c, CR = 0x0d;

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

// ---------------------------------------------------------------------------
// Settings: --url and --key once; remembered in .local-data/interface.json
// ---------------------------------------------------------------------------

function argValue(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
let saved = {};
try {
  saved = JSON.parse(readFileSync(settingsFile, "utf8"));
} catch {}
const settings = {
  url: (argValue("url") ?? process.env.LABOS_URL ?? saved.url ?? "http://localhost:4000").replace(/\/+$/, ""),
  key: argValue("key") ?? process.env.LABOS_INTERFACE_KEY ?? saved.key,
};
if (!settings.key) {
  console.error("No interface key. In LabOS go to Settings → Analyzers → Create key, then run:\n  node tools/interface/interface.mjs --url <LabOS address> --key <key>");
  process.exit(1);
}
if (argValue("url") || argValue("key")) writeFileSync(settingsFile, JSON.stringify(settings, null, 2));

async function api(path, body) {
  const res = await fetch(settings.url + "/api/interface" + path, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${settings.key}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(json?.error?.message ?? `LabOS answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// ---------------------------------------------------------------------------
// The queue: every message is written to disk before it's acknowledged
// ---------------------------------------------------------------------------

let queue = [];
if (existsSync(queueFile)) {
  queue = readFileSync(queueFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (queue.length) log(`${queue.length} result message(s) waiting from last time; sending them now.`);
}
const saveQueue = () => {
  writeFileSync(queueFile + ".tmp", queue.map((m) => JSON.stringify(m)).join("\n") + (queue.length ? "\n" : ""));
  renameSync(queueFile + ".tmp", queueFile);
};

function enqueue(instrument, raw) {
  const item = { id: randomUUID(), instrumentId: instrument.id, name: instrument.name, raw, receivedAt: new Date().toISOString() };
  queue.push(item);
  appendFileSync(queueFile, JSON.stringify(item) + "\n");
  void flush();
}

let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length) {
      const item = queue[0];
      try {
        const { messages } = await api("/messages", { instrumentId: item.instrumentId, raw: item.raw, receivedAt: item.receivedAt });
        for (const m of messages) log(`${item.name}: ${m.sampleId ?? "no sample ID"} → ${m.summary}`);
        if (!messages.length) log(`${item.name}: message without results (query or keep-alive)`);
      } catch (err) {
        // LabOS refused this message for good (e.g. analyzer deleted): set it aside, keep going.
        if (err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 429) {
          log(`${item.name}: LabOS couldn't take a message (${err.message}); saved to interface-failed.jsonl`);
          appendFileSync(failedFile, JSON.stringify({ ...item, error: err.message }) + "\n");
        } else {
          log(`Can't reach LabOS (${err.message}). ${queue.length} message(s) waiting; retrying in 30 s.`);
          break;
        }
      }
      queue.shift();
      saveQueue();
    }
  } finally {
    flushing = false;
  }
}
setInterval(flush, 30_000);

// ---------------------------------------------------------------------------
// Reading the analyzer's bytes: ASTM E1381 frames, HL7 MLLP, or plain text
// ---------------------------------------------------------------------------

const hex2 = (n) => (n & 0xff).toString(16).toUpperCase().padStart(2, "0");

function hl7Ack(text) {
  const msh = text.split(/\r|\n/).find((s) => s.startsWith("MSH")) ?? "";
  const sep = msh[3] ?? "|";
  const controlId = msh.split(sep)[9] ?? "";
  const now = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `MSH|^~\\&|LABOS|LAB|||${now}||ACK|${now}|P|2.3.1\rMSA|AA|${controlId}\r`;
}

/** Handles one connection from (or to) an analyzer. */
function session(instrument, socket) {
  let buf = Buffer.alloc(0);
  let astm = ""; // text collected from ASTM frames until EOT
  let plain = ""; // text sent without any framing
  let idle = null;

  const flushPlain = () => {
    clearTimeout(idle);
    const text = plain.trim();
    plain = "";
    if (text) enqueue(instrument, text);
  };

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (!buf.length) break;
      const b = buf[0];
      if (b === ENQ) {
        // ASTM: the analyzer asks to send; say yes.
        socket.write(Buffer.from([ACK]));
        astm = "";
        buf = buf.subarray(1);
      } else if (b === EOT) {
        if (astm.trim()) enqueue(instrument, astm);
        astm = "";
        buf = buf.subarray(1);
      } else if (b === STX) {
        // ASTM frame: STX FN text ETB|ETX C1 C2 CR LF
        const end = buf.findIndex((x, i) => i > 0 && (x === ETX || x === ETB));
        if (end < 0 || buf.length < end + 5) break; // wait for the rest
        const body = buf.subarray(1, end + 1); // FN .. ETB/ETX
        let sum = 0;
        for (const x of body) sum += x;
        const given = buf.subarray(end + 1, end + 3).toString("latin1").toUpperCase();
        let next = end + 3;
        while (next < buf.length && (buf[next] === CR || buf[next] === 0x0a)) next++;
        if (given === hex2(sum)) {
          astm += buf.subarray(2, end).toString("latin1"); // without the frame number
          socket.write(Buffer.from([ACK]));
        } else {
          socket.write(Buffer.from([NAK]));
        }
        buf = buf.subarray(next);
      } else if (b === VT) {
        // HL7 MLLP: VT message FS CR
        const end = buf.indexOf(FS);
        if (end < 0) break;
        const text = buf.subarray(1, end).toString("latin1");
        let next = end + 1;
        if (buf[next] === CR) next++;
        buf = buf.subarray(next);
        enqueue(instrument, text);
        socket.write(Buffer.concat([Buffer.from([VT]), Buffer.from(hl7Ack(text), "latin1"), Buffer.from([FS, CR])]));
      } else {
        // Plain text (some analyzers skip the framing): collect until an ASTM "L|" record or a quiet second.
        const stop = buf.findIndex((x) => x === ENQ || x === STX || x === VT || x === EOT);
        const part = buf.subarray(0, stop < 0 ? buf.length : stop).toString("latin1");
        buf = stop < 0 ? Buffer.alloc(0) : buf.subarray(stop);
        if (b === ACK || b === NAK || b === 0x0a || b === CR) {
          if (!plain) continue;
        }
        plain += part;
        clearTimeout(idle);
        if (/(^|[\r\n])\d?L\|[^\r\n]*[\r\n]/.test(plain)) flushPlain();
        else idle = setTimeout(flushPlain, 1500);
      }
    }
  });
  socket.on("error", (err) => log(`${instrument.name}: ${err.message}`));
  socket.on("close", () => {
    flushPlain();
    if (astm.trim()) enqueue(instrument, astm);
  });
}

// ---------------------------------------------------------------------------
// Listening for, or connecting to, each analyzer set up in LabOS
// ---------------------------------------------------------------------------

const running = new Map(); // instrument id -> { key, stop(), connected: () => boolean }

function startListen(instrument) {
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    log(`${instrument.name}: connected from ${socket.remoteAddress}`);
    socket.on("close", () => {
      sockets.delete(socket);
      log(`${instrument.name}: disconnected`);
    });
    session(instrument, socket);
  });
  server.on("error", (err) => log(`${instrument.name}: can't listen on port ${instrument.port} (${err.code ?? err.message}). Is another program using it?`));
  server.listen(instrument.port, "0.0.0.0", () => log(`${instrument.name}: waiting on port ${instrument.port} (${instrument.protocol})`));
  return {
    stop: () => {
      for (const s of sockets) s.destroy();
      server.close();
    },
    connected: () => sockets.size > 0,
  };
}

function startConnect(instrument) {
  let socket = null;
  let stopped = false;
  let timer = null;
  const open = () => {
    if (stopped) return;
    socket = connect({ host: instrument.host, port: instrument.port });
    socket.on("connect", () => log(`${instrument.name}: connected to ${instrument.host}:${instrument.port}`));
    socket.on("close", () => {
      if (!stopped) timer = setTimeout(open, 10_000);
    });
    session(instrument, socket);
  };
  open();
  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      socket?.destroy();
    },
    connected: () => !!socket && !socket.destroyed && socket.readyState === "open",
  };
}

async function sync() {
  let config;
  try {
    config = await api("/config");
  } catch (err) {
    log(`Can't load the analyzer list from LabOS (${err.message}); trying again in a minute.`);
    return;
  }
  const wanted = new Map(config.instruments.map((i) => [i.id, i]));
  for (const [id, r] of running) {
    const i = wanted.get(id);
    if (!i || r.key !== JSON.stringify(i)) {
      r.stop();
      running.delete(id);
    }
  }
  for (const [id, i] of wanted) {
    if (running.has(id)) continue;
    const r = i.connection === "CONNECT" ? startConnect(i) : startListen(i);
    running.set(id, { ...r, key: JSON.stringify(i) });
  }
  if (!wanted.size) log("No analyzers set up yet. Add one in LabOS: Settings → Analyzers.");
  return config;
}

async function heartbeat() {
  const connected = [...running].filter(([, r]) => r.connected()).map(([id]) => id);
  try {
    await api("/heartbeat", { connected });
  } catch {}
}

const config = await sync();
if (config) log(`LabOS interface for ${config.lab} is running. Keep this window open.`);
void flush();
setInterval(sync, 60_000);
setInterval(heartbeat, 30_000);
void heartbeat();

const shutdown = () => {
  for (const r of running.values()) r.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
