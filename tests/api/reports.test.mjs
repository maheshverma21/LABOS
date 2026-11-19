import { createServer } from "node:http";

const BASE = process.env.BASE ?? "http://localhost:4000";
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   ", name); }
  else { fail++; console.log("  FAIL ", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ""); }
};
async function call(method, path, { body, token } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": "10.6.0.1" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/pdf")) return { status: res.status, type, pdf: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, type, json };
}
const login = async (email) => (await call("POST", "/api/auth/login", { body: { email, password: "Demo@12345" } })).json.accessToken;

// A stand-in for AiSensy's campaign API. Numbers ending 0000 are "invalid".
const sent = [];
const mock = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    sent.push(body);
    res.setHeader("content-type", "application/json");
    if (String(body.destination).endsWith("0000")) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, message: "Invalid destination" }));
    } else {
      res.end(JSON.stringify({ success: "true", submitted_message_id: `msg-${sent.length}` }));
    }
  });
});
await new Promise((ok) => mock.listen(Number(process.env.AISENSY_MOCK_PORT ?? 54100), "127.0.0.1", ok));

const owner = await login("owner@demo-lab.test");
const desk = await login("frontdesk@demo-lab.test");
const tech = await login("tech@demo-lab.test");
const path = await login("pathologist@demo-lab.test");
const T = Object.fromEntries((await call("GET", "/api/catalog/tests", { token: owner })).json.tests.map((t) => [t.code, t]));
const patient = (await call("POST", "/api/patients", {
  token: desk,
  body: { salutation: "Mrs", name: "Kavita Deshmukh", sex: "FEMALE", age: { years: 38 }, phone: "9822012345", consent: true },
})).json.patient;

const order = (await call("POST", "/api/orders", { token: desk, body: { patientId: patient.id, testIds: [T.CBC.id, T.ESR.id] } })).json.order;
let r;

console.log("before anything is approved");
r = await call("GET", `/api/reports/${order.id}`, { token: desk });
check("status: 0 of 2 approved", r.status === 200 && r.json.report.approvedTests === 0 && r.json.report.totalTests === 2, r.json);
r = await call("POST", `/api/reports/${order.id}/link`, { token: desk });
check("no link until something is approved -> 400", r.status === 400);

await call("POST", "/api/samples/receive", { token: tech, body: { barcodes: order.samples.map((s) => s.barcode) } });
const sheet = (await call("GET", `/api/results/orders/${order.id}`, { token: tech })).json.sheet;
const cbc = sheet.tests.find((t) => t.code === "CBC");
const values = Object.fromEntries(cbc.parameters.filter((p) => !p.formula).map((p) => [p.parameterId, p.code === "HB" ? "10.1" : String(p.range?.low ?? 1)]));
r = await call("PUT", `/api/results/tests/${cbc.orderTestId}`, { token: tech, body: { values, submit: true } });
check("CBC submitted", r.status === 200, r.json);
r = await call("POST", "/api/results/approve", { token: path, body: { orderTestIds: [cbc.orderTestId] } });
check("CBC approved", r.status === 200);

console.log("signature details");
const users = (await call("GET", "/api/users", { token: owner })).json.users;
const pathologist = users.find((u) => u.email === "pathologist@demo-lab.test");
r = await call("PATCH", `/api/users/${pathologist.id}`, { token: desk, body: { name: "Dr. Pathologist" } });
check("front desk can't edit users -> 403", r.status === 403);
r = await call("PATCH", `/api/users/${pathologist.id}`, {
  token: owner,
  body: { name: "Dr. Pathologist", qualification: "MD (Pathology)", registrationNo: "MMC 2011/04/1234" },
});
check("owner saves qualification and reg no", r.status === 200 && r.json.user.qualification === "MD (Pathology)", r.json);
r = await call("GET", "/api/users", { token: owner });
check("user list shows them", r.json.users.find((u) => u.id === pathologist.id)?.registrationNo === "MMC 2011/04/1234");

console.log("the PDF");
r = await call("GET", `/api/reports/${order.id}`, { token: desk });
check("status: 1 of 2 approved, mobile known", r.json.report.approvedTests === 1 && r.json.report.patientMobile === "9822012345", r.json);
check("WhatsApp not ready until turned on", r.json.report.whatsappReady === false);
r = await call("GET", `/api/reports/${order.id}/pdf`, { token: desk });
check("front desk gets a PDF", r.status === 200 && r.type.includes("application/pdf") && r.pdf.subarray(0, 5).toString() === "%PDF-", r.type);
check("PDF has some size", r.pdf?.length > 3000, r.pdf?.length);
r = await call("GET", `/api/reports/${order.id}/pdf`, { token: tech });
check("technician can't download reports -> 403", r.status === 403);

console.log("patient link");
r = await call("POST", `/api/reports/${order.id}/link`, { token: desk });
check("link created", r.status === 200 && /\/r\/[A-Za-z0-9_-]{32}$/.test(r.json.url), r.json);
const token = r.json.url.split("/r/")[1];
r = await call("POST", `/api/reports/${order.id}/link`, { token: desk });
check("the same link is reused", r.json.url.endsWith(token));
r = await call("GET", `/api/public/reports/${token}/info`);
check("public info without sign-in", r.status === 200 && r.json.report.lab.name && r.json.report.orderNo === order.orderNo, r.json);
check("only the first name is shown", r.json.report.patientName === "Kavita");
check("partial: 1 of 2", r.json.report.approvedTests === 1 && r.json.report.totalTests === 2);
r = await call("GET", `/api/public/reports/${token}/pdf`);
check("public PDF", r.status === 200 && r.pdf?.subarray(0, 5).toString() === "%PDF-");
r = await call("GET", `/api/public/reports/${"x".repeat(32)}/info`);
check("unknown token -> 404", r.status === 404);
r = await call("GET", "/api/public/reports/short/pdf");
check("malformed token -> 404", r.status === 404);

console.log("WhatsApp settings");
r = await call("POST", `/api/reports/${order.id}/send`, { token: desk, body: { channel: "whatsapp" } });
check("send while turned off -> 400", r.status === 400 && /turned on/i.test(r.json.error.message), r.json);
r = await call("PUT", "/api/reports/whatsapp-settings", { token: desk, body: { enabled: true, provider: "shared" } });
check("front desk can't change settings -> 403", r.status === 403);
r = await call("PUT", "/api/reports/whatsapp-settings", { token: owner, body: { enabled: true, provider: "own", campaignName: "lab_report" } });
check("own account without a key -> 400", r.status === 400 && r.json.error.fields?.apiKey, r.json);
r = await call("PUT", "/api/reports/whatsapp-settings", { token: owner, body: { enabled: true, provider: "own" } });
check("own account without a campaign -> 400", r.status === 400 && r.json.error.fields?.campaignName, r.json);
r = await call("PUT", "/api/reports/whatsapp-settings", {
  token: owner,
  body: { enabled: true, provider: "own", apiKey: "lab-secret-key-9876", campaignName: "lab_report" },
});
check("saved; only the key's last 4 come back", r.status === 200 && r.json.settings.apiKeyHint === "9876" && !JSON.stringify(r.json).includes("lab-secret"), r.json);
r = await call("GET", "/api/reports/whatsapp-settings", { token: desk });
check("front desk can see it's set up", r.status === 200 && r.json.settings.enabled && r.json.settings.sharedAvailable === true, r.json);

console.log("sending");
r = await call("POST", `/api/reports/${order.id}/send`, { token: desk, body: { channel: "whatsapp" } });
check("sent", r.status === 200 && r.json.delivery.status === "SENT" && r.json.delivery.to === "9822012345", r.json);
let msg = sent.at(-1);
check("lab's own key and campaign used", msg?.apiKey === "lab-secret-key-9876" && msg.campaignName === "lab_report", msg);
check("destination has the 91 prefix", msg?.destination === "919822012345");
check("template params: patient name, lab name", msg?.templateParams?.length === 2 && msg.templateParams[0] === "Kavita Deshmukh", msg?.templateParams);
check("media is the public PDF", msg?.media?.url?.endsWith(`/api/public/reports/${token}/pdf`) && msg.media.filename === `Report-${order.orderNo}.pdf`, msg?.media);
const media = await fetch(msg.media.url);
check("media URL serves the PDF", media.status === 200 && (await media.arrayBuffer()).byteLength > 3000);

r = await call("POST", `/api/reports/${order.id}/send`, { token: desk, body: { channel: "whatsapp", to: "12345" } });
check("bad number -> 400", r.status === 400);
r = await call("POST", `/api/reports/${order.id}/send`, { token: desk, body: { channel: "whatsapp", to: "+91 98200 00000" } });
check("provider refusal -> 502 with its message", r.status === 502 && r.json.error.message.includes("Invalid destination"), r.json);

r = await call("PUT", "/api/reports/whatsapp-settings", { token: owner, body: { enabled: true, provider: "own", apiKey: "", campaignName: "lab_report_v2" } });
check("blank key keeps the saved one", r.status === 200 && r.json.settings.apiKeyHint === "9876");
r = await call("PUT", "/api/reports/whatsapp-settings", { token: owner, body: { enabled: true, provider: "shared" } });
r = await call("POST", `/api/reports/${order.id}/send`, { token: path, body: { channel: "whatsapp", to: "9822099999" } });
msg = sent.at(-1);
check("shared account uses the platform key", r.status === 200 && msg.apiKey === "platform-key" && msg.campaignName === "shared_lab_report", msg);

r = await call("GET", `/api/reports/${order.id}`, { token: desk });
const d = r.json.report.deliveries;
check("history: 3 attempts, newest first, one failed", d.length === 3 && d[0].to === "9822099999" && d[1].status === "FAILED" && d[1].error, d);
check("who sent it", d[0].sentBy === "Dr. Pathologist" && d[2].sentBy === "Front Desk", d.map((x) => x.sentBy));

console.log("amended reports");
r = await call("POST", `/api/results/tests/${cbc.orderTestId}/reopen`, { token: path, body: { reason: "Hb re-run" } });
check("reopened", r.status === 200);
r = await call("GET", `/api/public/reports/${token}/info`);
check("reopened test drops off the report", r.json.report.approvedTests === 0);
r = await call("GET", `/api/public/reports/${token}/pdf`);
check("nothing approved -> public PDF 404", r.status === 404);
r = await call("PUT", `/api/results/tests/${cbc.orderTestId}`, { token: tech, body: { values: {}, submit: true } });
r = await call("POST", "/api/results/approve", { token: path, body: { orderTestIds: [cbc.orderTestId] } });
r = await call("GET", `/api/reports/${order.id}`, { token: desk });
check("re-approved report is marked amended", r.json.report.amended === true && r.json.report.approvedTests === 1, r.json.report);

console.log("report list");
r = await call("GET", "/api/reports", { token: desk });
const row = r.json.reports?.find((x) => x.orderId === order.id);
check("today's list has the order", r.status === 200 && row?.approvedTests === 1 && row.totalTests === 2, r.json);
check("with its last delivery", row?.lastDelivery?.status === "SENT" && row.lastDelivery.to === "9822099999", row?.lastDelivery);
r = await call("GET", `/api/reports?q=${encodeURIComponent("kavita")}`, { token: desk });
check("search by name", r.json.reports.length >= 1 && r.json.reports.every((x) => x.patient.name.toLowerCase().includes("kavita")));
r = await call("GET", "/api/reports?date=2020-01-01", { token: desk });
check("other days are empty", r.json.reports.length === 0);
r = await call("GET", "/api/reports", { token: tech });
check("technician can't list reports -> 403", r.status === 403);

console.log("cancelled orders");
const other = (await call("POST", "/api/orders", { token: desk, body: { patientId: patient.id, testIds: [T.ESR.id] } })).json.order;
await call("POST", `/api/orders/${other.id}/cancel`, { token: owner, body: { reason: "Patient left" } });
r = await call("GET", `/api/reports/${other.id}/pdf`, { token: desk });
check("cancelled order has no report -> 400", r.status === 400, r.json);

mock.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
