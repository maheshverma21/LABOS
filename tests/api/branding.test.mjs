import { deflateSync } from "node:zlib";

const BASE = process.env.BASE ?? "http://localhost:4000";
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   ", name); }
  else { fail++; console.log("  FAIL ", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ""); }
};
async function call(method, path, { body, token, raw, type } = {}) {
  const headers = { "x-forwarded-for": "10.9.7.1" };
  if (raw) headers["content-type"] = type ?? "image/png";
  else if (body) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("json")) return { status: res.status, type: ctype, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, type: ctype, json };
}
const login = async (email, password = "Demo@12345") => (await call("POST", "/api/auth/login", { body: { email, password } })).json.accessToken;

/** A real PNG: w x h, a dark diagonal stroke on transparency. */
function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4);
    for (let x = 0; x < w; x++) {
      if (Math.abs(x - Math.round((y * w) / h)) < 2) row.writeUInt32BE(0x0b1f4aff, 1 + x * 4);
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
/** Images drawn on the page. A transparent PNG adds a second image object for its mask, so masks are subtracted. */
const imagesIn = (pdf) => {
  const text = pdf.toString("latin1");
  return (text.match(/\/Subtype \/Image/g) ?? []).length - (text.match(/\/SMask \d+ 0 R/g) ?? []).length;
};

const owner = await login("owner@demo-lab.test");
const desk = await login("frontdesk@demo-lab.test");
const tech = await login("tech@demo-lab.test");
const path = await login("pathologist@demo-lab.test");
const T = Object.fromEntries((await call("GET", "/api/catalog/tests", { token: owner })).json.tests.map((t) => [t.code, t]));
let r;

console.log("lab profile");
const lab = (await call("GET", "/api/lab", { token: owner })).json.lab;
const profileBody = {
  name: lab.name,
  gstin: lab.gstin,
  phone: lab.phone,
  email: lab.email,
  tagline: "Accurate diagnostics since 2009",
  address: "12 MG Road, Pune 411001",
  website: "www.demolab.in",
  accreditation: "NABL accredited · MC-1234",
};
r = await call("PUT", "/api/lab", { token: owner, body: { ...profileBody, website: "not a website" } });
check("bad website -> 400", r.status === 400 && r.json.error.fields?.website, r.json);
r = await call("PUT", "/api/lab", { token: owner, body: profileBody });
check("tagline, address, website and accreditation saved", r.status === 200 && r.json.lab.tagline === profileBody.tagline && r.json.lab.accreditation === profileBody.accreditation, r.json);
r = await call("PUT", "/api/lab", { token: desk, body: profileBody });
check("front desk can't change the profile -> 403", r.status === 403);

console.log("logo");
r = await call("PUT", "/api/lab/logo", { token: desk, raw: png(200, 80) });
check("front desk can't upload a logo -> 403", r.status === 403);
r = await call("PUT", "/api/lab/logo", { token: owner, raw: Buffer.from("this is not an image"), type: "image/png" });
check("text pretending to be a PNG -> 400", r.status === 400, r.json);
r = await call("PUT", "/api/lab/logo", { token: owner, raw: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 3, 4, 5, 6, 7, 8]), type: "image/jpeg" });
check("broken JPEG -> 400", r.status === 400, r.json);
r = await call("PUT", "/api/lab/logo", { token: owner, raw: png(8, 8) });
check("tiny image -> 400", r.status === 400 && /too small/.test(r.json.error.message), r.json);
r = await call("PUT", "/api/lab/logo", { token: owner, raw: png(200, 80), type: "image/gif" });
check("unsupported type -> 400", r.status === 400, r.json);
r = await call("PUT", "/api/lab/logo", { token: owner, raw: Buffer.alloc(1100 * 1024, 1) });
check("logo over 1 MB -> 413 with the limit", r.status === 413 && /1024 KB/.test(r.json.error.message), r.json);
r = await call("PUT", "/api/lab/logo", { token: owner, raw: png(240, 96) });
check("logo uploaded", r.status === 200 && r.json.asset.width === 240 && r.json.asset.height === 96, r.json);
const logoId = r.json.asset.id;
r = await call("GET", "/api/lab", { token: desk });
check("everyone sees the logo id", r.json.lab.logoId === logoId);
r = await call("GET", `/api/lab/assets/${logoId}`, { token: desk });
check("logo image served as PNG", r.status === 200 && r.type === "image/png" && r.bytes.subarray(1, 4).toString() === "PNG", r.status);
check("cached as immutable", /immutable/.test(r.headers.get("cache-control") ?? ""));
r = await call("GET", `/api/lab/assets/${logoId}`);
check("not without sign-in -> 401", r.status === 401);
r = await call("PUT", "/api/lab/logo", { token: owner, raw: png(300, 120) });
const logo2 = r.json.asset.id;
r = await call("GET", `/api/lab/assets/${logoId}`, { token: owner });
check("replacing the logo deletes the old image", r.status === 404);

console.log("my profile");
r = await call("GET", "/api/profile", { token: tech });
check("anyone can read their own profile", r.status === 200 && r.json.profile.email === "tech@demo-lab.test" && r.json.profile.signsReports === false, r.json);
r = await call("PUT", "/api/profile", { token: tech, body: { name: "Tech Person", phone: "12345" } });
check("bad mobile -> 400", r.status === 400 && r.json.error.fields?.phone, r.json);
r = await call("PUT", "/api/profile", { token: tech, body: { name: "Tech Person", phone: "9876543210" } });
check("technician updates their own details", r.status === 200 && r.json.profile.name === "Tech Person" && r.json.profile.phone === "9876543210", r.json);
r = await call("GET", "/api/profile", { token: path });
check("pathologist signs reports", r.json.profile.signsReports === true);
r = await call("PUT", "/api/profile/signature", { token: path, raw: png(600, 200) });
check("pathologist uploads a signature", r.status === 200 && r.json.profile.signatureId, r.json);
const sigId = r.json.profile.signatureId;
r = await call("PUT", "/api/profile/signature", { token: path, raw: Buffer.alloc(600 * 1024, 1) });
check("signature over 512 KB -> 413", r.status === 413, r.json);
r = await call("PUT", "/api/profile/stamp", { token: path, raw: png(300, 300) });
check("and a stamp", r.status === 200 && r.json.profile.stampId, r.json);
const stampId = r.json.profile.stampId;
r = await call("PUT", "/api/profile/photo", { token: path, raw: png(300, 300) });
check("unknown kind -> 404", r.status === 404);

console.log("who sees signatures");
r = await call("GET", `/api/lab/assets/${sigId}`, { token: path });
check("the pathologist sees their own", r.status === 200);
r = await call("GET", `/api/lab/assets/${sigId}`, { token: owner });
check("the owner sees it", r.status === 200);
r = await call("GET", `/api/lab/assets/${sigId}`, { token: desk });
check("front desk doesn't -> 404", r.status === 404);
r = await call("GET", "/api/lab/assets/00000000-0000-4000-8000-000000000000", { token: owner });
check("unknown image -> 404", r.status === 404);
r = await call("GET", "/api/lab/assets/not-a-uuid", { token: owner });
check("malformed id -> 404", r.status === 404);

console.log("owners manage signatures");
const users = (await call("GET", "/api/users", { token: owner })).json.users;
const pathologist = users.find((u) => u.email === "pathologist@demo-lab.test");
check("user list shows signature and stamp", pathologist.signatureId === sigId && pathologist.stampId === stampId, pathologist);
r = await call("PUT", `/api/users/${pathologist.id}/signature`, { token: desk, raw: png(600, 200) });
check("front desk can't set someone's signature -> 403", r.status === 403);
r = await call("PUT", `/api/users/${pathologist.id}/signature`, { token: owner, raw: png(500, 180) });
check("owner replaces it", r.status === 200 && r.json.asset.id !== sigId, r.json);
const sig2 = r.json.asset.id;
r = await call("GET", `/api/lab/assets/${sigId}`, { token: owner });
check("old signature deleted", r.status === 404);
r = await call("PUT", `/api/users/${pathologist.id}/access`, { token: owner, body: { roleKeys: ["pathologist"], branchId: null } });
check("existing /access route still works alongside", r.status === 204, r.status);

console.log("templates");
r = await call("GET", "/api/lab/templates", { token: desk });
check("starts with one default template, made from the profile", r.status === 200 && r.json.templates.length === 1 && r.json.templates[0].isDefault && r.json.templates[0].style === "BUILT_IN", r.json);
const standard = r.json.templates[0];
const base = { name: "Pre-printed paper", style: "PREPRINTED", headerHeightMm: 45, footerHeightMm: 25, accentColor: "#0F766E", showLogo: true, showSignatures: true, showQr: true, footerNote: null };
r = await call("POST", "/api/lab/templates", { token: desk, body: base });
check("front desk can't make templates -> 403", r.status === 403);
r = await call("POST", "/api/lab/templates", { token: owner, body: { ...base, accentColor: "teal" } });
check("bad colour -> 400", r.status === 400 && r.json.error.fields?.accentColor, r.json);
r = await call("POST", "/api/lab/templates", { token: owner, body: { ...base, headerHeightMm: 200 } });
check("header taller than 80 mm -> 400", r.status === 400 && r.json.error.fields?.headerHeightMm, r.json);
r = await call("POST", "/api/lab/templates", { token: owner, body: base });
check("pre-printed template created, not default", r.status === 201 && r.json.template.isDefault === false, r.json);
const preprinted = r.json.template;
r = await call("POST", "/api/lab/templates", { token: owner, body: { ...base, name: "Letterhead images", style: "IMAGE" } });
check("image template needs a header image -> 400", r.status === 400 && r.json.error.fields?.headerImageId, r.json);
r = await call("POST", "/api/lab/assets?kind=LOGO", { token: owner, raw: png(2480, 400) });
check("only HEADER or FOOTER through /assets -> 400", r.status === 400);
r = await call("POST", "/api/lab/assets?kind=HEADER", { token: owner, raw: png(2480, 400) });
check("header image uploaded", r.status === 201 && r.json.asset.kind === "HEADER", r.json);
const headerId = r.json.asset.id;
r = await call("POST", "/api/lab/assets?kind=FOOTER", { token: owner, raw: png(2480, 200) });
const footerId = r.json.asset.id;
r = await call("POST", "/api/lab/templates", { token: owner, body: { ...base, name: "Letterhead images", style: "IMAGE", headerImageId: footerId } });
check("a footer image can't be the header -> 400", r.status === 400, r.json);
r = await call("POST", "/api/lab/templates", { token: owner, body: { ...base, name: "Letterhead images", style: "IMAGE", headerImageId: logo2 } });
check("nor can the logo", r.status === 400, r.json);
r = await call("POST", "/api/lab/templates", { token: owner, body: { ...base, name: "Letterhead images", style: "IMAGE", headerImageId: headerId, footerImageId: footerId } });
check("image template created", r.status === 201, r.json);
const imageT = r.json.template;

console.log("preview");
r = await call("POST", "/api/lab/templates/preview", { token: owner, body: { ...base, style: "BUILT_IN", showLogo: true } });
check("preview is a PDF", r.status === 200 && r.type === "application/pdf" && r.bytes.subarray(0, 4).toString() === "%PDF", r.status);
const previewImages = imagesIn(r.bytes);
r = await call("POST", "/api/lab/templates/preview", { token: path, body: { ...base, style: "BUILT_IN" } });
check("pathologist can't preview (settings only) -> 403", r.status === 403);
r = await call("POST", "/api/lab/templates/preview", { token: owner, body: { ...base, style: "IMAGE", headerImageId: headerId, footerImageId: footerId, showQr: false } });
check("image preview has the header and footer", r.status === 200 && imagesIn(r.bytes) >= 2, imagesIn(r.bytes ?? Buffer.alloc(0)));
check("built-in preview had the logo and QR", previewImages >= 2, previewImages);

console.log("reports use them");
const patient = (await call("POST", "/api/patients", {
  token: desk,
  body: { salutation: "Mr", name: "Anil Kulkarni", sex: "MALE", age: { years: 52 }, phone: "9822077788", consent: true },
})).json.patient;
const order = (await call("POST", "/api/orders", { token: desk, body: { patientId: patient.id, testIds: [T.ESR.id] } })).json.order;
await call("POST", "/api/samples/receive", { token: tech, body: { barcodes: order.samples.map((s) => s.barcode) } });
const sheet = (await call("GET", `/api/results/orders/${order.id}`, { token: tech })).json.sheet;
const esr = sheet.tests[0];
await call("PUT", `/api/results/tests/${esr.orderTestId}`, { token: tech, body: { values: Object.fromEntries(esr.parameters.map((p) => [p.parameterId, "12"])), submit: true } });
r = await call("POST", "/api/results/approve", { token: path, body: { orderTestIds: [esr.orderTestId] } });
check("approved by the pathologist", r.status === 200, r.json);

r = await call("GET", `/api/reports/${order.id}/pdf`, { token: desk });
const withSig = imagesIn(r.bytes);
check("default report: logo, signature, stamp and QR", r.status === 200 && withSig >= 4, withSig);
r = await call("PUT", `/api/lab/templates/${standard.id}`, { token: owner, body: { ...standard, showSignatures: false } });
check("turn signatures off", r.status === 200 && r.json.template.showSignatures === false, r.json);
r = await call("GET", `/api/reports/${order.id}/pdf`, { token: desk });
check("then they're left out", imagesIn(r.bytes) === withSig - 2, imagesIn(r.bytes));
r = await call("GET", `/api/reports/${order.id}/pdf?template=${imageT.id}`, { token: desk });
check("staff can print with another letterhead", r.status === 200 && imagesIn(r.bytes) >= 4, imagesIn(r.bytes));
r = await call("GET", `/api/reports/${order.id}/pdf?template=00000000-0000-4000-8000-000000000000`, { token: desk });
check("unknown template -> 404", r.status === 404);
r = await call("GET", `/api/reports/${order.id}/pdf?template=nope`, { token: desk });
check("malformed template -> 400", r.status === 400);

r = await call("POST", `/api/lab/templates/${preprinted.id}/default`, { token: owner });
check("pre-printed becomes the default", r.status === 204);
r = await call("GET", "/api/lab/templates", { token: owner });
check("only one default", r.json.templates.filter((t) => t.isDefault).length === 1 && r.json.templates[0].id === preprinted.id, r.json);
r = await call("GET", `/api/reports/${order.id}/pdf`, { token: desk });
const paper = r.bytes;
check("staff print on pre-printed paper: no logo", imagesIn(paper) === withSig - 1, imagesIn(paper));
r = await call("POST", `/api/reports/${order.id}/link`, { token: desk });
const token = r.json.url.split("/r/")[1];
r = await call("GET", `/api/public/reports/${token}/pdf`);
check("patients' copy draws the letterhead instead (logo is back)", r.status === 200 && imagesIn(r.bytes) === withSig, imagesIn(r.bytes));

console.log("deleting");
r = await call("DELETE", `/api/lab/templates/${preprinted.id}`, { token: owner });
check("the default can't be deleted -> 409", r.status === 409);
await call("POST", `/api/lab/templates/${standard.id}/default`, { token: owner });
r = await call("DELETE", `/api/lab/templates/${imageT.id}`, { token: desk });
check("front desk can't delete -> 403", r.status === 403);
r = await call("DELETE", `/api/lab/templates/${imageT.id}`, { token: owner });
check("image template deleted", r.status === 204);
r = await call("GET", `/api/lab/assets/${headerId}`, { token: owner });
check("its images went with it", r.status === 404);
r = await call("DELETE", `/api/lab/templates/${preprinted.id}`, { token: owner });
check("pre-printed deleted", r.status === 204);

console.log("other labs");
const other = await call("POST", "/api/auth/signup", {
  body: { labName: "Branding Other Lab", ownerName: "Other Owner", email: "owner@branding-other.test", phone: "9811122233", password: "Other@12345" },
});
const otherOwner = other.json.accessToken;
check("second lab signed up", !!otherOwner, other.json);
r = await call("GET", `/api/lab/assets/${logo2}`, { token: otherOwner });
check("can't see our logo -> 404", r.status === 404);
r = await call("GET", `/api/lab/assets/${sig2}`, { token: otherOwner });
check("nor our pathologist's signature", r.status === 404);
r = await call("PUT", `/api/users/${pathologist.id}/signature`, { token: otherOwner, raw: png(400, 120) });
check("nor replace it", r.status === 404);
r = await call("PUT", `/api/lab/templates/${standard.id}`, { token: otherOwner, body: base });
check("nor edit our template", r.status === 404);
r = await call("POST", "/api/lab/assets?kind=HEADER", { token: otherOwner, raw: png(2480, 400) });
r = await call("PUT", `/api/lab/templates/${standard.id}`, { token: owner, body: { ...standard, style: "IMAGE", headerImageId: r.json.asset.id } });
check("we can't use their header image -> 400", r.status === 400);

console.log("cleanup");
r = await call("PUT", `/api/lab/templates/${standard.id}`, { token: owner, body: { ...standard, showSignatures: true } });
check("standard template restored", r.status === 200);
r = await call("DELETE", "/api/lab/logo", { token: owner });
check("logo removed", r.status === 204 && (await call("GET", "/api/lab", { token: owner })).json.lab.logoId === null);
r = await call("DELETE", `/api/users/${pathologist.id}/signature`, { token: owner });
r = await call("PUT", "/api/profile", { token: tech, body: { name: "Lab Technician", phone: null } });
r = await call("DELETE", "/api/profile/stamp", { token: path });
check("signature and stamp removed", r.status === 200 && r.json.profile.signatureId === null && r.json.profile.stampId === null, r.json);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
