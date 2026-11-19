const BASE = process.env.BASE ?? "http://localhost:4000";
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   ", name); }
  else { fail++; console.log("  FAIL ", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ""); }
};
let ip = 1;
async function call(method, path, { body, token } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": `10.5.0.${ip}` };
  if (token) headers.authorization = `Bearer ${token}`;
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
const patient = (await call("POST", "/api/patients", { token: desk, body: { name: "Nisha Kapoor", sex: "FEMALE", age: { years: 45 }, consent: true } })).json.patient.id;

async function newOrder(testCodes, receive = true) {
  const o = (await call("POST", "/api/orders", { token: desk, body: { patientId: patient, testIds: testCodes.map((c) => T[c].id) } })).json.order;
  if (receive) await call("POST", "/api/samples/receive", { token: tech, body: { barcodes: o.samples.map((s) => s.barcode) } });
  return o;
}
const sheetOf = async (orderId, token = tech) => (await call("GET", `/api/results/orders/${orderId}`, { token })).json.sheet;
const testIn = (sheet, code) => sheet.tests.find((t) => t.code === code);
const param = (test, code) => test.parameters.find((p) => p.code === code);
const valuesFor = (test, map) => Object.fromEntries(Object.entries(map).map(([code, v]) => [param(test, code).parameterId, v]));

console.log("the entry sheet");
const order = await newOrder(["CBC", "LIPID", "URINE"]);
let sheet = await sheetOf(order.id);
check("3 tests in the lab", sheet.tests.length === 3 && sheet.tests.every((t) => t.status === "IN_LAB"), sheet.tests.map((t) => t.status));
const cbc = testIn(sheet, "CBC"), lipid = testIn(sheet, "LIPID"), urine = testIn(sheet, "URINE");
check("CBC has 14 parameters", cbc.parameters.length === 14);
check("female adult Hb range picked (12-15)", param(cbc, "HB").range?.low === 12 && param(cbc, "HB").range?.high === 15, param(cbc, "HB").range);
check("patient age in days", sheet.patient.ageDays > 16000 && sheet.patient.sex === "FEMALE");
check("sample barcode on each test", cbc.sampleBarcode?.length === 12);

console.log("saving");
const waiting = await newOrder(["ESR"], false);
const waitingSheet = await sheetOf(waiting.id);
let r = await call("PUT", `/api/results/tests/${testIn(waitingSheet, "ESR").orderTestId}`, { token: tech, body: { values: {} } });
check("can't enter before the sample is received -> 409", r.status === 409, r.json);
r = await call("PUT", `/api/results/tests/${cbc.orderTestId}`, { token: desk, body: { values: {} } });
check("front desk can't enter results -> 403", r.status === 403);
r = await call("PUT", `/api/results/tests/${cbc.orderTestId}`, { token: tech, body: { values: valuesFor(cbc, { HB: "abc", PLT: "15" }) } });
check("not a number -> 400 on that field", r.status === 400 && Object.values(r.json.error.fields ?? {}).flat().some((m) => m.includes("Haemoglobin")), r.json);
r = await call("PUT", `/api/results/tests/${cbc.orderTestId}`, { token: tech, body: { values: valuesFor(cbc, { HB: " 11,2 ", PLT: "15" }) } });
check("partial save -> ENTERED", r.status === 200 && testIn(r.json.sheet, "CBC").status === "ENTERED", r.json);
let c = testIn(r.json.sheet, "CBC");
check("comma decimal normalised, low Hb flagged", param(c, "HB").value === "11.2" && param(c, "HB").flag === "LOW", param(c, "HB"));
check("platelets 15 flagged critical low", param(c, "PLT").flag === "CRITICAL_LOW", param(c, "PLT"));
check("entered by recorded", c.enteredBy === "Lab Technician");
r = await call("PUT", `/api/results/tests/${cbc.orderTestId}`, { token: tech, body: { values: valuesFor(cbc, { PLT: "180" }) } });
c = testIn(r.json.sheet, "CBC");
check("saving one value keeps the others", param(c, "HB").value === "11.2" && param(c, "PLT").value === "180" && param(c, "PLT").flag === "NORMAL", [param(c, "HB").value, param(c, "PLT")]);

console.log("formulas");
r = await call("PUT", `/api/results/tests/${lipid.orderTestId}`, { token: tech, body: { values: {}, submit: true } });
check("submitting with every result blank -> 400", r.status === 400 && r.json.error.code === "incomplete", r.json.error);
r = await call("PUT", `/api/results/tests/${lipid.orderTestId}`, { token: tech, body: { values: valuesFor(lipid, { TCHOL: "220", TG: "150", HDL: "45" }), remarks: "Fasting 12 h", submit: true } });
check("lipid submitted", r.status === 200 && testIn(r.json.sheet, "LIPID").status === "SUBMITTED", r.json);
const l = testIn(r.json.sheet, "LIPID");
check("LDL = 220 - 45 - 150/5 = 145", param(l, "LDL").value === "145", param(l, "LDL"));
check("VLDL = 30, ratio 4.9 (1 dp)", param(l, "VLDL").value === "30" && param(l, "TCHDL").value === "4.9", [param(l, "VLDL").value, param(l, "TCHDL").value]);
check("high cholesterol and LDL flagged", param(l, "TCHOL").flag === "HIGH" && param(l, "LDL").flag === "HIGH");
check("remarks saved", l.remarks === "Fasting 12 h");
r = await call("PUT", `/api/results/tests/${lipid.orderTestId}`, { token: tech, body: { values: valuesFor(lipid, { LDL: "999" }), remarks: "Fasting 12 h", submit: true } });
check("calculated values can't be typed over (and editing needs a resubmit)", r.status === 200 && param(testIn(r.json.sheet, "LIPID"), "LDL").value === "145" && testIn(r.json.sheet, "LIPID").status === "SUBMITTED", param(testIn(r.json.sheet, "LIPID"), "LDL"));

console.log("pick-from-list results");
r = await call("PUT", `/api/results/tests/${urine.orderTestId}`, { token: tech, body: { values: valuesFor(urine, { PROT: "5+" }) } });
check("unknown option -> 400", r.status === 400);
r = await call("PUT", `/api/results/tests/${urine.orderTestId}`, { token: tech, body: { values: valuesFor(urine, { COLOUR: "pale yellow", PROT: "2+", PUS: "8-10" }) } });
const u = testIn(r.json.sheet, "URINE");
check("option matched case-insensitively", param(u, "COLOUR").value === "Pale yellow" && param(u, "COLOUR").flag === "NORMAL", param(u, "COLOUR"));
check("abnormal option flagged", param(u, "PROT").flag === "HIGH");

console.log("worklists");
r = await call("GET", "/api/results/worklist?tab=enter", { token: tech });
const mine = r.json.orders.find((o) => o.orderId === order.id);
check("to-enter list: CBC and urine, critical marked", mine?.tests.map((t) => t.code).sort().join() === "CBC,URINE" && mine.tests.find((t) => t.code === "CBC").critical === false, mine);
r = await call("GET", "/api/results/worklist?tab=approve", { token: path });
check("approval list: lipid", r.json.orders.find((o) => o.orderId === order.id)?.tests.map((t) => t.code).join() === "LIPID");
r = await call("GET", "/api/results/worklist?tab=enter&department=Clinical%20Pathology", { token: tech });
check("department filter", r.json.orders.find((o) => o.orderId === order.id)?.tests.map((t) => t.code).join() === "URINE");
r = await call("GET", "/api/results/worklist?tab=nope", { token: tech });
check("bad tab -> 400", r.status === 400);

console.log("approval");
r = await call("POST", "/api/results/approve", { token: tech, body: { orderTestIds: [lipid.orderTestId] } });
check("technician can't approve -> 403", r.status === 403);
r = await call("POST", "/api/results/approve", { token: path, body: { orderTestIds: [cbc.orderTestId] } });
check("can't approve what isn't submitted -> 409", r.status === 409);
r = await call("POST", "/api/results/approve", { token: path, body: { orderTestIds: [lipid.orderTestId] } });
check("pathologist approves lipid", r.status === 200 && r.json.approved === 1);
sheet = await sheetOf(order.id, path);
check("approved by the pathologist", testIn(sheet, "LIPID").status === "APPROVED" && testIn(sheet, "LIPID").approvedBy === "Dr. Pathologist", testIn(sheet, "LIPID"));
r = await call("PUT", `/api/results/tests/${lipid.orderTestId}`, { token: tech, body: { values: valuesFor(lipid, { TCHOL: "190" }) } });
check("approved results are locked -> 409", r.status === 409);

console.log("send back and reopen");
await call("PUT", `/api/results/tests/${urine.orderTestId}`, {
  token: tech,
  body: { values: valuesFor(urine, { APPEAR: "Clear", PH: "6", SG: "1.015", SUGAR: "Nil", KET: "Negative", BIL: "Negative", BLOOD: "Negative", URBC: "0-2", EPI: "Few", CASTS: "Nil", CRYST: "Nil" }), submit: true },
});
r = await call("POST", `/api/results/tests/${urine.orderTestId}/send-back`, { token: path, body: { note: "Recheck protein on a fresh strip" } });
check("sent back with a note", r.status === 200 && testIn(r.json.sheet, "URINE").status === "ENTERED" && testIn(r.json.sheet, "URINE").sendBackNote.includes("protein"), testIn(r.json.sheet, "URINE"));
r = await call("PUT", `/api/results/tests/${urine.orderTestId}`, { token: tech, body: { values: valuesFor(urine, { PROT: "1+" }), submit: true } });
check("resubmitted, note cleared", testIn(r.json.sheet, "URINE").status === "SUBMITTED" && testIn(r.json.sheet, "URINE").sendBackNote === null);
r = await call("POST", `/api/results/tests/${lipid.orderTestId}/reopen`, { token: path, body: { reason: "Wrong HDL, transcription error" } });
check("approved lipid reopened with reason", r.status === 200 && testIn(r.json.sheet, "LIPID").status === "ENTERED" && testIn(r.json.sheet, "LIPID").sendBackNote.startsWith("Reopened:"), testIn(r.json.sheet, "LIPID"));
r = await call("PUT", `/api/results/tests/${lipid.orderTestId}`, { token: tech, body: { values: valuesFor(lipid, { HDL: "50" }), submit: true } });
check("corrected: LDL recalculated to 140", param(testIn(r.json.sheet, "LIPID"), "LDL").value === "140");
await call("POST", "/api/results/approve", { token: path, body: { orderTestIds: [lipid.orderTestId, urine.orderTestId] } });

console.log("previous results and frozen ranges");
const lipidDetail = (await call("GET", `/api/catalog/tests/${T.LIPID.id}`, { token: owner })).json.test;
const edited = {
  code: lipidDetail.code, name: lipidDetail.name, departmentId: lipidDetail.departmentId, sampleType: lipidDetail.sampleType,
  tatHours: lipidDetail.tatHours, pricePaise: lipidDetail.pricePaise, reportNotes: lipidDetail.reportNotes, method: lipidDetail.method, container: lipidDetail.container,
  parameters: lipidDetail.parameters.map((p) => ({ ...p, ranges: p.code === "TCHOL" ? [{ sex: "ANY", ageMinDays: 6570, high: 190 }] : p.ranges.map(({ id, ...x }) => x) })),
};
r = await call("PUT", `/api/catalog/tests/${T.LIPID.id}`, { token: owner, body: edited });
check("catalog range changed to < 190", r.status === 200, r.json);
sheet = await sheetOf(order.id);
check("old order keeps the range it was reported with (< 200)", param(testIn(sheet, "LIPID"), "TCHOL").range?.high === 200, param(testIn(sheet, "LIPID"), "TCHOL").range);
const order2 = await newOrder(["LIPID"]);
const s2 = await sheetOf(order2.id);
check("new order uses the new range (< 190)", param(testIn(s2, "LIPID"), "TCHOL").range?.high === 190);
check("previous result shown (220)", param(testIn(s2, "LIPID"), "TCHOL").previous?.value === "220" && param(testIn(s2, "LIPID"), "TCHOL").previous?.flag === "HIGH", param(testIn(s2, "LIPID"), "TCHOL").previous);

console.log("rejected samples and cancelling");
const order3 = await newOrder(["ESR"]);
let s3 = await sheetOf(order3.id);
await call("PUT", `/api/results/tests/${testIn(s3, "ESR").orderTestId}`, { token: tech, body: { values: valuesFor(testIn(s3, "ESR"), { ESR: "22" }) } });
const sample3 = (await call("GET", `/api/orders/${order3.id}`, { token: desk })).json.order.samples[0];
await call("POST", `/api/samples/${sample3.id}/reject`, { token: tech, body: { reason: "Clotted" } });
s3 = await sheetOf(order3.id);
check("rejecting the tube clears its results", testIn(s3, "ESR").status === "AWAITING_SAMPLE" && param(testIn(s3, "ESR"), "ESR").value === null, testIn(s3, "ESR"));
r = await call("POST", `/api/orders/${order.id}/cancel`, { token: owner, body: { reason: "test", refundMode: "CASH" } });
check("order with approved results can't be cancelled -> 409", r.status === 409);

console.log("isolation");
ip = 9;
const other = (await call("POST", "/api/auth/signup", { body: { labName: "Other Lab", ownerName: "Other Owner", email: `o${Date.now()}@other.test`, phone: "9000000001", password: "Other#Lab2026" } })).json.accessToken;
r = await call("GET", `/api/results/orders/${order.id}`, { token: other });
check("other lab can't open the sheet -> 404", r.status === 404);
r = await call("POST", "/api/results/approve", { token: other, body: { orderTestIds: [cbc.orderTestId] } });
check("other lab can't approve our tests", r.status === 404);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
