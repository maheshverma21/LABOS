import { inflateSync } from "node:zlib";

const BASE = process.env.BASE ?? "http://localhost:4000";
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   ", name); }
  else { fail++; console.log("  FAIL ", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ""); }
};
async function call(method, path, { body, token } = {}) {
  const headers = { "x-forwarded-for": "10.9.8.1" };
  if (body) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("json")) return { status: res.status, type: ctype, bytes: Buffer.from(await res.arrayBuffer()) };
  return { status: res.status, type: ctype, json: await res.json() };
}
const login = async (email) => (await call("POST", "/api/auth/login", { body: { email, password: "Demo@12345" } })).json.accessToken;
const ist = (d = 0) => new Date(Date.now() + 5.5 * 3600e3 + d * 86400e3).toISOString().slice(0, 10);
const today = ist();

const owner = await login("owner@demo-lab.test");
const desk = await login("frontdesk@demo-lab.test");
const tech = await login("tech@demo-lab.test");
const path = await login("pathologist@demo-lab.test");
const T = Object.fromEntries((await call("GET", "/api/catalog/tests", { token: owner })).json.tests.map((t) => [t.code, t]));
const lab = (await call("GET", "/api/lab", { token: owner })).json.lab;
const main = lab.branches.find((b) => b.type === "LAB");
const centre = lab.branches.find((b) => b.type === "COLLECTION_CENTRE");
let r;

// Two doctors, one account, three patients with different orders.
const mkDoctor = async (name) => (await call("POST", "/api/doctors", { token: owner, body: { name, city: "Pune" } })).json.doctor;
const drA = await mkDoctor("Dr. Filter Alpha");
const drB = await mkDoctor("Dr. Filter Beta");
r = await call("POST", "/api/accounts", { token: owner, body: { code: "FLTHOSP", name: "Filter Hospital", type: "HOSPITAL", creditLimitPaise: null, paymentTermsDays: 30, priceListId: null } });
const acct = r.json.account;
check("account for filtering created", r.status === 201, r.json);
const mkPatient = async (name, phone) =>
  (await call("POST", "/api/patients", { token: desk, body: { salutation: "Mr", name, sex: "MALE", age: { years: 40 }, phone, consent: true } })).json.patient;
const p1 = await mkPatient("Filter Patient One", "9811100001");
const p2 = await mkPatient("Filter Patient Two", "9811100002");
const p3 = await mkPatient("Filter Patient Three", "9811100003");
const orderAs = async (token, branchId, body) => {
  const res = await fetch(BASE + "/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-branch-id": branchId, "x-forwarded-for": "10.9.8.1" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
};
r = await orderAs(owner, main.id, { patientId: p1.id, doctorId: drA.id, testIds: [T.CBC.id] });
const o1 = r.json.order;
check("order 1: Dr. Alpha, CBC, main lab", r.status === 201, r.json);
r = await orderAs(owner, centre.id, { patientId: p2.id, doctorId: drB.id, testIds: [T.ESR.id] });
const o2 = r.json.order;
check("order 2: Dr. Beta, ESR, collection centre", r.status === 201, r.json);
r = await orderAs(owner, main.id, { patientId: p3.id, accountId: acct.id, testIds: [T.ESR.id] });
const o3 = r.json.order;
check("order 3: Filter Hospital account, ESR, no doctor", r.status === 201, r.json);
const mine = [o1.id, o2.id, o3.id];
const ids = (list, key = "id") => list.map((x) => x[key]).filter((id) => mine.includes(id)).sort();
const sorted = (...a) => a.map((o) => o.id).sort();

console.log("orders");
const orders = async (qs) => (await call("GET", `/api/orders?date=${today}&pageSize=100&${qs}`, { token: desk })).json.orders;
check("by doctor", JSON.stringify(ids(await orders(`doctorId=${drA.id}`))) === JSON.stringify(sorted(o1)));
check("self-referred (no doctor)", ids(await orders("doctorId=none")).includes(o3.id) && !ids(await orders("doctorId=none")).includes(o1.id));
check("by account", JSON.stringify(ids(await orders(`accountId=${acct.id}`))) === JSON.stringify(sorted(o3)));
check("walk-in (no account)", !ids(await orders("accountId=none")).includes(o3.id) && ids(await orders("accountId=none")).includes(o1.id));
check("by collection centre", JSON.stringify(ids(await orders(`branchId=${centre.id}`))) === JSON.stringify(sorted(o2)));
check("by test", JSON.stringify(ids(await orders(`testId=${T.ESR.id}`))) === JSON.stringify(sorted(o2, o3)));
check("filters combine", JSON.stringify(ids(await orders(`testId=${T.ESR.id}&branchId=${main.id}`))) === JSON.stringify(sorted(o3)));
r = await call("GET", "/api/orders?doctorId=bogus", { token: desk });
check("malformed filter -> 400", r.status === 400, r.json);
r = await call("GET", "/api/orders?testId=none", { token: desk });
check("'none' isn't allowed for tests -> 400", r.status === 400);

console.log("samples, patients");
r = await call("GET", `/api/samples?status=PENDING&doctorId=${drA.id}`, { token: desk });
check("samples by doctor", r.status === 200 && r.json.samples.every((s) => s.order.id === o1.id) && r.json.samples.length >= 1, r.json.samples?.map((s) => s.order.orderNo));
r = await call("GET", `/api/samples?status=PENDING&testId=${T.ESR.id}&branchId=${centre.id}`, { token: desk });
check("samples by test and centre", r.json.samples.length >= 1 && r.json.samples.every((s) => s.order.id === o2.id), r.json.samples?.map((s) => s.order.orderNo));
r = await call("GET", `/api/patients?doctorId=${drB.id}`, { token: desk });
check("patients by doctor", r.status === 200 && r.json.patients.map((p) => p.id).join() === p2.id, r.json.patients?.map((p) => p.name));

console.log("results worklist");
await call("POST", "/api/samples/receive", { token: tech, body: { barcodes: [...o1.samples, ...o2.samples, ...o3.samples].map((s) => s.barcode) } });
r = await call("GET", `/api/results/worklist?tab=enter&testId=${T.ESR.id}`, { token: tech });
const wl = r.json.orders.filter((o) => mine.includes(o.orderId ?? o.id));
check("only the ESR tests, from orders 2 and 3", r.status === 200 && wl.length === 2 && wl.every((o) => o.tests.every((t) => t.code === "ESR")), r.json.orders?.slice(0, 3));
r = await call("GET", `/api/results/worklist?tab=enter&doctorId=${drA.id}`, { token: tech });
check("worklist by doctor", r.json.orders.filter((o) => mine.includes(o.orderId ?? o.id)).length === 1);

console.log("report states");
const enter = async (order) => {
  const sheet = (await call("GET", `/api/results/orders/${order.id}`, { token: tech })).json.sheet;
  for (const t of sheet.tests) {
    const values = Object.fromEntries(t.parameters.filter((p) => !p.formula).map((p) => [p.parameterId, p.code === "HB" ? "10.1" : String(p.range?.low ?? 12)]));
    await call("PUT", `/api/results/tests/${t.orderTestId}`, { token: tech, body: { values, submit: true } });
  }
  return sheet.tests.map((t) => t.orderTestId);
};
const reports = async (qs = "") => (await call("GET", `/api/reports?date=${today}&${qs}`, { token: desk })).json.reports;
let list = await reports();
const row = (id) => list.find((x) => x.orderId === id);
check("pending orders are listed now, not only approved ones", row(o1.id)?.state === "PENDING" && row(o2.id)?.state === "PENDING", list.map((x) => x.state));
check("each row lists its tests", row(o1.id)?.tests?.[0]?.name === T.CBC.name && row(o1.id).tests[0].status, row(o1.id));
check("doctor and account shown", row(o1.id)?.doctor === drA.name && row(o3.id)?.account === acct.name, [row(o1.id)?.doctor, row(o3.id)?.account]);
r = await call("POST", "/api/results/approve", { token: path, body: { orderTestIds: await enter(o2) } });
list = await reports();
check("all approved -> completed", row(o2.id)?.state === "COMPLETED", row(o2.id));
r = await call("POST", `/api/reports/${o1.id}/handed-over`, { token: desk, body: {} });
check("can't hand over before anything is approved -> 400", r.status === 400);
r = await call("POST", `/api/reports/${o2.id}/handed-over`, { token: tech, body: {} });
check("technician can't mark delivery -> 403", r.status === 403);
r = await call("POST", `/api/reports/${o2.id}/handed-over`, { token: desk, body: { to: "Patient's wife" } });
check("handed over", r.status === 201 && r.json.delivery.channel === "COUNTER" && r.json.delivery.to === "Patient's wife", r.json);
list = await reports();
check("-> delivered", row(o2.id)?.state === "DELIVERED" && row(o2.id).lastDelivery.channel === "COUNTER", row(o2.id));
check("filter by state", (await reports("state=delivered")).every((x) => x.state === "DELIVERED") && (await reports("state=delivered")).some((x) => x.orderId === o2.id));
r = await call("GET", "/api/reports?state=lost", { token: desk });
check("unknown state -> 400", r.status === 400);
check("reports by doctor", ids(await reports(`doctorId=${drB.id}`), "orderId").join() === o2.id);
const esrTest = (await call("GET", `/api/results/orders/${o2.id}`, { token: tech })).json.sheet.tests[0];
r = await call("POST", `/api/results/tests/${esrTest.orderTestId}/reopen`, { token: path, body: { reason: "Recheck value" } });
check("reopened", r.status === 200, r.json);
list = await reports();
check("a reopened report is pending again", row(o2.id)?.state === "PENDING", row(o2.id));
await enter(o2);
await call("POST", "/api/results/approve", { token: path, body: { orderTestIds: [esrTest.orderTestId] } });
list = await reports();
check("re-approved after delivery -> completed, not delivered", row(o2.id)?.state === "COMPLETED", row(o2.id));

console.log("printing");
r = await call("GET", `/api/reports/${o2.id}/pdf`, { token: desk });
check("with letterhead", r.status === 200 && r.type === "application/pdf");
const withLh = r.bytes.length;
r = await call("GET", `/api/reports/${o2.id}/pdf?letterhead=0`, { token: desk });
check("without letterhead", r.status === 200 && r.type === "application/pdf");
check("and they differ", r.bytes.length !== withLh, [withLh, r.bytes.length]);

console.log("flag colours");
const tpl = (await call("GET", "/api/lab/templates", { token: owner })).json.templates.find((t) => t.isDefault);
check("defaults: blue low, red high", tpl.lowColor === "#1D4ED8" && tpl.highColor === "#B91C1C", tpl);
r = await call("PUT", `/api/lab/templates/${tpl.id}`, { token: owner, body: { ...tpl, lowColor: "blue" } });
check("bad colour -> 400", r.status === 400 && r.json.error.fields?.lowColor, r.json);
r = await call("PUT", `/api/lab/templates/${tpl.id}`, { token: owner, body: { ...tpl, lowColor: "#0E7490", highColor: "#C2410C" } });
check("colours saved", r.status === 200 && r.json.template.lowColor === "#0E7490" && r.json.template.highColor === "#C2410C", r.json);
r = await call("POST", "/api/results/approve", { token: path, body: { orderTestIds: await enter(o1) } });
r = await call("GET", `/api/reports/${o1.id}/pdf`, { token: desk });
// Text colours are written as RGB fractions: #0E7490 -> 0.054902 0.454902 0.564706.
const raw = r.bytes.toString("latin1");
const text = [...raw.matchAll(/stream\r?\n/g)]
  .map((m) => {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    try {
      return inflateSync(r.bytes.subarray(start, end)).toString("latin1");
    } catch {
      return "";
    }
  })
  .join("\n");
check("low haemoglobin prints in the low colour", /0\.0549\d* 0\.4549\d* 0\.5647\d* (rg|scn|sc)\b/.test(text), [...new Set(text.match(/[\d.]+ [\d.]+ [\d.]+ (rg|scn|sc)\b/g) ?? [])].slice(0, 12));
await call("PUT", `/api/lab/templates/${tpl.id}`, { token: owner, body: tpl });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
