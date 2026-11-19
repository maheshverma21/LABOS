// Checks for the features added on the other laptop: outsourcing, report doctors,
// bill settings, barcode label PDFs, editing barcodes, and date ranges on lists.
const BASE = process.env.BASE ?? "http://localhost:4000";
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   ", name); }
  else { fail++; console.log("  FAIL ", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ""); }
};
async function call(method, path, { body, token, raw, type } = {}) {
  const headers = { "x-forwarded-for": "10.9.10.1" };
  if (raw) headers["content-type"] = type;
  else if (body) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("json")) return { status: res.status, type: ctype, bytes: Buffer.from(await res.arrayBuffer()) };
  return { status: res.status, type: ctype, json: await res.json() };
}
const login = async (email) => (await call("POST", "/api/auth/login", { body: { email, password: "Demo@12345" } })).json.accessToken;
const ist = (d = 0) => new Date(Date.now() + 5.5 * 3600e3 + d * 86400e3).toISOString().slice(0, 10);
const isPdf = (r) => r.status === 200 && r.type === "application/pdf" && r.bytes.subarray(0, 4).toString() === "%PDF";

const owner = await login("owner@demo-lab.test");
const desk = await login("frontdesk@demo-lab.test");
const tech = await login("tech@demo-lab.test");
const path = await login("pathologist@demo-lab.test");
const T = Object.fromEntries((await call("GET", "/api/catalog/tests", { token: owner })).json.tests.map((t) => [t.code, t]));
const lab = (await call("GET", "/api/lab", { token: owner })).json.lab;
const main = lab.branches.find((b) => b.type === "LAB");
let r;

async function newOrder(testIds) {
  const patient = (await call("POST", "/api/patients", {
    token: desk,
    body: { salutation: "Mr", name: `Imported Check ${Math.random().toString(36).slice(2, 6)}`, sex: "MALE", age: { years: 44 }, phone: "9811177700", consent: true },
  })).json.patient;
  const res = await fetch(BASE + "/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${owner}`, "x-branch-id": main.id, "x-forwarded-for": "10.9.10.1" },
    body: JSON.stringify({ patientId: patient.id, testIds }),
  });
  return (await res.json()).order;
}

console.log("outsourcing");
r = await call("POST", "/api/outsourcing/labs", { token: tech, body: { name: "Metro Reference Lab" } });
check("technician can't add a partner lab -> 403", r.status === 403);
r = await call("POST", "/api/outsourcing/labs", { token: owner, body: { name: "M" } });
check("name too short -> 400", r.status === 400);
r = await call("POST", "/api/outsourcing/labs", { token: owner, body: { name: "Metro Reference Lab", testIds: [T.ESR.id] } });
check("owner adds a partner lab with ESR", r.status === 201 || r.status === 200, r.json);
const partner = r.json.lab;
r = await call("GET", "/api/outsourcing/labs", { token: desk });
check("labs listed with their tests", r.status === 200 && r.json.labs.some((l) => l.id === partner.id && l.tests.some((t) => t.code === "ESR")), r.json);
r = await call("GET", "/api/outsourcing/tests", { token: desk });
check("tests show where they're sent", r.status === 200 && Array.isArray(r.json.tests), r.json);

const o1 = await newOrder([T.ESR.id]);
await call("POST", "/api/samples/receive", { token: tech, body: { barcodes: o1.samples.map((s) => s.barcode) } });
let sheet = (await call("GET", `/api/results/orders/${o1.id}`, { token: tech })).json.sheet;
const esr = sheet.tests[0];
check("the order's ESR is marked as outsourced", esr.outsourceLab === "Metro Reference Lab", esr);

// A real PDF to stand in for the partner lab's report: one LabOS made.
const other = await newOrder([T.CBC.id]);
await call("POST", "/api/samples/receive", { token: tech, body: { barcodes: other.samples.map((s) => s.barcode) } });
const cbcSheet = (await call("GET", `/api/results/orders/${other.id}`, { token: tech })).json.sheet;
const cbc = cbcSheet.tests[0];
await call("PUT", `/api/results/tests/${cbc.orderTestId}`, {
  token: tech,
  body: { values: Object.fromEntries(cbc.parameters.filter((p) => !p.formula).map((p) => [p.parameterId, String(p.range?.low ?? 1)])), submit: true },
});
await call("POST", "/api/results/approve", { token: path, body: { orderTestIds: [cbc.orderTestId] } });
const partnerPdf = (await call("GET", `/api/reports/${other.id}/pdf`, { token: desk })).bytes;
check("got a PDF to upload", partnerPdf.subarray(0, 4).toString() === "%PDF");

r = await call("PUT", `/api/results/tests/${esr.orderTestId}/outsource-file`, { token: desk, raw: partnerPdf, type: "application/pdf" });
check("front desk can't attach results -> 403", r.status === 403);
r = await call("PUT", `/api/results/tests/${esr.orderTestId}/outsource-file`, { token: tech, raw: Buffer.from("not a pdf"), type: "application/pdf" });
check("a fake PDF is refused -> 400", r.status === 400, r.json);
r = await call("PUT", `/api/results/tests/${esr.orderTestId}/outsource-file`, { token: tech, raw: partnerPdf, type: "application/pdf" });
check("technician attaches the partner lab's PDF", r.status === 200 || r.status === 201, r.json);
r = await call("GET", `/api/results/tests/${esr.orderTestId}/outsource-file`, { token: tech });
check("and it comes back as a PDF", isPdf(r), r.status);
r = await call("PATCH", `/api/results/tests/${esr.orderTestId}/outsource-file`, { token: tech, body: { addLetterhead: true } });
check("can ask for the lab's letterhead on it", r.status === 200 || r.status === 204, r.json);
r = await call("PUT", `/api/results/tests/${esr.orderTestId}`, { token: tech, body: { values: {}, submit: true } });
check("submitted with just the file, no values typed", r.status === 200, r.json);
r = await call("POST", "/api/results/approve", { token: path, body: { orderTestIds: [esr.orderTestId] } });
check("and approved", r.status === 200, r.json);
r = await call("GET", `/api/reports/${o1.id}/pdf`, { token: desk });
// The merged file is stored compressed, so compare sizes: it has to hold the whole partner PDF.
check("the report carries the partner lab's PDF after LabOS's own page", isPdf(r) && r.bytes.length > partnerPdf.length, [r.bytes?.length, partnerPdf.length]);
r = await call("GET", `/api/reports/${o1.id}/pdf?outsource=1`, { token: desk });
check("the outsource letterhead needs its header uploaded first -> 400 saying so", r.status === 400 && /outsource report header/i.test(r.json.error.message), r.json);

console.log("report doctors and options");
const doctorBody = {
  name: "Dr. Imported Check",
  degree: "MD (Pathology)",
  signatureId: null,
  hideName: false,
  position: 100,
  nameFontSize: 10,
  degreeFontSize: 8,
  signatureSize: 40,
  spacing: 4,
  nameDegreeSpacing: 2,
  alignment: "CENTER",
  mode: "SELECT",
  endOfReport: true,
  departments: [],
};
r = await call("POST", "/api/lab/report-doctors", { token: desk, body: doctorBody });
check("front desk can't add report doctors -> 403", r.status === 403);
r = await call("POST", "/api/lab/report-doctors", { token: owner, body: { ...doctorBody, position: 150 } });
check("bad position -> 400", r.status === 400);
r = await call("POST", "/api/lab/report-doctors", { token: owner, body: doctorBody });
check("owner adds a signing doctor", r.status === 201 || r.status === 200, r.json);
r = await call("GET", "/api/lab/report-doctors", { token: desk });
const doc = r.json.doctors?.find((d) => d.name === doctorBody.name);
check("listed for everyone", r.status === 200 && doc, r.json);
r = await call("GET", `/api/reports/${other.id}/pdf?separate=1&doctors=${doc.id}`, { token: desk });
check("report with each test on its own page, signed by the chosen doctor", isPdf(r), r.status);
r = await call("PUT", `/api/lab/report-doctors/${doc.id}`, { token: owner, body: { ...doctorBody, mode: "FIXED", hideName: true } });
check("doctor edited", r.status === 200, r.json);
r = await call("DELETE", `/api/lab/report-doctors/${doc.id}`, { token: owner });
check("doctor removed", r.status === 204 || r.status === 200);

console.log("bill settings");
r = await call("GET", "/api/lab/bill-settings", { token: desk });
check("anyone can read bill settings", r.status === 200 && r.json.settings, r.json);
const billBefore = r.json.settings;
r = await call("PUT", "/api/lab/bill-settings", { token: desk, body: { ...billBefore, custom: true } });
check("front desk can't change them -> 403", r.status === 403);
r = await call("PUT", "/api/lab/bill-settings", { token: owner, body: { custom: true, heading: "TAX INVOICE", size: "A3", headerHeightMm: 30, footerHeightMm: 10 } });
check("unknown paper size -> 400", r.status === 400);
r = await call("PUT", "/api/lab/bill-settings", { token: owner, body: { custom: true, heading: "RECEIPT", size: "A5", headerHeightMm: 30, footerHeightMm: 10 } });
check("owner sets A5 receipts", r.status === 200 && r.json.settings.size === "A5" && r.json.settings.heading === "RECEIPT", r.json);
await call("PUT", "/api/lab/bill-settings", { token: owner, body: billBefore });

console.log("barcodes");
r = await call("GET", `/api/samples/labels/${other.id}/pdf`, { token: desk });
check("barcode labels as a PDF", isPdf(r), r.status);
r = await call("GET", `/api/samples/labels/${other.id}/pdf?ids=${other.samples[0].id}`, { token: desk });
check("labels for chosen tubes only", isPdf(r), r.status);
const o3 = await newOrder([T.CBC.id]);
const tube = o3.samples[0];
r = await call("PUT", `/api/samples/${tube.id}/barcode`, { token: desk, body: { barcode: "x" } });
check("too short a barcode -> 400", r.status === 400);
r = await call("PUT", `/api/samples/${tube.id}/barcode`, { token: desk, body: { barcode: `pre-${Date.now() % 100000000}` } });
check("pre-printed barcode accepted, upper-cased", (r.status === 200 || r.status === 204), r.json);
const newCode = `PRE-${Date.now() % 100000000}`;
await call("PUT", `/api/samples/${tube.id}/barcode`, { token: desk, body: { barcode: newCode } });
r = await call("GET", `/api/samples/barcode/${newCode}`, { token: desk });
check("the tube is found by its new barcode", r.status === 200 && r.json.sample.id === tube.id, r.json);
r = await call("PUT", `/api/samples/${other.samples[0].id}/barcode`, { token: desk, body: { barcode: newCode } });
check("the same barcode on two tubes -> refused", r.status === 409 || r.status === 400, r.json);

console.log("date ranges");
const from = ist(-7), to = ist();
r = await call("GET", `/api/orders?date=${from}&dateTo=${to}&pageSize=100`, { token: desk });
check("orders over a week", r.status === 200 && r.json.orders.some((o) => o.id === o1.id), r.json.orders?.length);
r = await call("GET", `/api/reports?date=${from}&dateTo=${to}`, { token: desk });
check("reports over a week", r.status === 200 && r.json.reports.some((x) => x.orderId === o1.id));
r = await call("GET", `/api/billing/collections?date=${from}&dateTo=${to}`, { token: owner });
check("finance totals over a week", r.status === 200, r.json);
r = await call("GET", `/api/results/worklist?tab=approved&date=${from}&dateTo=${to}`, { token: tech });
check("approved results over a week", r.status === 200 && r.json.orders.some((o) => o.orderId === o1.id), r.json.orders?.length);

console.log("other labs");
const otherLab = await call("POST", "/api/auth/signup", {
  body: { labName: "Imported Other Lab", ownerName: "Other Owner", email: "owner@imported-other.test", phone: "9811122277", password: "Other@12345" },
});
const otherOwner = otherLab.json.accessToken;
r = await call("GET", `/api/results/tests/${esr.orderTestId}/outsource-file`, { token: otherOwner });
check("can't read our outsourced report -> 404", r.status === 404);
r = await call("GET", `/api/samples/labels/${other.id}/pdf`, { token: otherOwner });
check("can't print our labels -> 404", r.status === 404);
r = await call("GET", "/api/outsourcing/labs", { token: otherOwner });
check("doesn't see our partner labs", r.status === 200 && !r.json.labs.some((l) => l.id === partner.id));

console.log("cleanup");
r = await call("DELETE", `/api/outsourcing/labs/${partner.id}`, { token: owner });
check("partner lab removed", r.status === 204 || r.status === 200, r.json);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
