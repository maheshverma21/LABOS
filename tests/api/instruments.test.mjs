import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:4000";
const root = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   ", name); }
  else { fail++; console.log("  FAIL ", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ""); }
};
async function call(method, path, { body, token, key } = {}) {
  const headers = { "x-forwarded-for": "10.9.9.1" };
  if (body) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
const login = async (email, password = "Demo@12345") => (await call("POST", "/api/auth/login", { body: { email, password } })).json.accessToken;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT_A = Number(process.env.INTERFACE_TEST_PORT ?? 55180);
const PORT_B = PORT_A + 1;

const owner = await login("owner@demo-lab.test");
const desk = await login("frontdesk@demo-lab.test");
const tech = await login("tech@demo-lab.test");
const T = Object.fromEntries((await call("GET", "/api/catalog/tests", { token: owner })).json.tests.map((t) => [t.code, t]));
const lab = (await call("GET", "/api/lab", { token: owner })).json.lab;
const main = lab.branches.find((b) => b.type === "LAB");
let r;

async function newTube(testIds) {
  const patient = (await call("POST", "/api/patients", {
    token: desk,
    body: { salutation: "Mrs", name: `Analyzer Patient ${Math.random().toString(36).slice(2, 6)}`, sex: "FEMALE", age: { years: 50 }, phone: "9811155500", consent: true },
  })).json.patient;
  const res = await fetch(BASE + "/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${owner}`, "x-branch-id": main.id, "x-forwarded-for": "10.9.9.1" },
    body: JSON.stringify({ patientId: patient.id, testIds }),
  });
  const order = (await res.json()).order;
  await call("POST", "/api/samples/receive", { token: tech, body: { barcodes: order.samples.map((s) => s.barcode) } });
  return order;
}
const sheetOf = async (orderId) => (await call("GET", `/api/results/orders/${orderId}`, { token: tech })).json.sheet;
const param = (sheet, testCode, code) => sheet.tests.find((t) => t.code === testCode)?.parameters.find((p) => p.code === code);

console.log("interface keys");
r = await call("POST", "/api/instruments/keys", { token: tech, body: { name: "Lab PC" } });
check("technician can't make keys -> 403", r.status === 403);
r = await call("POST", "/api/instruments/keys", { token: owner, body: { name: "Lab PC" } });
check("owner makes a key, shown once", r.status === 201 && r.json.key.startsWith("lif_") && r.json.item.prefix === r.json.key.slice(0, 10), r.json);
const key = r.json.key;
r = await call("GET", "/api/instruments/keys", { token: owner });
check("the list never shows the key itself", r.status === 200 && !JSON.stringify(r.json).includes(key), r.json);
r = await call("GET", "/api/interface/config", { key: "lif_wrong" });
check("unknown key -> 401", r.status === 401);
r = await call("GET", "/api/interface/config", { token: owner });
check("a staff sign-in isn't an interface key -> 401", r.status === 401);

console.log("analyzers");
const sysmexBody = { name: "Sysmex XN", model: "Sysmex XN-330", protocol: "ASTM", connection: "LISTEN", port: PORT_A };
r = await call("POST", "/api/instruments", { token: owner, body: sysmexBody });
check("haematology analyzer added", r.status === 201 && r.json.instrument.port === PORT_A, r.json);
const sysmex = r.json.instrument;
r = await call("POST", "/api/instruments", { token: owner, body: { ...sysmexBody, name: "Second" } });
check("same port twice -> 409", r.status === 409, r.json);
r = await call("POST", "/api/instruments", { token: owner, body: { ...sysmexBody, name: "Remote", connection: "CONNECT", port: 6000 } });
check("connecting out needs the analyzer's IP -> 400", r.status === 400 && r.json.error.fields?.host, r.json);
r = await call("POST", "/api/instruments", { token: owner, body: { ...sysmexBody, port: 80 } });
check("ports below 1024 refused -> 400", r.status === 400);
r = await call("POST", "/api/instruments", { token: owner, body: { name: "Mindray BS", model: "Mindray BS-240", protocol: "HL7", connection: "LISTEN", port: PORT_B } });
const mindray = r.json.instrument;
check("biochemistry analyzer added", r.status === 201, r.json);
r = await call("GET", "/api/interface/config", { key });
check("the interface program gets both, with ports", r.status === 200 && r.json.instruments.length >= 2 && r.json.instruments.some((i) => i.port === PORT_B), r.json);

console.log("results by message");
const params = (await call("GET", "/api/instruments/parameters", { token: owner })).json.parameters;
const fbsCode = params.find((p) => p.code === "GLU" && /fasting/i.test(p.name))?.testCode;
check("parameters for linking", params.length > 20 && fbsCode, fbsCode);
const o1 = await newTube([T.CBC.id]);
const bc1 = o1.samples[0].barcode;
const astm = (barcode, values) =>
  [`H|\\^&|||XN-330^00-22|||||||P|1|20261111101500`, `P|1`, `O|1|${barcode}^1^1||^^^CBC|R`, ...values.map(([c, v], i) => `R|${i + 1}|^^^^${c}^1|${v}|unit||N||F`), `L|1|N`].join("\r");
const CBC = [["WBC", "7.8"], ["RBC", "4.6"], ["HGB", "10.4"], ["HCT", "40.1"], ["MCV", "84"], ["MCH", "27.5"], ["MCHC", "32.6"], ["RDW-CV", "13.1"], ["PLT", "245"], ["NEUT%", "58"], ["LYMPH%", "32"], ["MONO%", "6"], ["EO%", "3"], ["BASO%", "1"]];
r = await call("POST", "/api/interface/messages", { key, body: { instrumentId: sysmex.id, raw: astm(bc1, CBC) } });
const first = r.json.messages?.[0];
check("matching codes fill in straight away (RBC, MCV, MCH, MCHC, PLT)", r.status === 201 && first.status === "PARTIAL" && first.detail.filter((d) => d.applied).length === 5, first);
check("the rest say why", first.detail.find((d) => d.code === "HGB")?.reason === "This code isn't linked to a LabOS test yet", first.detail);
let sheet = await sheetOf(o1.id);
check("RBC saved as entered, marked from the analyzer", param(sheet, "CBC", "RBC")?.value === "4.6" && param(sheet, "CBC", "RBC")?.source === "Sysmex XN" && sheet.tests[0].status === "ENTERED", param(sheet, "CBC", "RBC"));

r = await call("GET", `/api/instruments/${sysmex.id}/mappings`, { token: owner });
const hbParam = params.find((p) => p.code === "HB");
check("unlinked codes listed", r.json.unmapped.includes("HGB") && r.json.unmapped.includes("WBC"), r.json.unmapped);
check("with suggestions: HGB -> Haemoglobin, WBC -> TLC", r.json.suggestions.some((s) => s.analyzerCode === "HGB" && s.parameterId === hbParam.id) && r.json.suggestions.length === 9, r.json.suggestions);
r = await call("PUT", `/api/instruments/${sysmex.id}/mappings`, { token: owner, body: { mappings: [...r.json.suggestions.map((s) => ({ ...s, factor: null })), { analyzerCode: "hgb", parameterId: hbParam.id }] } });
check("the same code twice -> 400", r.status === 400, r.json);
const sugg = (await call("GET", `/api/instruments/${sysmex.id}/mappings`, { token: owner })).json.suggestions;
r = await call("PUT", `/api/instruments/${sysmex.id}/mappings`, { token: owner, body: { mappings: sugg.map((s) => ({ ...s, factor: null })) } });
check("suggestions accepted as links", r.status === 200 && r.json.mappings.length === 9 && r.json.unmapped.length === 0, r.json);
r = await call("POST", `/api/instruments/messages/${first.id}/retry`, { token: owner });
check("retried: all 14 values in", r.status === 200 && r.json.message.status === "APPLIED" && r.json.message.detail.length === 14, r.json);
sheet = await sheetOf(o1.id);
check("HGB went to Haemoglobin, flagged low", param(sheet, "CBC", "HB")?.value === "10.4" && param(sheet, "CBC", "HB")?.flag === "LOW", param(sheet, "CBC", "HB"));

console.log("people stay in charge");
const cbc = sheet.tests[0];
const values = Object.fromEntries(cbc.parameters.filter((p) => !p.formula).map((p) => [p.parameterId, p.value]));
values[param(sheet, "CBC", "HB").parameterId] = "11.0";
r = await call("PUT", `/api/results/tests/${cbc.orderTestId}`, { token: tech, body: { values, submit: false } });
sheet = await sheetOf(o1.id);
check("a value changed by hand loses the analyzer mark; others keep it", param(sheet, "CBC", "HB")?.source === null && param(sheet, "CBC", "RBC")?.source === "Sysmex XN", [param(sheet, "CBC", "HB"), param(sheet, "CBC", "RBC")?.source]);
r = await call("PUT", `/api/results/tests/${cbc.orderTestId}`, { token: tech, body: { values, submit: true } });
check("technician submits", r.status === 200, r.json);
r = await call("POST", "/api/interface/messages", { key, body: { instrumentId: sysmex.id, raw: astm(bc1, [["HGB", "9.0"]]) } });
check("a rerun after submitting doesn't change anything", r.json.messages[0].status === "NOT_APPLIED" && /submitted/.test(r.json.messages[0].summary), r.json.messages[0]);
check("value still the typed 11", param(await sheetOf(o1.id), "CBC", "HB")?.value === "11", param(await sheetOf(o1.id), "CBC", "HB"));

console.log("problems are logged, not lost");
r = await call("POST", "/api/interface/messages", { key, body: { instrumentId: sysmex.id, raw: astm("999999999999", CBC) } });
check("unknown barcode", r.json.messages[0].status === "NOT_APPLIED" && /No tube/.test(r.json.messages[0].summary), r.json.messages[0]);
r = await call("POST", "/api/interface/messages", { key, body: { instrumentId: sysmex.id, raw: "hello there" } });
check("unreadable message", r.json.messages[0].status === "ERROR", r.json.messages[0]);
const o2 = await newTube([T.CBC.id]);
r = await call("POST", "/api/interface/messages", { key, body: { instrumentId: sysmex.id, raw: astm("000" + o2.samples[0].barcode, [["PLT", "abc"], ["RBC", "4.1"]]) } });
check("zero-padded barcode still matches; a non-number is refused alone", r.json.messages[0].status === "PARTIAL" && r.json.messages[0].detail.find((d) => d.code === "PLT").reason === "Not a number", r.json.messages[0]);
r = await call("GET", `/api/instruments/${sysmex.id}/messages`, { token: owner });
check("everything is in the log, newest first", r.json.messages.length >= 6 && r.json.messages[0].status === "PARTIAL", r.json.messages?.map((m) => m.status));
r = await call("GET", `/api/instruments/${sysmex.id}/messages?status=ERROR`, { token: owner });
check("log filters by status", r.json.messages.length === 1 && r.json.messages[0].status === "ERROR");

console.log("HL7");
const o3 = await newTube([T[fbsCode].id]);
const hl7 = (barcode, code, value) =>
  [`MSH|^~\\&|BS-240|Mindray|||20261111||ORU^R01|42|P|2.3.1`, `PID|1`, `OBR|1|${barcode}|${barcode}|`, `OBX|1|NM|${code}^${code}||${value}|mg/dL|70-100||||F`].join("\r");
r = await call("POST", "/api/interface/messages", { key, body: { instrumentId: mindray.id, raw: hl7(o3.samples[0].barcode, "GLU", "112") } });
sheet = await sheetOf(o3.id);
check("HL7 glucose filled in and flagged high", r.json.messages[0].status === "APPLIED" && param(sheet, fbsCode, "GLU")?.value === "112" && param(sheet, fbsCode, "GLU")?.flag === "HIGH", [r.json.messages[0], param(sheet, fbsCode, "GLU")]);

console.log("over the network, through the interface program");
const dir = mkdtempSync(join(tmpdir(), "labos-iface-"));
const bridge = spawn(process.execPath, [join(root, "tools/interface/interface.mjs"), "--url", BASE, "--key", key], {
  env: { ...process.env, LABOS_INTERFACE_DIR: dir },
  stdio: ["ignore", "pipe", "pipe"],
});
let out = "";
bridge.stdout.on("data", (d) => (out += d));
bridge.stderr.on("data", (d) => (out += d));
for (let i = 0; i < 50 && !(out.includes(`port ${PORT_A}`) && out.includes(`port ${PORT_B}`)); i++) await sleep(200);
check("interface program listening on both ports", out.includes(`port ${PORT_A}`) && out.includes(`port ${PORT_B}`), out);
const simulate = (args) =>
  new Promise((ok) => {
    const p = spawn(process.execPath, [join(root, "tools/interface/simulate.mjs"), ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let s = "";
    p.stdout.on("data", (d) => (s += d));
    p.stderr.on("data", (d) => (s += d));
    p.on("close", (code) => ok({ code, out: s }));
  });
async function waitFor(orderId, testCode, code) {
  for (let i = 0; i < 40; i++) {
    const p = param(await sheetOf(orderId), testCode, code);
    if (p?.value) return p;
    await sleep(250);
  }
  return null;
}
const o4 = await newTube([T.CBC.id]);
let sim = await simulate(["--port", String(PORT_A), "--barcode", o4.samples[0].barcode]);
check("framed ASTM: every frame acknowledged", sim.code === 0 && /all acknowledged/.test(sim.out), sim.out);
let p = await waitFor(o4.id, "CBC", "TLC");
check("...and WBC arrived in LabOS as TLC", p?.value === "7.8" && p.source === "Sysmex XN", [p, out.slice(-400)]);
const o5 = await newTube([T.CBC.id]);
sim = await simulate(["--port", String(PORT_A), "--barcode", o5.samples[0].barcode, "--protocol", "astm-plain"]);
p = await waitFor(o5.id, "CBC", "HB");
check("plain ASTM without framing works too", sim.code === 0 && p?.value === "10.4", [sim.out, p]);
const o6 = await newTube([T[fbsCode].id]);
sim = await simulate(["--port", String(PORT_B), "--barcode", o6.samples[0].barcode, "--protocol", "hl7", "--values", "GLU=88"]);
check("HL7 over MLLP gets an AA acknowledgement", sim.code === 0 && /MSA\|AA\|SIM/.test(sim.out), sim.out);
p = await waitFor(o6.id, fbsCode, "GLU");
check("...and the glucose is in", p?.value === "88" && p.source === "Mindray BS", p);
await sleep(300);
r = await call("GET", "/api/instruments", { token: owner });
const listed = r.json.instruments.find((i) => i.id === sysmex.id);
check("analyzer shows when it was last heard from, and today's count", listed.lastSeenAt && listed.messagesToday >= 7 && listed.mappingCount === 9, listed);

console.log("other labs");
const other = await call("POST", "/api/auth/signup", {
  body: { labName: "Analyzer Other Lab", ownerName: "Other Owner", email: "owner@analyzer-other.test", phone: "9811122299", password: "Other@12345" },
});
const otherOwner = other.json.accessToken;
r = await call("GET", `/api/instruments/${sysmex.id}/mappings`, { token: otherOwner });
check("can't see our analyzers -> 404", r.status === 404);
const otherKey = (await call("POST", "/api/instruments/keys", { token: otherOwner, body: { name: "Their PC" } })).json.key;
r = await call("POST", "/api/interface/messages", { key: otherKey, body: { instrumentId: sysmex.id, raw: astm(bc1, CBC) } });
check("their key can't send to our analyzer -> 404", r.status === 404, r.json);
r = await call("GET", "/api/interface/config", { key: otherKey });
check("and their config lists none of ours", r.status === 200 && r.json.instruments.length === 0, r.json);

console.log("cleanup");
bridge.kill();
rmSync(dir, { recursive: true, force: true });
const keys = (await call("GET", "/api/instruments/keys", { token: owner })).json.keys;
r = await call("DELETE", `/api/instruments/keys/${keys[0].id}`, { token: owner });
check("key revoked", r.status === 204);
r = await call("GET", "/api/interface/config", { key });
check("revoked key stops working -> 401", r.status === 401);
for (const i of [sysmex, mindray]) await call("DELETE", `/api/instruments/${i.id}`, { token: owner });
r = await call("GET", "/api/instruments", { token: owner });
check("analyzers removed", r.json.instruments.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
