// A sweep over every API route: signed out, each role, other labs, bad input.
// Runs last (zz-) so the other test files have created data to look at.
const BASE = process.env.BASE ?? "http://localhost:4000";
let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, extra) => {
  if (cond) pass++;
  else {
    fail++;
    failures.push(name);
    console.log("  FAIL ", name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : "");
  }
};
let ipN = 1;
async function raw(method, path, { body, token, headers = {}, rawBody } = {}) {
  const h = { "x-forwarded-for": `10.20.${Math.floor(ipN / 250)}.${ipN++ % 250}`, ...headers };
  if (body !== undefined || rawBody !== undefined) h["content-type"] = "application/json";
  if (token) h.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers: h, body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, text, headers: res.headers };
}
const login = async (email, password = "Demo@12345") => (await raw("POST", "/api/auth/login", { body: { email, password } })).json.accessToken;

const Z = "00000000-0000-4000-8000-000000000000"; // a well-formed id that exists nowhere

// Every lab route, the permission it needs (null = any signed-in user), and a body for writes.
// ":id" is filled with Z, so allowed requests end in 400/404, never 2xx with someone's data.
const ROUTES = [
  ["GET", "/api/auth/me", null],
  ["GET", "/api/auth/sessions", null],
  ["GET", "/api/users", "users:read"],
  ["GET", "/api/users/roles", "users:read"],
  ["POST", "/api/users", "users:write", {}],
  ["PATCH", "/api/users/:id", "users:write", {}],
  ["PUT", "/api/users/:id/access", "users:write", {}],
  ["POST", "/api/users/:id/status", "users:write", {}],
  ["POST", "/api/users/:id/send-reset", "users:write"],
  ["POST", "/api/users/:id/password", "users:write", {}],
  ["GET", "/api/catalog/departments", "catalog:read"],
  ["POST", "/api/catalog/departments", "catalog:write", {}],
  ["GET", "/api/catalog/tests", "catalog:read"],
  ["GET", "/api/catalog/tests/:id", "catalog:read"],
  ["POST", "/api/catalog/tests", "catalog:write", {}],
  ["PUT", "/api/catalog/tests/:id", "catalog:write", {}],
  ["PATCH", "/api/catalog/tests/:id/status", "catalog:write", {}],
  ["GET", "/api/catalog/price-lists", "catalog:read"],
  ["POST", "/api/catalog/price-lists", "catalog:write", {}],
  ["GET", "/api/catalog/price-lists/:id", "catalog:read"],
  ["PUT", "/api/catalog/price-lists/:id/items", "catalog:write", {}],
  ["GET", "/api/patients", "patients:read"],
  ["GET", "/api/patients/:id", "patients:read"],
  ["POST", "/api/patients", "patients:write", {}],
  ["PUT", "/api/patients/:id", "patients:write", {}],
  ["GET", "/api/doctors", "patients:read"],
  ["POST", "/api/doctors", "patients:write", {}],
  ["GET", "/api/orders", "orders:read"],
  ["GET", "/api/orders/:id", "orders:read"],
  ["POST", "/api/orders", ["orders:write", "billing:write"], {}],
  ["POST", "/api/orders/:id/payments", "billing:write", {}],
  ["POST", "/api/orders/:id/cancel", "billing:discount", {}],
  ["GET", "/api/billing/collections", "billing:read"],
  ["PUT", "/api/lab", "settings:write", {}],
  ["POST", "/api/lab/branches", "branches:write", {}],
  ["GET", "/api/samples", "samples:read"],
  ["POST", "/api/samples/collect", "samples:write", {}],
  ["POST", "/api/samples/receive", "samples:write", {}],
  ["GET", "/api/results/worklist", "results:read"],
  ["GET", "/api/results/orders/:id", "results:read"],
  ["PUT", "/api/results/tests/:id", "results:write", {}],
  ["POST", "/api/results/approve", "results:approve", {}],
  ["GET", "/api/reports", "reports:read"],
  ["GET", "/api/reports/:id", "reports:read"],
  ["GET", "/api/reports/:id/pdf", "reports:read"],
  ["POST", "/api/reports/:id/link", "reports:deliver"],
  ["POST", "/api/reports/:id/send", "reports:deliver", {}],
  ["PUT", "/api/reports/whatsapp-settings", "settings:write", {}],
  ["GET", "/api/accounts", "accounts:read"],
  ["GET", "/api/accounts/:id", "accounts:read"],
  ["POST", "/api/accounts", "accounts:write", {}],
  ["POST", "/api/accounts/:id/invoices", "accounts:write", {}],
  ["PUT", "/api/accounts/:id", "accounts:write", {}],
  ["DELETE", "/api/accounts/:id", "accounts:write"],
  ["POST", "/api/accounts/top-up", "accounts:write", {}],
  ["POST", "/api/accounts/notes", "accounts:write", {}],
  ["POST", "/api/accounts/bulk", "accounts:write", {}],
  ["POST", "/api/lab/b2b-letterhead/asset", "accounts:write", {}],
  ["POST", "/api/lab/b2b-letterhead/preview", "accounts:write", {}],
  ["POST", "/api/accounts/bulk-price", "accounts:write", {}],
  ["PUT", "/api/accounts/:id/price-list", "accounts:write", {}],
  ["POST", "/api/accounts/:id/logins", "accounts:write", {}],
  ["GET", "/api/accounts/wallet-history", "accounts:read"],
  ["GET", "/api/accounts/ledger", "accounts:read"],
  ["GET", "/api/accounts/balances/days", "accounts:read"],
  ["GET", "/api/accounts/balances/labs", "accounts:read"],
  ["GET", "/api/accounts/notes", "accounts:read"],
  ["GET", "/api/b2b/summary", "b2b:portal"],
  ["GET", "/api/b2b/orders", "b2b:portal"],
  ["POST", "/api/b2b/orders", "b2b:portal", {}],
  ["GET", "/api/b2b/catalog", "b2b:portal"],
  ["GET", "/api/b2b/wallet-history", "b2b:portal"],
  ["GET", "/api/invoices", "accounts:read"],
  ["GET", "/api/invoices/:id", "accounts:read"],
  ["POST", "/api/invoices/:id/void", "accounts:write", {}],
];
const fill = (p) => p.replace(":id", Z);

console.log("1. signed out: every lab route says 401");
for (const [m, p, , body] of ROUTES) {
  const r = await raw(m, fill(p), { body });
  check(`no token: ${m} ${p} -> 401`, r.status === 401, r.status);
}
const garbage = await raw("GET", "/api/patients", { token: "not.a.jwt" });
check("garbage token -> 401", garbage.status === 401);
const forged = await raw("GET", "/api/patients", {
  token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4IiwidGlkIjoieSIsInNpZCI6InoifQ.c2lnbmF0dXJl",
});
check("forged token -> 401", forged.status === 401);

console.log("2. each role: 403 exactly when the permission is missing");
const owner = await login("owner@demo-lab.test");
// A branch manager, which the demo seed doesn't have.
await raw("POST", "/api/users", {
  token: owner,
  body: { name: "Bina Manager", email: "manager@demo-lab.test", password: "Demo@12345", roleKeys: ["branch_manager"] },
});
const roles = {
  owner,
  branch_manager: await login("manager@demo-lab.test"),
  front_desk: await login("frontdesk@demo-lab.test"),
  technician: await login("tech@demo-lab.test"),
  pathologist: await login("pathologist@demo-lab.test"),
  phlebotomist: await login("phleb@demo-lab.test"),
};
for (const [role, token] of Object.entries(roles)) {
  check(`${role} can sign in`, !!token);
  if (!token) continue;
  const me = (await raw("GET", "/api/auth/me", { token })).json.user;
  const perms = new Set(me.permissions);
  let wrong = 0;
  for (const [m, p, need, body] of ROUTES) {
    const needs = need === null ? [] : Array.isArray(need) ? need : [need];
    const allowed = needs.every((x) => perms.has(x));
    const r = await raw(m, fill(p), { token, body });
    const ok = allowed ? r.status !== 403 && r.status !== 401 && r.status < 500 : r.status === 403;
    if (!ok) {
      wrong++;
      check(`${role}: ${m} ${p} (${allowed ? "allowed" : "not allowed"}) got ${r.status}`, false, r.json?.error ?? r.json);
    }
    if (allowed && m === "GET" && r.status === 200) {
      const t = r.text;
      check(`${role}: ${p} leaks no secrets`, !/passwordHash|refreshTokenHash|tokenHash|totpSecret|apiKeyEnc|recoveryCode/i.test(t), p);
    }
  }
  check(`${role}: all ${ROUTES.length} routes behave as their permissions say`, wrong === 0, wrong);
}

console.log("3. bad input never crashes the server");
const ownerT = roles.owner;
for (const p of ["/api/patients/not-a-uuid", "/api/orders/123", "/api/accounts/%27%20OR%201%3D1", "/api/invoices/x", "/api/reports/abc/pdf", "/api/results/orders/zz"]) {
  const r = await raw("GET", p, { token: ownerT });
  check(`malformed id ${p} -> 4xx, not 500`, r.status >= 400 && r.status < 500, r.status);
}
let r = await raw("POST", "/api/patients", { token: ownerT, rawBody: "{not json" });
check("broken JSON -> 400", r.status === 400, { status: r.status, body: r.json });
r = await raw("POST", "/api/patients", { token: ownerT, rawBody: JSON.stringify({ name: "x".repeat(2_000_000) }) });
check("2 MB body -> 413", r.status === 413, r.status);
r = await raw("POST", "/api/patients", { token: ownerT, body: [] });
check("array instead of object -> 400", r.status === 400, r.status);
r = await raw("POST", "/api/patients", { token: ownerT, body: { name: "<script>alert(1)</script>", sex: "MALE", age: { years: 30 }, consent: true } });
check("HTML in a name is stored as text, not rejected or run", r.status === 201 && r.json.patient.name === "<script>alert(1)</script>", r.json);
r = await raw("GET", `/api/patients?q=${encodeURIComponent("' OR 1=1 --")}`, { token: ownerT });
check("SQL-like search text is just text", r.status === 200 && Array.isArray(r.json.patients), r.status);
r = await raw("GET", "/api/orders?page=-5&pageSize=100000", { token: ownerT });
check("silly paging values are clamped", r.status === 200 && r.json.pageSize <= 100, r.json.pageSize);
r = await raw("GET", "/api/billing/collections?date=2026-13-45", { token: ownerT });
check("impossible date -> 4xx", r.status >= 400 && r.status < 500, r.status);

console.log("4. another lab sees nothing of ours");
const other = await raw("POST", "/api/auth/signup", {
  body: { labName: "Sweep Other Lab", ownerName: "Oscar", email: "oscar@sweep.test", phone: "9811155555", password: "Other@1234" },
});
const otherT = other.json.accessToken;
const ours = {
  patient: (await raw("GET", "/api/patients", { token: ownerT })).json.patients?.[0]?.id,
  order: (await raw("GET", "/api/orders", { token: ownerT })).json.orders?.[0]?.id,
  test: (await raw("GET", "/api/catalog/tests", { token: ownerT })).json.tests?.[0]?.id,
};
check("found our ids to try", ours.patient && ours.order && ours.test, ours);
for (const [label, path] of [
  ["patient", `/api/patients/${ours.patient}`],
  ["order", `/api/orders/${ours.order}`],
  ["test", `/api/catalog/tests/${ours.test}`],
  ["result sheet", `/api/results/orders/${ours.order}`],
  ["report", `/api/reports/${ours.order}`],
  ["report pdf", `/api/reports/${ours.order}/pdf`],
]) {
  const x = await raw("GET", path, { token: otherT });
  check(`other lab: our ${label} -> 404`, x.status === 404, x.status);
}
const lists = await Promise.all(["/api/patients", "/api/orders", "/api/users", "/api/catalog/price-lists", "/api/accounts"].map((p) => raw("GET", p, { token: otherT })));
check("other lab's lists hold only their own rows", !lists.some((x) => x.text.includes("demo-lab.test") || x.text.includes(ours.patient)), lists.map((x) => x.status));
r = await raw("POST", `/api/orders/${ours.order}/payments`, { token: otherT, body: { payments: [{ mode: "CASH", amountPaise: 100 }] } });
check("other lab can't pay on our order", r.status === 404, r.status);

console.log("5. sessions and tokens");
const admin = await raw("POST", "/api/admin/auth/login", { body: { email: "admin@platform.test", password: "Demo@12345" } });
if (admin.json.accessToken) {
  r = await raw("GET", "/api/patients", { token: admin.json.accessToken });
  check("an admin token is useless in the lab app", r.status === 401);
}
r = await raw("GET", "/api/admin/overview", { token: ownerT });
check("a lab token is useless in the admin console", r.status === 401);
const t1 = await login("frontdesk@demo-lab.test");
await raw("POST", "/api/auth/logout", { token: t1 });
r = await raw("POST", "/api/auth/refresh");
check("refresh with no cookie -> 401", r.status === 401);

console.log("6. headers");
r = await raw("GET", "/api/health");
check("security headers on", r.headers.get("x-content-type-options") === "nosniff" && !!r.headers.get("strict-transport-security") === !!r.headers.get("strict-transport-security"));
check("no x-powered-by", !r.headers.get("x-powered-by"));
r = await raw("GET", "/api/nope", { token: ownerT });
check("unknown route -> 404 JSON", r.status === 404 && typeof r.json === "object", r.status);

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) console.log("Failures:\n- " + failures.join("\n- "));
process.exit(fail ? 1 : 0);
