import { createHmac } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:4000";

// Authenticator-app codes (RFC 6238), computed here the way a phone would.
function base32Decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s.replace(/=+$/, "")) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
const stepNow = () => Math.floor(Date.now() / 30000);
function totp(secret, step = stepNow()) {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(c).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   ", name); }
  else { fail++; console.log("  FAIL ", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ""); }
};
let ipN = 1;
async function call(method, path, { body, token, cookie, ip } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": ip ?? `10.7.0.${ipN}` };
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, setCookie: res.headers.get("set-cookie") };
}
const PW = "Demo@12345";
const labLogin = async (email, password = PW) => call("POST", "/api/auth/login", { body: { email, password } });
const adminLogin = async (email, password = PW) => call("POST", "/api/admin/auth/login", { body: { email, password } });

console.log("admin sign-in");
let r = await adminLogin("admin@platform.test", "wrong-password");
check("wrong password -> 401", r.status === 401);
r = await adminLogin("owner@demo-lab.test");
check("a lab owner can't sign in to the admin console", r.status === 401);
r = await adminLogin("admin@platform.test");
check("super admin signs in", r.status === 200 && r.json.admin.role === "SUPER_ADMIN" && r.json.accessToken, r.json);
check("told two-step is required and not set up", r.json.admin.mfaRequired === true && r.json.admin.mfaEnabled === false, r.json.admin);
const admin = r.json.accessToken;
let cookie = r.setCookie?.split(";")[0];
check("refresh cookie scoped to /api/admin/auth", /lms_admin_rt=/.test(r.setCookie ?? "") && /Path=\/api\/admin\/auth/i.test(r.setCookie ?? ""), r.setCookie);

console.log("two-step sign-in");
r = await call("GET", "/api/admin/overview", { token: admin });
check("nothing works until two-step is set up -> 403", r.status === 403 && r.json.error.code === "mfa_setup_required", r.json);
r = await call("POST", "/api/admin/auth/mfa/setup", { token: admin });
check("setup gives a secret and a QR code", r.status === 200 && /^[A-Z2-7]{32}$/.test(r.json.setup.secret) && r.json.setup.qrDataUrl.startsWith("data:image/png"), r.json);
check("otpauth link for the app", r.json.setup.otpauthUrl.startsWith("otpauth://totp/") && r.json.setup.otpauthUrl.includes("admin%40platform.test"));
const adminSecret = r.json.setup.secret;
r = await call("POST", "/api/admin/auth/mfa/enable", { token: admin, body: { code: "000000" === totp(adminSecret) ? "111111" : "000000" } });
check("wrong first code -> 400", r.status === 400);
const enableStep = stepNow();
r = await call("POST", "/api/admin/auth/mfa/enable", { token: admin, body: { code: totp(adminSecret, enableStep) } });
check("two-step turned on, 8 recovery codes", r.status === 200 && r.json.recoveryCodes.length === 8 && /^[a-z0-9]{4}-[a-z0-9]{4}$/.test(r.json.recoveryCodes[0]), r.json);
const recovery = r.json.recoveryCodes;
r = await call("GET", "/api/admin/overview", { token: admin });
check("now the console works", r.status === 200);
r = await call("POST", "/api/admin/auth/mfa/setup", { token: admin });
check("can't set up twice -> 409", r.status === 409);

r = await adminLogin("admin@platform.test");
check("password alone now only asks for the code", r.status === 200 && r.json.mfaRequired === true && r.json.mfaToken && !r.json.accessToken, r.json);
const ticket = r.json.mfaToken;
r = await call("POST", "/api/admin/auth/mfa", { body: { mfaToken: ticket, code: totp(adminSecret, enableStep) } });
check("the code used to turn it on can't be replayed -> 401", r.status === 401, r.json);
r = await call("POST", "/api/admin/auth/mfa", { body: { mfaToken: "x".repeat(40), code: totp(adminSecret, enableStep + 1) } });
check("a forged ticket -> 401", r.status === 401);
r = await call("POST", "/api/admin/auth/mfa", { body: { mfaToken: ticket, code: totp(adminSecret, enableStep + 1) } });
check("the next code signs in", r.status === 200 && r.json.accessToken && r.json.admin.mfaEnabled === true, r.json);
r = await call("POST", "/api/admin/auth/mfa", { body: { mfaToken: ticket, code: totp(adminSecret, enableStep + 1) } });
check("that code can't be used again -> 401", r.status === 401);
r = await adminLogin("admin@platform.test");
const recoveryLogin = { status: r.status, body: r.json };
r = await call("POST", "/api/admin/auth/mfa", { body: { mfaToken: r.json.mfaToken, code: recovery[0].toUpperCase() } });
// The sign-in response is included so a failure here says which step went wrong.
check("a recovery code works", r.status === 200 && r.json.accessToken, { login: recoveryLogin, mfa: r.json });
r = await adminLogin("admin@platform.test");
r = await call("POST", "/api/admin/auth/mfa", { body: { mfaToken: r.json.mfaToken, code: recovery[0] } });
check("but only once -> 401", r.status === 401);

/** Signs in an admin without two-step yet and sets it up, returning a usable token. */
async function enrol(email, password = PW) {
  const t = (await adminLogin(email, password)).json.accessToken;
  const secret = (await call("POST", "/api/admin/auth/mfa/setup", { token: t })).json.setup.secret;
  await call("POST", "/api/admin/auth/mfa/enable", { token: t, body: { code: totp(secret) } });
  return t;
}
const support = await enrol("support@platform.test");

console.log("tokens don't cross over");
const ownerToken = (await labLogin("owner@demo-lab.test")).json.accessToken;
r = await call("GET", "/api/admin/overview", { token: ownerToken });
check("lab token on admin API -> 401", r.status === 401);
r = await call("GET", "/api/patients", { token: admin });
check("admin token on lab API -> 401", r.status === 401);
r = await call("GET", "/api/admin/overview");
check("no token -> 401", r.status === 401);

console.log("refresh and me");
r = await call("POST", "/api/admin/auth/refresh", { cookie });
check("refresh works", r.status === 200 && r.json.admin.email === "admin@platform.test");
r = await call("GET", "/api/admin/auth/me", { token: admin });
check("me", r.status === 200 && r.json.admin.name === "Platform Admin" && !r.json.admin.sessionId, r.json);

console.log("overview");
// A second lab, so there is more than one to see.
const signup = await call("POST", "/api/auth/signup", {
  body: { labName: "Sunrise Pathology", ownerName: "Ravi Iyer", email: "ravi@sunrise.test", phone: "9811122233", password: "Sunrise@123" },
});
check("second lab signed up", signup.status === 201, signup.json);
r = await call("GET", "/api/admin/overview", { token: support });
check("support can see the overview", r.status === 200 && r.json.overview.labs.total >= 2, r.json);
check("labs by status and plan", r.json.overview.labs.byStatus.TRIAL >= 1 && typeof r.json.overview.labs.byPlan.STARTER === "number");
check("user counts", r.json.overview.users.total >= 5 && r.json.overview.users.active >= 5);
check("recent labs listed, newest first", r.json.overview.recentLabs[0]?.name === "Sunrise Pathology", r.json.overview.recentLabs.map((l) => l.name));

console.log("labs");
r = await call("GET", "/api/admin/labs", { token: support });
const demo = r.json.labs.find((l) => l.name === "Demo Diagnostics");
const sunrise = r.json.labs.find((l) => l.name === "Sunrise Pathology");
check("both labs listed", demo && sunrise, r.json.labs?.map((l) => l.name));
check("owner, user and branch counts", demo.owner?.email === "owner@demo-lab.test" && demo.users >= 4 && demo.branches === 2, demo);
check("new lab: 1 user, owner Ravi", sunrise.users === 1 && sunrise.owner?.name === "Ravi Iyer");
r = await call("GET", "/api/admin/labs?q=sunrise", { token: support });
check("search by name", r.json.labs.length === 1 && r.json.labs[0].id === sunrise.id);
r = await call("GET", "/api/admin/labs?q=frontdesk@demo-lab.test", { token: support });
check("search by any user's email", r.json.labs.length === 1 && r.json.labs[0].id === demo.id);
r = await call("GET", "/api/admin/labs?status=SUSPENDED", { token: support });
check("filter by status", r.json.labs.every((l) => l.status === "SUSPENDED"));

r = await call("GET", `/api/admin/labs/${demo.id}`, { token: support });
check("lab detail", r.status === 200 && r.json.lab.branchList.length === 2 && r.json.lab.userList.length >= 4, r.json);
check("usage numbers", typeof r.json.lab.usage.patients === "number" && r.json.lab.usage.testsInCatalog > 10, r.json.lab.usage);
r = await call("GET", "/api/admin/labs/not-a-uuid", { token: support });
check("bad id -> 404", r.status === 404);

console.log("subscriptions");
const sub = { plan: "GROWTH", status: "ACTIVE", planRenewsAt: "2027-10-31", reason: "Paid yearly invoice INV-104" };
r = await call("PUT", `/api/admin/labs/${sunrise.id}/subscription`, { token: support, body: sub });
check("support can't change plans -> 403", r.status === 403);
r = await call("PUT", `/api/admin/labs/${sunrise.id}/subscription`, { token: admin, body: { ...sub, reason: "" } });
check("a reason is required -> 400", r.status === 400);
r = await call("PUT", `/api/admin/labs/${sunrise.id}/subscription`, { token: admin, body: sub });
check("plan changed to Growth, active", r.status === 200 && r.json.lab.plan === "GROWTH" && r.json.lab.status === "ACTIVE", r.json);
check("renewal date saved", r.json.lab.planRenewsAt?.startsWith("2027-10-31"), r.json.lab.planRenewsAt);
check("history shows who and why", r.json.lab.history[0]?.action === "lab.subscription" && r.json.lab.history[0].admin === "Platform Admin" && r.json.lab.history[0].after.reason.includes("INV-104"), r.json.lab.history[0]);

console.log("suspending a lab");
const raviBefore = await labLogin("ravi@sunrise.test", "Sunrise@123");
const raviToken = raviBefore.json.accessToken;
r = await call("GET", "/api/patients", { token: raviToken });
check("Ravi can work before suspension", r.status === 200);
r = await call("PUT", `/api/admin/labs/${sunrise.id}/subscription`, { token: admin, body: { ...sub, status: "SUSPENDED", reason: "Unpaid for 60 days" } });
check("suspended", r.status === 200 && r.json.lab.status === "SUSPENDED");
r = await call("GET", "/api/patients", { token: raviToken });
check("suspension cuts off signed-in users at once -> 401", r.status === 401);
r = await labLogin("ravi@sunrise.test", "Sunrise@123");
check("and blocks sign-in", r.status === 401 && /suspended/i.test(r.json.error.message), r.json);
r = await call("PUT", `/api/admin/labs/${sunrise.id}/subscription`, { token: admin, body: { ...sub, reason: "Payment received" } });
r = await labLogin("ravi@sunrise.test", "Sunrise@123");
check("reactivated: sign-in works again", r.status === 200);

console.log("users");
r = await call("GET", "/api/admin/users", { token: support });
check("all users across labs", r.status === 200 && r.json.users.some((u) => u.email === "ravi@sunrise.test") && r.json.users.some((u) => u.email === "tech@demo-lab.test"));
r = await call("GET", `/api/admin/users?labId=${demo.id}&role=pathologist`, { token: support });
check("filter by lab and role", r.json.users.length === 1 && r.json.users[0].email === "pathologist@demo-lab.test", r.json.users.map((u) => u.email));
r = await call("GET", "/api/admin/users?q=Iyer", { token: support });
check("search by name", r.json.users.length === 1 && r.json.users[0].lab.name === "Sunrise Pathology");
const desk = (await call("GET", "/api/admin/users?q=frontdesk@demo-lab.test", { token: support })).json.users[0];
check("roles with branch scope", desk.roles[0].key === "front_desk" && desk.roles[0].branch === "Andheri collection centre", desk.roles);

const deskLogin = await labLogin("frontdesk@demo-lab.test");
r = await call("GET", `/api/admin/users/${desk.id}`, { token: support });
check("user detail: permissions", r.status === 200 && r.json.user.permissions.includes("billing:write") && !r.json.user.permissions.includes("results:approve"), r.json.user.permissions);
check("branch scope listed", JSON.stringify(r.json.user.branchScope) === JSON.stringify(["Andheri collection centre"]), r.json.user.branchScope);
check("active sessions and activity", r.json.user.sessions.length >= 1 && r.json.user.activity.some((a) => a.action === "auth.login"), r.json.user.activity?.slice(0, 3));
check("no password hash leaks", !JSON.stringify(r.json).includes("passwordHash"));

console.log("disabling and signing out");
r = await call("POST", `/api/admin/users/${desk.id}/status`, { token: support, body: { isActive: false, reason: "Left the company" } });
check("support can't disable -> 403", r.status === 403);
r = await call("POST", `/api/admin/users/${desk.id}/status`, { token: admin, body: { isActive: false, reason: "Left the company" } });
check("super admin disables", r.status === 200 && r.json.user.isActive === false && r.json.user.sessions.length === 0, r.json.user);
r = await call("GET", "/api/patients", { token: deskLogin.json.accessToken });
check("disabled user is signed out at once -> 401", r.status === 401);
r = await labLogin("frontdesk@demo-lab.test");
check("and can't sign in", r.status === 401);
r = await call("POST", `/api/admin/users/${desk.id}/status`, { token: admin, body: { isActive: false, reason: "again" } });
check("disabling twice -> 409", r.status === 409);
r = await call("POST", `/api/admin/users/${desk.id}/status`, { token: admin, body: { isActive: true, reason: "Rejoined" } });
check("re-enabled", r.status === 200 && r.json.user.isActive);
const again = await labLogin("frontdesk@demo-lab.test");
check("can sign in again", again.status === 200);
r = await call("POST", `/api/admin/users/${desk.id}/sign-out`, { token: admin, body: { reason: "Lost phone" } });
check("signed out everywhere", r.status === 200 && r.json.user.sessions.length === 0);
r = await call("GET", "/api/patients", { token: again.json.accessToken });
check("old token stops working", r.status === 401);
r = await call("GET", `/api/admin/users/${desk.id}`, { token: support });
check("user history records each action with reasons", r.json.user.history.length === 3 && r.json.user.history.some((h) => h.after?.reason === "Lost phone"), r.json.user.history);

console.log("audit log");
r = await call("GET", "/api/admin/audit", { token: support });
check("platform audit log", r.status === 200 && r.json.items.some((i) => i.action === "user.disable") && r.json.items.some((i) => i.action === "admin.login"));
r = await call("GET", `/api/admin/audit?labId=${sunrise.id}`, { token: support });
check("filtered to one lab", r.json.items.length >= 3 && r.json.items.every((i) => i.lab?.id === sunrise.id));

console.log("platform admins");
r = await call("GET", "/api/admin/admins", { token: support });
check("support can't manage admins -> 403", r.status === 403);
r = await call("POST", "/api/admin/admins", { token: admin, body: { name: "Asha", email: "asha@platform.test", password: "short", role: "SUPPORT" } });
check("weak password -> 400", r.status === 400);
r = await call("POST", "/api/admin/admins", { token: admin, body: { name: "Asha", email: "asha@platform.test", password: "a-long-enough-password", role: "SUPPORT" } });
check("admin created", r.status === 201 && r.json.admin.role === "SUPPORT", r.json);
const asha = r.json.admin.id;
const ashaToken = await enrol("asha@platform.test", "a-long-enough-password");
check("new admin can sign in and set up two-step", (await call("GET", "/api/admin/overview", { token: ashaToken })).status === 200);
r = await call("GET", "/api/admin/admins", { token: admin });
check("admin list shows who has two-step on", r.json.admins.find((a) => a.email === "asha@platform.test")?.mfaEnabled === true);
r = await call("POST", `/api/admin/admins/${asha}/reset-mfa`, { token: admin });
check("a super admin can reset someone's two-step (lost phone)", r.status === 204);
check("that signs them out", (await call("GET", "/api/admin/overview", { token: ashaToken })).status === 401);
r = await adminLogin("asha@platform.test", "a-long-enough-password");
check("and they set it up again at next sign-in", r.status === 200 && r.json.admin.mfaEnabled === false && r.json.accessToken);
const ashaAgain = r.json.accessToken;
r = await call("POST", "/api/admin/auth/change-password", { token: ashaAgain, body: { currentPassword: "a-long-enough-password", newPassword: "short" } });
check("admin password needs 12+ characters -> 400", r.status === 400);
r = await call("POST", "/api/admin/auth/change-password", { token: ashaAgain, body: { currentPassword: "a-long-enough-password", newPassword: "an-even-longer-password" } });
check("admin changes their own password", r.status === 204);
check("new admin password works", (await adminLogin("asha@platform.test", "an-even-longer-password")).status === 200);
r = await call("POST", `/api/admin/admins/${asha}/status`, { token: admin, body: { isActive: false } });
check("admin disabled", r.status === 200 && r.json.admin.isActive === false);
r = await call("GET", "/api/admin/overview", { token: ashaToken });
check("disabled admin is cut off at once", r.status === 401);
const me = (await call("GET", "/api/admin/auth/me", { token: admin })).json.admin;
r = await call("POST", `/api/admin/admins/${me.id}/status`, { token: admin, body: { isActive: false } });
check("can't disable yourself", r.status === 400);

console.log("lab access: modules, role permissions, limits");
r = await call("GET", `/api/admin/labs/${demo.id}/access`, { token: support });
check("support can see a lab's access", r.status === 200 && r.json.access.modules.length === 3 && r.json.access.modules.every((m) => m.enabled), r.json);
const ownerRole = r.json.access.roles.find((x) => x.key === "owner");
const deskRole = r.json.access.roles.find((x) => x.key === "front_desk");
check("roles listed with their built-in permissions", ownerRole?.effective.includes("users:write") && !deskRole?.effective.includes("billing:discount") && deskRole.users >= 1, { ownerRole, deskRole });
const accessBody = (over = {}) => ({
  disabledModules: [],
  roles: Object.fromEntries(r.json.access.roles.map((x) => [x.key, x.defaults])),
  maxUsers: null,
  maxBranches: null,
  reason: "Plan review",
  ...over,
});
const defaults = accessBody();
let x = await call("PUT", `/api/admin/labs/${demo.id}/access`, { token: support, body: defaults });
check("support can't change access -> 403", x.status === 403);
x = await call("PUT", `/api/admin/labs/${demo.id}/access`, { token: admin, body: { ...defaults, reason: "" } });
check("a reason is required -> 400", x.status === 400);

const ownerBefore = (await labLogin("owner@demo-lab.test")).json.accessToken;
check("the owner can manage staff before (empty body -> 400, not 403)", (await call("POST", "/api/users", { token: ownerBefore, body: {} })).status === 400);
x = await call("PUT", `/api/admin/labs/${demo.id}/access`, {
  token: admin,
  body: accessBody({
    disabledModules: ["accounts"],
    roles: {
      ...defaults.roles,
      owner: ownerRole.defaults.filter((p) => p !== "users:write"),
      front_desk: [...deskRole.defaults, "billing:discount"],
    },
  }),
});
check("access changed", x.status === 200, x.json);
const after = x.json.access;
check("B2B accounts switched off", after.modules.find((m) => m.key === "accounts").enabled === false);
check("owner loses staff management", !after.roles.find((y) => y.key === "owner").effective.includes("users:write"));
check("module removes account permissions from every role", after.roles.every((y) => !y.effective.some((p) => p.startsWith("accounts:"))));
check("front desk gains discounts", after.roles.find((y) => y.key === "front_desk").effective.includes("billing:discount"));
x = await call("POST", "/api/users", { token: ownerBefore, body: {} });
check("takes effect at once for the signed-in owner -> 403", x.status === 403, x.status);
const ownerMe = (await call("GET", "/api/auth/me", { token: ownerBefore })).json.user;
check("owner's own permission list updated", !ownerMe.permissions.includes("users:write") && !ownerMe.permissions.includes("accounts:read"));
x = await call("GET", "/api/accounts", { token: ownerBefore });
check("B2B accounts blocked -> 403", x.status === 403);
const deskT = (await labLogin("frontdesk@demo-lab.test")).json.accessToken;
check("front desk now has discounts", (await call("GET", "/api/auth/me", { token: deskT })).json.user.permissions.includes("billing:discount"));
const T = Object.fromEntries((await call("GET", "/api/catalog/tests", { token: deskT })).json.tests.map((t) => [t.code, t]));
const pt = (await call("POST", "/api/patients", { token: deskT, body: { name: "Access Check", sex: "MALE", age: { years: 40 }, consent: true } })).json.patient;
x = await call("GET", `/api/admin/audit?labId=${demo.id}`, { token: support });
check("audit records the access change with its reason", x.json.items.some((i) => i.action === "lab.access" && i.after?.reason === "Plan review"));

x = await call("PUT", `/api/admin/labs/${demo.id}/access`, { token: admin, body: { ...defaults, reason: "Back to defaults" } });
check("reset to defaults", x.status === 200 && x.json.access.modules.every((m) => m.enabled) && x.json.access.roles.every((y) => y.effective.length === y.defaults.length));
check("owner can manage staff again", (await call("POST", "/api/users", { token: ownerBefore, body: {} })).status === 400);

console.log("limits");
x = await call("PUT", `/api/admin/labs/${sunrise.id}/access`, {
  token: admin,
  body: { disabledModules: [], roles: {}, maxUsers: 1, maxBranches: 1, reason: "Starter plan limits" },
});
check("limits set: 1 user, 1 branch", x.status === 200 && x.json.access.limits.maxUsers === 1 && x.json.access.usage.users === 1, x.json);
const raviT = (await labLogin("ravi@sunrise.test", "Sunrise@123")).json.accessToken;
x = await call("POST", "/api/users", { token: raviT, body: { name: "Extra Person", email: "extra@sunrise.test", password: "Extra@1234", roleKeys: ["front_desk"] } });
check("adding a user over the limit -> 409", x.status === 409 && x.json.error.code === "limit_reached", x.json);
x = await call("POST", "/api/lab/branches", { token: raviT, body: { name: "Second branch", code: "SEC", type: "COLLECTION_CENTRE" } });
check("adding a branch over the limit -> 409", x.status === 409 && /branches/.test(x.json.error.message), x.json);
await call("PUT", `/api/admin/labs/${sunrise.id}/access`, { token: admin, body: { disabledModules: [], roles: {}, maxUsers: 5, maxBranches: 3, reason: "Upgraded" } });
x = await call("POST", "/api/lab/branches", { token: raviT, body: { name: "Second branch", code: "SEC", type: "COLLECTION_CENTRE" } });
check("raised limit: branch added", x.status === 201, x.json);

console.log("any user's access from the console");
const demoLab = (await call("GET", `/api/admin/labs/${demo.id}`, { token: admin })).json.lab;
const andheri = demoLab.branchList.find((b) => b.name.startsWith("Andheri"));
x = await call("PUT", `/api/admin/users/${desk.id}/access`, { token: support, body: { roleKeys: ["front_desk"], branchId: null, reason: "x" } });
check("support can't change a user's roles -> 403", x.status === 403);
x = await call("PUT", `/api/admin/users/${desk.id}/access`, { token: admin, body: { roleKeys: ["front_desk", "phlebotomist"], branchId: null, reason: "Covers sample collection too" } });
check("roles changed from the console", x.status === 200 && x.json.user.roles.length === 2 && x.json.user.branchScope === null, x.json.user?.roles);
x = await call("PUT", `/api/admin/users/${desk.id}/access`, { token: admin, body: { roleKeys: ["nope"], branchId: null, reason: "Typo" } });
check("unknown role -> 400", x.status === 400);
x = await call("PUT", `/api/admin/users/${desk.id}/access`, { token: admin, body: { roleKeys: ["front_desk"], branchId: andheri.id, reason: "Put back" } });
check("and put back", x.status === 200 && x.json.user.branchScope?.[0]?.startsWith("Andheri"), x.json.user?.branchScope);
const ravi = (await call("GET", "/api/admin/users?q=ravi@sunrise.test", { token: admin })).json.users[0];
x = await call("PUT", `/api/admin/users/${ravi.id}/access`, { token: admin, body: { roleKeys: ["front_desk"], branchId: null, reason: "Demote" } });
check("can't demote a lab's only owner -> 400", x.status === 400 && /only active owner/.test(x.json.error.message), x.json);
x = await call("POST", `/api/admin/users/${ravi.id}/send-reset`, { token: admin, body: { reason: "Owner locked out" } });
check("reset link sent from the console", x.status === 200 && x.json.sent === true, x.json);
x = await call("POST", `/api/admin/users/${ravi.id}/password`, { token: admin, body: { password: "Temp@99887", reason: "Owner locked out, verified by phone" } });
check("temporary password set from the console", x.status === 200);
const raviTemp = await labLogin("ravi@sunrise.test", "Temp@99887");
check("owner signs in with it and must change it", raviTemp.status === 200 && raviTemp.json.user.mustChangePassword === true, raviTemp.json.user);

console.log("sign-out");
r = await call("POST", "/api/admin/auth/logout", { cookie });
check("logout", r.status === 204);
r = await call("POST", "/api/admin/auth/refresh", { cookie });
check("refresh after logout -> 401", r.status === 401);

console.log("brute force");
let last;
for (let i = 0; i < 6; i++) last = await call("POST", "/api/admin/auth/login", { body: { email: "admin@platform.test", password: "nope" }, ip: "10.9.9.9" });
check("6th wrong attempt from one address -> 429", last.status === 429, last.status);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
