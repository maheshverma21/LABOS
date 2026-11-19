const BASE = process.env.BASE ?? "http://localhost:4000";
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   ", name); }
  else { fail++; console.log("  FAIL ", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ""); }
};
let ip = 1;
async function call(method, path, { body, token, branch } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": `10.4.0.${ip}` };
  if (token) headers.authorization = `Bearer ${token}`;
  if (branch) headers["x-branch-id"] = branch;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
const login = async (email) => (await call("POST", "/api/auth/login", { body: { email, password: "Demo@12345" } })).json.accessToken;

const owner = await login("owner@demo-lab.test");
const desk = await login("frontdesk@demo-lab.test");
const tech = await login("tech@demo-lab.test");
const path = await login("pathologist@demo-lab.test");
const T = Object.fromEntries((await call("GET", "/api/catalog/tests", { token: owner })).json.tests.map((t) => [t.code, t]));
const patient = (await call("POST", "/api/patients", { token: desk, body: { name: "Kavita Shah", sex: "FEMALE", age: { years: 45 }, consent: true } })).json.patient.id;

console.log("an order becomes tubes");
let r = await call("POST", "/api/orders", { token: desk, body: { patientId: patient, testIds: [T.BHC.id, T.ESR.id], payments: [{ mode: "CASH", amountPaise: 211900 }] } });
check("order created", r.status === 201, r.json);
const order = r.json.order;
const digits = order.orderNo.replace("-", "");
check("4 tubes: EDTA, fluoride, serum, urine", order.samples.length === 4, order.samples.map((s) => s.sampleType));
const byType = Object.fromEntries(order.samples.map((s) => [s.sampleType, s]));
check("barcodes are lab number + 01..04", order.samples.map((s) => s.barcode).sort().join() === [1, 2, 3, 4].map((i) => digits + String(i).padStart(2, "0")).join(), order.samples.map((s) => s.barcode));
check("EDTA tube carries CBC and ESR", byType.WB_EDTA?.tests.map((t) => t.code).join() === "CBC,ESR", byType.WB_EDTA?.tests);
check("serum tube carries LIPID, LFT, KFT, TSH", byType.SERUM?.tests.map((t) => t.code).sort().join() === "KFT,LFT,LIPID,TSH", byType.SERUM?.tests);
check("panel expanded: 8 tests in all", order.samples.flatMap((s) => s.tests).length === 8);
check("everything waiting", order.samples.every((s) => s.status === "PENDING" && s.tests.every((t) => t.status === "AWAITING_SAMPLE")));
check("container filled in", byType.PLASMA_FLUORIDE?.container === "Grey top (fluoride)", byType.PLASMA_FLUORIDE);

console.log("collecting");
r = await call("GET", "/api/samples?status=PENDING", { token: desk });
check("to-collect list", r.json.samples.filter((s) => s.order.id === order.id).length === 4, r.json.total);
r = await call("POST", "/api/samples/collect", { token: path, body: { sampleIds: [byType.WB_EDTA.id] } });
check("pathologist can't collect -> 403", r.status === 403);
r = await call("POST", "/api/samples/collect", { token: desk, body: { sampleIds: [byType.WB_EDTA.id, byType.SERUM.id] } });
check("front desk collects 2 tubes", r.status === 200 && r.json.samples.every((s) => s.status === "COLLECTED" && s.collectedBy === "Front Desk"), r.json);
r = await call("POST", "/api/samples/collect", { token: desk, body: { sampleIds: [byType.WB_EDTA.id] } });
check("collecting twice -> 409", r.status === 409);

console.log("receiving at the lab");
r = await call("POST", "/api/samples/receive", { token: tech, body: { barcodes: [byType.WB_EDTA.barcode, byType.URINE.barcode, "999999999999"] } });
check("2 received, unknown barcode reported", r.status === 200 && r.json.received.length === 2 && r.json.problems.length === 1 && r.json.problems[0].message.includes("No sample"), r.json);
const urine = r.json.received.find((s) => s.sampleType === "URINE");
check("urine collected and received in one go", urine?.collectedAt && urine?.receivedBy === "Lab Technician", urine);
check("tests on received tubes are in the lab", r.json.received.every((s) => s.tests.every((t) => t.status === "IN_LAB")));
r = await call("POST", "/api/samples/receive", { token: tech, body: { barcodes: [byType.WB_EDTA.barcode] } });
check("receiving twice reported, not an error", r.status === 200 && r.json.received.length === 0 && r.json.problems[0].message === "Already received", r.json);
r = await call("POST", "/api/samples/receive", { token: tech, body: { barcodes: ["abc"] } });
check("garbage barcode -> 400", r.status === 400);
r = await call("POST", "/api/samples/receive", { token: tech, body: { sampleIds: [byType.SERUM.id] } });
check("receive by id", r.json.received.length === 1);

console.log("rejecting");
r = await call("POST", `/api/samples/${byType.PLASMA_FLUORIDE.id}/reject`, { token: tech, body: { reason: "Haemolysed" } });
check("can't reject a tube never collected -> 400", r.status === 400);
r = await call("POST", `/api/samples/${byType.SERUM.id}/reject`, { token: tech, body: { reason: "Bogus" } });
check("unknown reason -> 400", r.status === 400);
r = await call("POST", `/api/samples/${byType.SERUM.id}/reject`, { token: tech, body: { reason: "Haemolysed", note: "Grossly haemolysed" } });
check("reject serum -> new tube 05", r.status === 200 && r.json.rejected.status === "REJECTED" && r.json.replacement.barcode === digits + "05" && r.json.replacement.status === "PENDING", r.json);
check("tests moved to the new tube, waiting again", r.json.replacement.tests.length === 4 && r.json.replacement.tests.every((t) => t.status === "AWAITING_SAMPLE"), r.json.replacement?.tests);
check("reason recorded", r.json.rejected.rejectReason === "Haemolysed: Grossly haemolysed");
const replacement = r.json.replacement;

console.log("lookups and lists");
r = await call("GET", `/api/samples/barcode/${replacement.barcode}`, { token: path });
check("pathologist can look up a barcode", r.status === 200 && r.json.sample.order.patient.name === "Kavita Shah");
r = await call("GET", "/api/samples?status=RECEIVED", { token: tech });
check("received today: EDTA + urine", r.json.samples.filter((s) => s.order.id === order.id).length === 2, r.json.samples.map((s) => s.barcode));
r = await call("GET", "/api/samples?status=REJECTED", { token: tech });
check("rejected today", r.json.samples.some((s) => s.id === byType.SERUM.id));
r = await call("GET", `/api/samples?status=PENDING&q=${digits}`, { token: tech });
check("search by lab number: fluoride + replacement waiting", r.json.total === 2, r.json.samples.map((s) => s.barcode));
r = await call("GET", "/api/samples?status=WHATEVER", { token: tech });
check("bad status -> 400", r.status === 400);

console.log("order page");
r = await call("GET", `/api/orders/${order.id}`, { token: desk });
check("order shows 5 tubes: 2 to collect, 2 in lab, 1 rejected", r.json.order.samples.length === 5 && r.json.order.samples.map((s) => s.status).sort().join() === "PENDING,PENDING,RECEIVED,RECEIVED,REJECTED", r.json.order.samples.map((s) => `${s.barcode}:${s.status}`));

console.log("cancelling the order");
r = await call("POST", `/api/orders/${order.id}/cancel`, { token: owner, body: { reason: "Patient left", refundMode: "CASH" } });
check("cancel", r.status === 200);
check("tubes cancelled, rejected one stays rejected", r.json.order.samples.every((s) => (s.id === byType.SERUM.id ? s.status === "REJECTED" : s.status === "CANCELLED")), r.json.order.samples.map((s) => s.status));
r = await call("POST", "/api/samples/receive", { token: tech, body: { barcodes: [replacement.barcode] } });
check("can't receive for a cancelled order", r.json.received.length === 0 && r.json.problems[0].message === "The order is cancelled", r.json);
r = await call("GET", "/api/samples?status=PENDING", { token: tech });
check("cancelled order gone from worklists", !r.json.samples.some((s) => s.order.id === order.id));

console.log("isolation");
ip = 9;
const other = (await call("POST", "/api/auth/signup", { body: { labName: "Other Lab", ownerName: "Other Owner", email: `o${Date.now()}@other.test`, phone: "9000000001", password: "Other#Lab2026" } })).json.accessToken;
r = await call("GET", `/api/samples/barcode/${byType.WB_EDTA.barcode}`, { token: other });
check("other lab can't find our barcode -> 404", r.status === 404);
r = await call("POST", "/api/samples/receive", { token: other, body: { barcodes: [byType.FBS?.barcode ?? byType.PLASMA_FLUORIDE.barcode] } });
check("other lab can't receive our tube", r.json.received.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
