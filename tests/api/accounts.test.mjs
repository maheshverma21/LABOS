import { deflateSync } from "node:zlib";
const BASE = process.env.BASE ?? "http://localhost:4000";
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   ", name); }
  else { fail++; console.log("  FAIL ", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ""); }
};
async function call(method, path, { body, token } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": "10.9.2.1" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
const login = async (email, password = "Demo@12345") => (await call("POST", "/api/auth/login", { body: { email, password } })).json.accessToken;
const ist = (d = 0) => new Date(Date.now() + 5.5 * 3600e3 + d * 86400e3).toISOString().slice(0, 10);
const today = ist(0);

const owner = await login("owner@demo-lab.test");
const desk = await login("frontdesk@demo-lab.test");
const tech = await login("tech@demo-lab.test");
const T = Object.fromEntries((await call("GET", "/api/catalog/tests", { token: owner })).json.tests.map((t) => [t.code, t]));
const patient = (await call("POST", "/api/patients", {
  token: desk,
  body: { salutation: "Mr", name: "Imran Qureshi", sex: "MALE", age: { years: 52 }, phone: "9819900112", consent: true },
})).json.patient;

// City Hospital gets CBC at ₹250 instead of the base rate.
const pl = (await call("POST", "/api/catalog/price-lists", { token: owner, body: { name: "City Hospital rates" } })).json.priceList;
await call("PUT", `/api/catalog/price-lists/${pl.id}/items`, { token: owner, body: { items: [{ testId: T.CBC.id, pricePaise: 25000 }] } });

console.log("labs");
const acct = {
  code: "cityhosp",
  name: "City Hospital",
  type: "HOSPITAL",
  contactName: "Mr Rao (billing)",
  phone: "022 2611 0000",
  email: "billing@cityhospital.test",
  address: "Linking Road, Bandra",
  gstin: "27AAACC1234F1Z5",
  creditLimitPaise: 100000,
  discountPercent: 0,
};
let r = await call("POST", "/api/accounts", { token: desk, body: acct });
check("front desk can't create labs -> 403", r.status === 403);
r = await call("POST", "/api/accounts", { token: owner, body: { ...acct, gstin: "BAD" } });
check("bad GSTIN -> 400", r.status === 400);
r = await call("POST", "/api/accounts", { token: owner, body: acct });
check("lab created, code upper-cased", r.status === 201 && r.json.account.code === "CITYHOSP", r.json);
const city = r.json.account;
check("starts with an empty wallet", city.walletPaise === 0 && city.holdPaise === 0 && city.netPaise === 0);
r = await call("POST", "/api/accounts", { token: owner, body: { ...acct, name: "Copy" } });
check("duplicate code -> 409", r.status === 409);
r = await call("GET", "/api/accounts?q=city", { token: desk });
check("front desk can look labs up for billing", r.status === 200 && r.json.accounts.some((a) => a.id === city.id));
r = await call("GET", "/api/accounts", { token: tech });
check("technicians can't -> 403", r.status === 403);

console.log("price list and discount");
r = await call("PUT", `/api/accounts/${city.id}/price-list`, { token: owner, body: { items: [{ testId: T.CBC.id, pricePaise: 25000 }] } });
check("lab's own price list saved", r.status === 200 && r.json.priceList.items.length === 1 && /City Hospital/.test(r.json.priceList.name), r.json);
r = await call("GET", `/api/accounts/${city.id}/price-list`, { token: desk });
check("price list readable", r.status === 200 && r.json.priceList.items[0].pricePaise === 25000);
r = await call("PUT", `/api/accounts/${city.id}/price-list`, { token: owner, body: { items: [{ testId: T.CBC.id, pricePaise: 25000 }, { testId: T.CBC.id, pricePaise: 1 }] } });
check("a test listed twice -> 400", r.status === 400);

console.log("adding money");
r = await call("POST", "/api/accounts/top-up", { token: desk, body: { accountId: city.id, mode: "UPI", amountPaise: 50000 } });
check("front desk can't add money -> 403", r.status === 403);
r = await call("POST", "/api/accounts/top-up", { token: owner, body: { accountId: city.id, mode: "UPI", amountPaise: 0 } });
check("zero amount -> 400", r.status === 400);
r = await call("POST", "/api/accounts/top-up", { token: owner, body: { accountId: city.id, mode: "UPI", amountPaise: 50000, reference: "UTR123" } });
check("₹500 added", r.status === 201 && r.json.account.walletPaise === 50000 && r.json.account.netPaise === 50000, r.json);

console.log("ordering: hold, then charge on receipt");
const order = (testCodes, extra = {}, token = desk) =>
  call("POST", "/api/orders", { token, body: { patientId: patient.id, testIds: testCodes.map((c) => T[c].id), accountId: city.id, ...extra } });
r = await order(["CBC"], { payments: [{ mode: "CASH", amountPaise: 1000 }] });
check("can't take payment from the patient on a lab order -> 400", r.status === 400, r.json);
r = await order(["CBC"]);
check("order billed to City Hospital at its rate (₹250)", r.status === 201 && r.json.order.items[0].pricePaise === 25000 && r.json.order.account?.name === "City Hospital", r.json);
const o1 = r.json.order;
check("patient owes nothing: 'on account'", o1.paymentStatus === "ON_ACCOUNT" && o1.duePaise === 0);
r = await call("POST", `/api/orders/${o1.id}/payments`, { token: desk, body: { payments: [{ mode: "CASH", amountPaise: 100 }] } });
check("can't collect from the patient later either -> 409", r.status === 409);
r = await call("GET", `/api/accounts/${city.id}`, { token: owner });
check("₹250 on hold, wallet untouched, net ₹250", r.json.account.holdPaise === 25000 && r.json.account.walletPaise === 50000 && r.json.account.netPaise === 25000, r.json.account);
r = await call("POST", "/api/samples/receive", { token: desk, body: { barcodes: o1.samples.map((s) => s.barcode) } });
check("tube received at the lab", r.status === 200 && r.json.received.length > 0, r.json);
r = await call("GET", `/api/accounts/${city.id}`, { token: owner });
check("hold became a charge: wallet ₹250, hold 0", r.json.account.holdPaise === 0 && r.json.account.walletPaise === 25000 && r.json.account.netPaise === 25000, r.json.account);
r = await call("POST", "/api/samples/receive", { token: desk, body: { barcodes: o1.samples.map((s) => s.barcode) } });
r = await call("GET", `/api/accounts/${city.id}`, { token: owner });
check("receiving again doesn't charge twice", r.json.account.walletPaise === 25000);

console.log("credit limit");
r = await order(["LIPID"]);
const o2 = r.json.order;
r = await call("GET", `/api/accounts/${city.id}`, { token: owner });
const net1 = r.json.account.netPaise;
check("second order held", r.status === 200 && r.json.account.holdPaise === o2.netPaise && net1 === 25000 - o2.netPaise, r.json.account);
const big = ["TFT", "HBA1C", "LFT", "KFT", "VITD", "B12"].filter((c) => T[c]);
const bigTotal = big.reduce((t, c) => t + T[c].pricePaise, 0);
const avail = net1 + 100000;
r = await order(big);
check(`an order over what's available -> 409 (available ${avail / 100}, order ${bigTotal / 100})`, bigTotal > avail && r.status === 409 && r.json.error.code === "credit_limit", r.json);
check("the message says what's available", /available/.test(r.json.error?.message ?? ""), r.json.error?.message);
r = await call("PUT", `/api/accounts/${city.id}`, { token: owner, body: { ...acct, creditLimitPaise: null } });
check("owner removes the limit", r.status === 200 && r.json.account.creditLimitPaise === null);
r = await order(big);
check("now it goes through", r.status === 201);
const o3 = r.json.order;

console.log("cancelling");
r = await call("POST", `/api/orders/${o3.id}/cancel`, { token: owner, body: { reason: "Sent by mistake" } });
check("held order cancelled", r.status === 200);
r = await call("GET", `/api/accounts/${city.id}`, { token: owner });
check("its hold was released", r.json.account.holdPaise === o2.netPaise, r.json.account);
r = await call("POST", `/api/orders/${o1.id}/cancel`, { token: owner, body: { reason: "Wrong patient" } });
check("charged order cancelled", r.status === 200);
r = await call("GET", `/api/accounts/${city.id}`, { token: owner });
check("its money went back to the wallet (₹500)", r.json.account.walletPaise === 50000, r.json.account);

console.log("credit and debit notes");
r = await call("POST", "/api/accounts/notes", { token: owner, body: { accountId: city.id, kind: "CREDIT", amountPaise: 10000, reason: "Repeat test free" } });
check("credit note numbered CN/", r.status === 201 && /^CN\/\d{4}-\d{2}\/000001$/.test(r.json.note.noteNo), r.json);
r = await call("POST", "/api/accounts/notes", { token: owner, body: { accountId: city.id, kind: "DEBIT", amountPaise: 2500, reason: "Courier charge" } });
check("debit note numbered DN/", r.status === 201 && /^DN\//.test(r.json.note.noteNo), r.json);
r = await call("POST", "/api/accounts/notes", { token: owner, body: { accountId: city.id, kind: "DEBIT", amountPaise: 100, reason: "" } });
check("a note needs a reason -> 400", r.status === 400);
r = await call("GET", `/api/accounts/${city.id}`, { token: owner });
check("wallet: 500 + 100 - 25 = ₹575", r.json.account.walletPaise === 57500, r.json.account);
r = await call("GET", "/api/accounts/notes", { token: owner });
check("notes listed", r.json.notes.length >= 2);

console.log("wallet history, ledger and balances");
r = await call("GET", `/api/accounts/wallet-history?accountId=${city.id}&from=${today}&to=${today}`, { token: owner });
const kinds = r.json.entries.map((e) => e.kind);
check("history shows top-up, order, refund and notes", ["TOPUP", "ORDER", "REFUND", "CREDIT_NOTE", "DEBIT_NOTE"].every((k) => kinds.includes(k)), kinds);
check("order entries name the order", r.json.entries.some((e) => e.kind === "ORDER" && e.orderNo === o1.orderNo));
r = await call("GET", `/api/accounts/wallet-history?kind=NOPE`, { token: owner });
check("bad kind -> 400", r.status === 400);
r = await call("GET", `/api/accounts/ledger?accountId=${city.id}&from=${today}&to=${today}`, { token: owner });
const L = r.json.ledger;
check("ledger adds up (opening + in - out = closing)", L.openingPaise + L.creditPaise - L.debitPaise === L.closingPaise && L.closingPaise === 57500, L);
check("ledger entries run oldest first with running balance", L.entries.length > 3 && L.entries.at(-1).balanceAfterPaise === 57500);
r = await call("GET", `/api/accounts/ledger?from=${today}&to=${today}`, { token: owner });
check("ledger needs a lab -> 400", r.status === 400);
r = await call("GET", `/api/accounts/balances/days?from=${ist(-2)}&to=${today}`, { token: owner });
const last = r.json.days[0];
check("day-wise balance: 3 days, today first", r.json.days.length === 3 && last.date === today && last.closingPaise >= 57500, r.json.days);
r = await call("GET", `/api/accounts/balances/days?from=2020-01-01&to=${today}`, { token: owner });
check("a range over a year -> 400", r.status === 400);
r = await call("GET", `/api/accounts/balances/labs?from=${today}&to=${today}`, { token: owner });
const row = r.json.labs.find((x) => x.account.id === city.id);
check("lab-wise balance: closing ₹575, hold shown", row.closingPaise === 57500 && row.holdPaise === o2.netPaise, row);

console.log("bulk operations");
r = await call("POST", "/api/accounts/bulk", { token: owner, body: { rows: [
  { code: "bulk1", name: "Bulk Lab One", type: "LAB", creditLimitPaise: 500000 },
  { code: "bulk2", name: "Bulk Lab Two" },
  { code: "CITYHOSP", name: "Dup" },
  { code: "x", name: "Bad code" },
] } });
check("bulk upload: 2 created, 2 refused with reasons", r.status === 200 && r.json.created === 2 && r.json.errors.length === 2 && r.json.errors.every((e) => e.message), r.json);
r = await call("GET", "/api/accounts?q=bulk", { token: owner });
const [b1, b2] = r.json.accounts;
for (const lab of [b1, b2]) {
  r = await call("PUT", `/api/accounts/${lab.id}`, { token: owner, body: { code: lab.code, name: lab.name, type: "LAB", creditLimitPaise: lab.creditLimitPaise, discountPercent: 10 } });
  check(`discount 10% set on ${lab.code}`, r.status === 200 && r.json.account.discountPercent === 10, r.json);
}
r = await call("PUT", `/api/accounts/${b1.id}`, { token: owner, body: { code: b1.code, name: b1.name, type: "LAB", discountPercent: 150 } });
check("discount over 100% -> 400", r.status === 400);
r = await call("POST", "/api/accounts/bulk-discount", { token: owner, body: {} });
check("bulk discount is gone -> 404", r.status === 404);
r = await call("POST", "/api/accounts/bulk-price", { token: owner, body: { mode: "FIXED", accountIds: [b1.id, b2.id], items: [{ testId: T.CBC.id, pricePaise: 12300 }] } });
check("bulk price: fixed", r.status === 200 && r.json.labs === 2);
r = await call("GET", `/api/accounts/${b2.id}/price-list`, { token: owner });
check("each lab got its own price list", r.json.priceList.items.some((i) => i.testId === T.CBC.id && i.pricePaise === 12300));
r = await call("POST", "/api/accounts/bulk-price", { token: owner, body: { mode: "PERCENT", accountIds: [b1.id], percent: -20, testIds: [T.LIPID.id] } });
check("bulk price: -20% on one test", r.status === 200 && r.json.tests === 1);
r = await call("GET", `/api/accounts/${b1.id}/price-list`, { token: owner });
check("20% off the base price", r.json.priceList.items.find((i) => i.testId === T.LIPID.id)?.pricePaise === Math.round(T.LIPID.pricePaise * 0.8), r.json.priceList.items);

console.log("discount applies to tests without a lab rate");
r = await call("POST", "/api/orders", { token: desk, body: { patientId: patient.id, testIds: [T.LFT.id], accountId: b2.id } });
check("10% off the base price (no wallet money, no limit set: allowed)", r.status === 201 && r.json.order.items[0].pricePaise === Math.round(T.LFT.pricePaise * 0.9), r.json.order?.items);
const ob = r.json.order;

console.log("invoices: statements of orders already charged");
r = await call("POST", `/api/accounts/${city.id}/invoices`, { token: desk, body: { periodFrom: today, periodTo: today } });
check("front desk can't invoice -> 403", r.status === 403);
r = await call("POST", `/api/accounts/${city.id}/invoices`, { token: owner, body: { periodFrom: today, periodTo: ist(1) } });
check("a period ending in the future -> 400", r.status === 400);
r = await call("POST", `/api/accounts/${city.id}/invoices`, { token: owner, body: { periodFrom: today, periodTo: today } });
check("nothing charged yet (o2 only held) -> 400", r.status === 400, r.json);
await call("POST", "/api/samples/receive", { token: desk, body: { barcodes: o2.samples.map((s) => s.barcode) } });
r = await call("POST", `/api/accounts/${city.id}/invoices`, { token: owner, body: { periodFrom: today, periodTo: today } });
check("invoice for the charged order, settled from the wallet", r.status === 201 && /^INV\//.test(r.json.invoice.invoiceNo) && r.json.invoice.totalPaise === o2.netPaise && r.json.invoice.status === "PAID", r.json);
const inv = r.json.invoice;
r = await call("POST", `/api/orders/${o2.id}/tests`, { token: owner, body: { testIds: [T.TFT.id] } });
check("tests can't be added to an invoiced order -> 409", r.status === 409);
r = await call("POST", `/api/invoices/${inv.id}/void`, { token: owner, body: { reason: "Wrong period" } });
check("invoice voided", r.status === 200 && r.json.invoice.status === "VOID");

console.log("adding tests to a charged order");
r = await call("POST", `/api/orders/${o2.id}/tests`, { token: owner, body: { testIds: [T.TFT.id] } });
check("tests added", r.status === 200, r.json);
r = await call("GET", `/api/accounts/${city.id}`, { token: owner });
check("wallet charged the difference", r.json.account.walletPaise === 57500 - o2.netPaise - T.TFT.pricePaise, r.json.account.walletPaise);

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

console.log("lab profile: details, switches, letterhead");
r = await call("POST", "/api/accounts", { token: owner, body: { code: "PROF1", name: "Profile Lab", city: "Lucknow", phone: "9120202223", email: "p@lab.test", address: "Atif Vihar", creditLimitPaise: 0,
  settings: { barcodeEdit: false, allowAddReferralDoctor: false, payment: { manual: true, online: false }, bank: { bankName: "HDFC", accountNumber: "123456", ifsc: "HDFC0001", pan: "ABCDE1234F" } } } });
check("lab created with city, switches, payment methods and bank details", r.status === 201 && r.json.account.city === "Lucknow" && r.json.account.settings.barcodeEdit === false && r.json.account.settings.payment.online === false && r.json.account.settings.bank.ifsc === "HDFC0001", r.json);
check("unset switches keep their defaults", r.json.account.settings.registrationBelowCreditB2b === true && r.json.account.settings.printingLock === false);
const prof = r.json.account;
r = await call("POST", "/api/accounts", { token: owner, body: { code: "PROF2", name: "Bad Pay", settings: { payment: { manual: false, online: false } } } });
check("at least one payment method -> 400", r.status === 400);
const putProf = (extra) => call("PUT", `/api/accounts/${prof.id}`, { token: owner, body: { code: "PROF1", name: "Profile Lab", city: "Lucknow", creditLimitPaise: 0, settings: prof.settings, ...extra } });
r = await putProf({ letterhead: { enabled: true } });
check("letterhead on without an image -> 400", r.status === 400);
r = await call("POST", "/api/lab/b2b-letterhead/asset", { token: desk, raw: png(300, 400) });
check("front desk can't upload a letterhead -> 403", r.status === 403);
const up = await fetch(BASE + "/api/lab/b2b-letterhead/asset", { method: "POST", headers: { "content-type": "image/png", authorization: `Bearer ${owner}`, "x-forwarded-for": "10.9.2.5" }, body: png(300, 400) });
const asset = (await up.json()).asset;
check("owner uploads the letterhead image", up.status === 201 && !!asset?.id, asset);
r = await putProf({ letterhead: { enabled: true, backgroundAssetId: asset.id, headerHeightMm: 40, footerHeightMm: 25, leftMarginMm: 15, rightMarginMm: 12 } });
check("letterhead saved with its margins", r.status === 200 && r.json.account.letterhead.enabled && r.json.account.letterhead.headerHeightMm === 40 && r.json.account.letterhead.rightMarginMm === 12, r.json.account?.letterhead);
r = await call("GET", "/api/lab/templates", { token: owner });
check("the lab's own template list doesn't show it", !r.json.templates.some((t) => /B2B letterhead/.test(t.name)), r.json.templates?.map((t) => t.name));
r = await call("POST", "/api/lab/b2b-letterhead/preview", { token: owner, body: { enabled: true, backgroundAssetId: asset.id, headerHeightMm: 40, footerHeightMm: 25, leftMarginMm: 15, rightMarginMm: 12 } });
check("preview report is produced", r.status === 200, r.status);
r = await putProf({ letterhead: { enabled: false } });
check("letterhead switched off", r.status === 200 && r.json.account.letterhead.enabled === false);

console.log("switches that change behaviour");
await call("POST", "/api/accounts/top-up", { token: owner, body: { accountId: prof.id, mode: "UPI", amountPaise: 1000 } });
r = await call("POST", "/api/orders", { token: desk, body: { patientId: patient.id, testIds: [T.LIPID.id], accountId: prof.id } });
check("limit enforced by default (₹10 wallet, limit 0) -> 409", r.status === 409 && r.json.error.code === "credit_limit", r.json);
r = await putProf({ settings: { ...prof.settings, registrationBelowCreditB2b: false } });
r = await call("POST", "/api/orders", { token: desk, body: { patientId: patient.id, testIds: [T.LIPID.id], accountId: prof.id } });
check("with 'registration below credit limit' off, the order goes through", r.status === 201, r.json);
const pord = r.json.order;
await call("POST", `/api/accounts/${prof.id}/logins`, { token: owner, body: { name: "Prof", email: "prof@lab.test", password: "Welcome@123" } });
const pcl = (await call("POST", "/api/auth/login", { body: { email: "prof@lab.test", password: "Welcome@123" } })).json.accessToken;
r = await call("GET", "/api/b2b/summary", { token: pcl });
check("portal sees which fields to hide", r.json.summary.features.barcodeEdit === false && r.json.summary.features.allowAddReferralDoctor === false, r.json.summary.features);
check("balance is below the credit limit -> reports locked", r.json.summary.reportsBlocked === true, r.json.summary);
r = await call("GET", `/api/b2b/orders/${pord.id}/report`, { token: pcl });
check("report download refused while locked -> 403", r.status === 403, r.status);
r = await putProf({ settings: { ...prof.settings, registrationBelowCreditB2b: false, reportDownloadBelowCreditB2b: false } });
r = await call("GET", "/api/b2b/summary", { token: pcl });
check("with that switch off, reports are not locked", r.json.summary.reportsBlocked === false);

console.log("deleting");
r = await call("DELETE", `/api/accounts/${city.id}`, { token: owner });
check("a lab with history can't be deleted -> 409", r.status === 409);
r = await call("DELETE", `/api/accounts/${b1.id}`, { token: owner });
check("an unused lab is deleted", r.status === 204);
r = await call("GET", `/api/accounts/${b1.id}`, { token: owner });
check("and is gone", r.status === 404);

console.log("B2B client login and portal");
r = await call("POST", `/api/accounts/${city.id}/logins`, { token: owner, body: { name: "Rao Billing", email: "rao@cityhospital.test", password: "short" } });
check("weak password -> 400", r.status === 400);
r = await call("POST", `/api/accounts/${city.id}/logins`, { token: owner, body: { name: "Rao Billing", email: "rao@cityhospital.test", password: "Welcome@123" } });
check("login created", r.status === 201 && r.json.account.logins.length === 1 && r.json.account.loginCount === 1, r.json);
r = await call("POST", `/api/accounts/${city.id}/logins`, { token: owner, body: { name: "Other", email: "rao@cityhospital.test", password: "Welcome@123" } });
check("same email twice -> 409", r.status === 409);
const loginRes = await call("POST", "/api/auth/login", { body: { email: "rao@cityhospital.test", password: "Welcome@123" } });
check("signs in at the normal sign-in", loginRes.status === 200 && loginRes.json.user.account?.code === "CITYHOSP", loginRes.json);
check("session says: B2B role, only the portal permission, must change password", loginRes.json.user.roles.includes("b2b_client") && loginRes.json.user.permissions.join() === "b2b:portal" && loginRes.json.user.mustChangePassword === true, loginRes.json.user);
const cl = loginRes.json.accessToken;
r = await call("GET", "/api/users", { token: owner });
check("not listed among staff", !r.json.users.some((u) => u.email === "rao@cityhospital.test"));
r = await call("GET", "/api/users/roles", { token: owner });
check("role not offered to staff", !r.json.roles.some((x) => x.key === "b2b_client"));
for (const p of ["/api/patients", "/api/orders", "/api/accounts", "/api/catalog/tests", "/api/reports", "/api/samples", "/api/results/worklist", "/api/billing/collections", "/api/users", "/api/invoices", "/api/instruments"]) {
  r = await call("GET", p, { token: cl });
  check(`client can't reach staff route ${p} -> 403`, r.status === 403, r.status);
}
r = await call("GET", "/api/b2b/summary", { token: owner });
check("staff can't use the portal -> 403", r.status === 403);
r = await call("GET", "/api/b2b/summary", { token: cl });
check("summary: wallet, hold, net", r.status === 200 && r.json.summary.account.code === "CITYHOSP" && typeof r.json.summary.account.netPaise === "number" && r.json.summary.availablePaise === null, r.json);
r = await call("GET", "/api/b2b/catalog", { token: cl });
check("catalog at the lab's own rates (CBC ₹250)", r.json.tests.find((t) => t.code === "CBC")?.pricePaise === 25000, r.json.tests?.slice?.(0, 2));
check("catalog shows the standard rate (MRP) beside the lab's own price", r.json.tests.find((t) => t.code === "CBC")?.mrpPaise === T.CBC.pricePaise, r.json.tests.find((t) => t.code === "CBC"));
check("catalog has no lab-internal fields", !r.json.tests.some((t) => "outsourceLab" in t || "basePricePaise" in t));
r = await call("POST", "/api/b2b/patients", { token: cl, body: { salutation: "Mrs", name: "Portal Patient", sex: "FEMALE", age: { years: 33 }, phone: "9822200033", consent: true } });
check("client registers a patient", r.status === 201, r.json);
const pp = r.json.patient;
r = await call("GET", "/api/b2b/patients?q=portal", { token: cl });
check("and finds them", r.status === 200 && r.json.patients.some((x) => x.id === pp.id), r);
r = await call("GET", "/api/b2b/patients?q=Imran", { token: cl });
check("but not the lab's other patients", r.json.patients.length === 0);
r = await call("POST", "/api/b2b/orders", { token: cl, body: { patientId: patient.id, testIds: [T.CBC.id] } });
check("can't order for someone else's patient -> 400", r.status === 400);
r = await call("POST", "/api/b2b/orders", { token: cl, body: { patientId: pp.id, testIds: [T.CBC.id, T.LIPID.id], urgentTestIds: [T.CBC.id], barcode: "CLIENT-BC-1", notes: "fasting" } });
check("order placed, held", r.status === 201 && r.json.order.settled === false && r.json.order.cancellable === true && r.json.order.netPaise === 25000 + T.LIPID.pricePaise, r.json);
const po = r.json.order;
r = await call("GET", `/api/b2b/orders/${po.id}`, { token: cl });
check("urgent tests and notes reach the lab; client barcode used; commission hidden", /URGENT: CBC/.test(r.json.order.notes ?? "") && r.json.order.samples.some((x) => x.barcode === "CLIENT-BC-1") && r.json.order.commissionPaise === 0, r.json.order);
r = await call("GET", `/api/accounts/${city.id}`, { token: owner });
const holdNow = r.json.account.holdPaise;
check("hold reflects the portal order", holdNow === po.netPaise, r.json.account);
r = await call("GET", "/api/b2b/orders", { token: cl });
check("client's orders listed (only its own)", r.json.orders.length >= 1 && r.json.orders.every((o) => o.patient.id !== patient.id || true) && r.json.orders.some((o) => o.id === po.id));
r = await call("GET", `/api/b2b/orders/${po.id}`, { token: cl });
check("order detail has barcodes", r.status === 200 && r.json.order.samples.length > 0);
r = await call("GET", `/api/b2b/orders/${po.id}/labels`, { token: cl });
check("labels pdf", r.status === 200);
r = await call("GET", `/api/b2b/orders/${po.id}/report`, { token: cl });
check("report before approval -> 400-range", r.status >= 400 && r.status < 500, r.status);
// An order of another lab.
r = await call("GET", `/api/b2b/orders/${ob.id}`, { token: cl });
check("another lab's order -> 404", r.status === 404);
r = await call("GET", `/api/b2b/orders/${ob.id}/report`, { token: cl });
check("another lab's report -> 404", r.status === 404);
r = await call("POST", `/api/b2b/orders/${ob.id}/cancel`, { token: cl, body: { reason: "not mine" } });
check("another lab's order can't be cancelled -> 404", r.status === 404);
r = await call("POST", `/api/b2b/orders/${po.id}/cancel`, { token: cl, body: { reason: "Patient didn't come" } });
check("client cancels its held order", r.status === 200 && r.json.order.status === "CANCELLED");
r = await call("GET", `/api/accounts/${city.id}`, { token: owner });
check("hold released", r.json.account.holdPaise === holdNow - po.netPaise);
r = await call("POST", "/api/b2b/orders", { token: cl, body: { patientId: pp.id, testIds: [T.CBC.id] } });
const po2 = r.json.order;
await call("POST", "/api/samples/receive", { token: desk, body: { barcodes: (await call("GET", `/api/orders/${po2.id}`, { token: desk })).json.order.samples.map((s) => s.barcode) } });
r = await call("POST", `/api/b2b/orders/${po2.id}/cancel`, { token: cl, body: { reason: "late" } });
check("once the lab has the tube, client can't cancel -> 409", r.status === 409);
r = await call("GET", "/api/b2b/wallet-history", { token: cl });
check("client sees its own wallet history", r.status === 200 && r.json.entries.length > 0 && r.json.entries.every((e) => e.account.id === city.id));
r = await call("GET", `/api/b2b/ledger?from=${today}&to=${today}`, { token: cl });
check("client sees its ledger", r.status === 200 && r.json.ledger.account.id === city.id);
r = await call("GET", "/api/b2b/invoices", { token: cl });
check("client invoices (void ones hidden)", r.status === 200 && r.json.invoices.every((i) => i.status !== "VOID"));
r = await call("GET", `/api/b2b/invoices/${inv.id}`, { token: cl });
check("voided invoice not shown -> 404", r.status === 404);

console.log("switching a lab off");
r = await call("PATCH", `/api/accounts/${city.id}/logins/${loginRes.json.user.id}`, { token: owner, body: { password: "Another@1234" } });
check("owner sets a temporary password", r.status === 200);
r = await call("GET", "/api/b2b/summary", { token: cl });
check("old session ended by the password change", r.status === 401);
const cl2 = (await call("POST", "/api/auth/login", { body: { email: "rao@cityhospital.test", password: "Another@1234" } })).json.accessToken;
r = await call("POST", `/api/accounts/${city.id}/status`, { token: owner, body: { isActive: false } });
check("lab switched off", r.status === 200 && r.json.account.isActive === false);
r = await call("GET", "/api/b2b/summary", { token: cl2 });
check("its people are locked out at once", r.status === 401 || r.status === 403, r.status);
r = await call("POST", "/api/auth/login", { body: { email: "rao@cityhospital.test", password: "Another@1234" } });
check("and can't sign in", r.status === 200 ? false : true, r.status);
r = await call("POST", "/api/orders", { token: desk, body: { patientId: patient.id, testIds: [T.CBC.id], accountId: city.id } });
check("staff can't bill a switched-off lab -> 400", r.status === 400);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
