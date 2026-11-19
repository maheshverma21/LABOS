import { writeFileSync } from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:4000";
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   ", name); }
  else { fail++; console.log("  FAIL ", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ""); }
};
let ip = 1;
async function call(method, path, { body, token } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": `10.9.0.${ip}` };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/pdf")) return { status: res.status, pdf: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
const login = async (email) => (await call("POST", "/api/auth/login", { body: { email, password: "Demo@12345" } })).json.accessToken;
const owner = await login("owner@demo-lab.test");
const desk = await login("frontdesk@demo-lab.test");
const tech = await login("tech@demo-lab.test");
const path = await login("pathologist@demo-lab.test");
const tests = (await call("GET", "/api/catalog/tests", { token: owner })).json.tests;
const T = Object.fromEntries(tests.map((t) => [t.code, t]));

console.log("catalog");
check("starter catalog has the urine culture test", T.UCS?.reportKind === "CULTURE", T.UCS);
let r = await call("GET", `/api/catalog/tests/${T.UCS.id}`, { token: owner });
const ucs = r.json.test;
check("detail has antibiotics and a no-growth template", ucs.cultureConfig.antibiotics.length > 10 && ucs.cultureConfig.noGrowthText.includes("No growth"), ucs.cultureConfig);
check("culture test has no parameters", ucs.parameters.length === 0);

const base = {
  code: "TCS", name: "Throat Swab Culture", departmentId: ucs.departmentId, sampleType: "SWAB", tatHours: 48, pricePaise: 30000,
  reportKind: "CULTURE", parameters: [],
};
r = await call("POST", "/api/catalog/tests", { token: owner, body: base });
check("culture test without a setup -> 400", r.status === 400, r.json);
r = await call("POST", "/api/catalog/tests", { token: owner, body: { ...base, cultureConfig: { antibiotics: [], noGrowthText: "No growth." } } });
check("culture test without antibiotics -> 400", r.status === 400, r.json);
r = await call("POST", "/api/catalog/tests", { token: owner, body: { ...base, cultureConfig: { antibiotics: [{ name: "Penicillin G" }, { name: "penicillin g" }], noGrowthText: "No growth." } } });
check("duplicate antibiotic -> 400", r.status === 400, r.json);
r = await call("POST", "/api/catalog/tests", { token: owner, body: { ...base, cultureConfig: { antibiotics: [{ name: "Penicillin G" }, { name: "Vancomycin" }], noGrowthText: "No growth of beta-haemolytic streptococci." } } });
check("culture test created", r.status === 201 || r.status === 200, r.json);
const tcsId = r.json.test.id;
r = await call("GET", `/api/catalog/tests/${tcsId}`, { token: owner });
check("saved with two antibiotics", r.json.test.cultureConfig.antibiotics.length === 2 && r.json.test.reportKind === "CULTURE");

console.log("results");
// Starter tests have no price; set one so the test can be billed.
r = await call("PUT", `/api/catalog/tests/${ucs.id}`, { token: owner, body: { code: ucs.code, name: ucs.name, departmentId: ucs.departmentId, sampleType: ucs.sampleType, tatHours: ucs.tatHours, pricePaise: 25000, reportKind: "CULTURE", cultureConfig: ucs.cultureConfig, parameters: [] } });
check("price set on the culture test", r.status === 200 && r.json.test.pricePaise === 25000 && r.json.test.cultureConfig.antibiotics.length === ucs.cultureConfig.antibiotics.length, r.json);
const patient = (await call("POST", "/api/patients", { token: desk, body: { name: "Ravi Menon", sex: "MALE", age: { years: 38 }, consent: true } })).json.patient.id;
const oRes = await call("POST", "/api/orders", { token: desk, body: { patientId: patient, testIds: [T.UCS.id, T.CBC.id] } });
if (!oRes.json.order) console.log(JSON.stringify(oRes));
const o = oRes.json.order;
await call("POST", "/api/samples/receive", { token: tech, body: { barcodes: o.samples.map((s) => s.barcode) } });
let sheet = (await call("GET", `/api/results/orders/${o.id}`, { token: tech })).json.sheet;
const u = sheet.tests.find((t) => t.code === "UCS");
const cbc = sheet.tests.find((t) => t.code === "CBC");
check("sheet carries the culture setup, no data yet", u.culture?.config.antibiotics.length > 10 && u.culture.data === null && u.parameters.length === 0);
check("standard test has no culture block", cbc.culture === null);
const put = (id, body, token = tech) => call("PUT", `/api/results/tests/${id}`, { token, body: { values: {}, ...body } });

r = await put(u.orderTestId, { submit: true });
check("submit with nothing entered -> 400", r.status === 400, r.json);
r = await put(u.orderTestId, { culture: { outcome: "GROWTH", organisms: [] } });
check("growth without an organism -> 400", r.status === 400, r.json);
r = await put(u.orderTestId, { culture: { outcome: "GROWTH", organisms: [{ name: "Escherichia coli", sensitivities: [{ antibiotic: "Not A Drug", result: "S" }] }] } });
check("antibiotic outside the test's list -> 400", r.status === 400, r.json);
r = await put(cbc.orderTestId, { culture: { outcome: "NO_GROWTH" } });
check("culture sent to a standard test -> 400", r.status === 400, r.json);

const ab = ucs.cultureConfig.antibiotics.map((a) => a.name);
const growth = {
  outcome: "GROWTH",
  microscopy: "Pus cells 20-25 / HPF",
  organisms: [{
    name: "Escherichia coli", colonyCount: "> 10^5 CFU/mL (significant)",
    sensitivities: [
      { antibiotic: ab[0], result: "S", measure: "22" },
      { antibiotic: ab[1], result: "R", measure: "10" },
      { antibiotic: ab[2], result: "I" },
      { antibiotic: ab[3], result: "SDD" },
    ],
  }],
};
r = await put(u.orderTestId, { culture: growth });
check("growth saved -> ENTERED", r.status === 200, r.json);
let uc = r.json.sheet.tests.find((t) => t.code === "UCS");
check("status ENTERED, data round-trips", uc.status === "ENTERED" && uc.culture.data.organisms[0].sensitivities.length === 4 && uc.culture.data.organisms[0].sensitivities[1].result === "R" && uc.culture.data.microscopy === "Pus cells 20-25 / HPF", uc.culture.data);
r = await put(u.orderTestId, { remarks: "Repeat if symptoms persist" });
uc = r.json.sheet.tests.find((t) => t.code === "UCS");
check("saving without culture keeps what was entered", uc.culture.data?.organisms.length === 1);

r = await put(u.orderTestId, { submit: true });
check("submitted", r.status === 200 && r.json.sheet.tests.find((t) => t.code === "UCS").status === "SUBMITTED", r.json);
r = await call("POST", "/api/results/approve", { token: path, body: { orderTestIds: [u.orderTestId] } });
check("approved", r.status === 200, r.json);

r = await call("GET", `/api/reports/${o.id}/pdf`, { token: desk });
check("report PDF renders", r.status === 200 && r.pdf.subarray(0, 5).toString() === "%PDF-" && r.pdf.length > 3000, r.status);
if (process.env.CULTURE_PDF_OUT && r.pdf) writeFileSync(process.env.CULTURE_PDF_OUT + "-growth.pdf", r.pdf);

console.log("no growth");
r = await call("POST", "/api/results/tests/" + u.orderTestId + "/reopen", { token: path, body: { reason: "Recheck" } });
check("reopened", r.status === 200, r.json);
r = await put(u.orderTestId, { culture: { outcome: "NO_GROWTH", noGrowthText: null, organisms: [{ name: "ignored" }] }, submit: true });
uc = r.json.sheet?.tests.find((t) => t.code === "UCS");
check("no growth submitted, template wording filled in, organisms dropped", r.status === 200 && uc.culture.data.outcome === "NO_GROWTH" && uc.culture.data.organisms.length === 0 && uc.culture.data.noGrowthText.includes("No growth"), uc?.culture);
r = await call("POST", "/api/results/approve", { token: path, body: { orderTestIds: [u.orderTestId] } });
check("approved again", r.status === 200);
r = await call("GET", `/api/reports/${o.id}/pdf`, { token: desk });
check("no-growth report PDF renders", r.status === 200 && r.pdf.subarray(0, 5).toString() === "%PDF-");
if (process.env.CULTURE_PDF_OUT && r.pdf) writeFileSync(process.env.CULTURE_PDF_OUT + "-nogrowth.pdf", r.pdf);

console.log("switching a test's type");
r = await call("PUT", `/api/catalog/tests/${tcsId}`, { token: owner, body: { ...base, code: "TCS", reportKind: "STANDARD", cultureConfig: null, parameters: [{ code: "RES", name: "Result", resultType: "TEXT" }] } });
check("culture -> standard", r.status === 200 && r.json.test.reportKind === "STANDARD" && r.json.test.cultureConfig === null && r.json.test.parameters.length === 1, r.json);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
