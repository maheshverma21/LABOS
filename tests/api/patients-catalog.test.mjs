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
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
const login = async (email) => (await call("POST", "/api/auth/login", { body: { email, password: "Demo@12345" } })).json.accessToken;
const owner = await login("owner@demo-lab.test");
const desk = await login("frontdesk@demo-lab.test");
const tech = await login("tech@demo-lab.test");

// Today in India as YYMMDD
const ist = new Date(Date.now() + 330 * 60_000).toISOString().slice(2, 10).replace(/-/g, "");

console.log("patient ID: YYMMDD + the day's running number");
let r = await call("GET", "/api/patients/next-id", { token: desk });
const first = r.json.uhid;
check("preview is today's date + 01 on a fresh day (or later)", r.status === 200 && first?.startsWith(ist) && /^\d{8,}$/.test(first), r.json);
const n0 = Number(first.slice(6));
const a = (await call("POST", "/api/patients", { token: desk, body: { name: "Asha Verma", sex: "FEMALE", age: { years: 30 }, consent: true, allowDuplicate: true } })).json.patient;
check("first patient gets the previewed ID", a?.uhid === first, a?.uhid);
r = await call("GET", "/api/patients/next-id", { token: desk });
check("preview moves on after saving", r.json.uhid === ist + String(n0 + 1).padStart(2, "0"), r.json);
const b = (await call("POST", "/api/patients", { token: desk, body: { name: "Rohit Mehta", sex: "MALE", age: { years: 41 }, consent: true, allowDuplicate: true } })).json.patient;
check("second patient is the next number", b?.uhid === ist + String(n0 + 1).padStart(2, "0"), b?.uhid);
r = await call("GET", `/api/patients?q=${a.uhid}`, { token: desk });
check("search by the new patient ID finds them", r.json.patients?.some((p) => p.id === a.id), r.json);
check("MRN and national ID are gone from the record", !("mrn" in a) && !("nationalId" in a), Object.keys(a));
r = await call("GET", "/api/patients/next-id", { token: tech });
check("next-id needs the patients:read permission (never a 500)", [200, 403].includes(r.status), r.status);

console.log("duplicating a test");
const tests = (await call("GET", "/api/catalog/tests", { token: owner })).json.tests;
const cbc = tests.find((t) => t.code === "CBC");
r = await call("POST", `/api/catalog/tests/${cbc.id}/duplicate`, { token: desk });
check("front desk can't duplicate -> 403", r.status === 403, r.status);
r = await call("POST", `/api/catalog/tests/${cbc.id}/duplicate`, { token: owner });
check("duplicate -> 201", r.status === 201, r.json);
const copy = r.json.test;
check("code CBC-COPY, name (Copy)", copy.code === "CBC-COPY" && copy.name.endsWith("(Copy)"), copy);
const full = (await call("GET", `/api/catalog/tests/${copy.id}`, { token: owner })).json.test;
const orig = (await call("GET", `/api/catalog/tests/${cbc.id}`, { token: owner })).json.test;
check("same parameters and ranges", full.parameters.length === orig.parameters.length && full.parameters.every((p, i) => p.code === orig.parameters[i].code && p.ranges.length === orig.parameters[i].ranges.length), full.parameters.length);
check("copy has its own parameter ids", full.parameters.every((p, i) => p.id !== orig.parameters[i].id));
r = await call("POST", `/api/catalog/tests/${cbc.id}/duplicate`, { token: owner });
check("second copy gets the next free code", r.json.test?.code === "CBC-COPY2", r.json);

console.log("method per parameter and interpretation");
const body = { ...full, method: full.method, interpretation: "Low Hb suggests anaemia.", parameters: full.parameters.map((p, i) => ({ ...p, method: i === 0 ? "Photometry" : "" })) };
delete body.id; delete body.department; delete body.panelTests; delete body.usedInPanels;
body.panelTestIds = [];
r = await call("PUT", `/api/catalog/tests/${copy.id}`, { token: owner, body });
check("saved", r.status === 200, r.json);
const saved = r.json.test;
check("interpretation stored", saved.interpretation === "Low Hb suggests anaemia.", saved.interpretation);
check("method stored on the first parameter only", saved.parameters[0].method === "Photometry" && saved.parameters[1].method === null, saved.parameters.slice(0, 2).map((p) => p.method));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
