import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE ?? "http://localhost:4000";
const MAIL_DIR = process.env.MAIL_DIR;
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   ", name); }
  else { fail++; console.log("  FAIL ", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ""); }
};
let ipN = 10;
async function call(method, path, { body, token, ip } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": ip ?? `10.8.0.${ipN}` };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
const login = (email, password) => call("POST", "/api/auth/login", { body: { email, password } });
const PW = "Demo@12345";

/** Emails to this address, newest last. */
const mailsTo = (to) =>
  !existsSync(MAIL_DIR) ? [] : readdirSync(MAIL_DIR, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.includes(to))
    .map((f) => f.name)
    .sort()
    .map((n) => JSON.parse(readFileSync(join(MAIL_DIR, n), "utf8")));
const lastMail = (to) => mailsTo(to).at(-1);
const tokenFrom = (mail) => decodeURIComponent(/token=([^\s"&<]+)/.exec(mail.text)?.[1] ?? "");

// A fresh lab of our own, so these tests don't disturb the demo lab.
const signup = await call("POST", "/api/auth/signup", {
  body: { labName: "Pass Lab", ownerName: "Pooja Owner", email: "pooja@passlab.test", phone: "9811100001", password: "Owner@1234" },
});
let owner = signup.json.accessToken;
check("lab signed up", signup.status === 201, signup.json);
check("session says no forced change", signup.json.user.mustChangePassword === false);
const roles = (await call("GET", "/api/users/roles", { token: owner })).json.roles;
const branches = (await call("GET", "/api/lab", { token: owner })).json.lab.branches;
const mk = async (name, email, roleKeys) =>
  (await call("POST", "/api/users", { token: owner, body: { name, email, password: "Staff@1234", roleKeys } })).json.user;
const ravi = await mk("Ravi Desk", "ravi@passlab.test", ["front_desk"]);
const meena = await mk("Meena Tech", "meena@passlab.test", ["technician"]);

console.log("forgot password");
ipN = 11;
let r = await call("POST", "/api/auth/forgot-password", { body: { email: "nobody@passlab.test" } });
check("unknown email -> 204 all the same", r.status === 204);
check("and no email sent", mailsTo("nobody@passlab.test").length === 0);
r = await call("POST", "/api/auth/forgot-password", { body: { email: "RAVI@passlab.test" } });
check("known email -> 204", r.status === 204);
let mail = lastMail("ravi@passlab.test");
check("reset email sent", mail?.subject === "Reset your password" && /\/reset-password\?token=/.test(mail.text), mail);
check("html version with a button", mail?.html?.includes("Choose a new password"));
const firstToken = tokenFrom(mail);
r = await call("POST", "/api/auth/forgot-password", { body: { email: "ravi@passlab.test" } });
const secondToken = tokenFrom(lastMail("ravi@passlab.test"));
check("a second request sends a new link", secondToken && secondToken !== firstToken);

const raviOld = (await login("ravi@passlab.test", "Staff@1234")).json.accessToken;
r = await call("POST", "/api/auth/reset-password", { body: { token: firstToken, password: "NewPass@123" } });
check("the older link stops working -> 400", r.status === 400, r.json);
r = await call("POST", "/api/auth/reset-password", { body: { token: secondToken, password: "short" } });
check("weak new password -> 400", r.status === 400);
r = await call("POST", "/api/auth/reset-password", { body: { token: secondToken, password: "NewPass@123" } });
check("reset with the newest link", r.status === 204, r.json);
r = await call("POST", "/api/auth/reset-password", { body: { token: secondToken, password: "Another@123" } });
check("a link works only once", r.status === 400);
r = await call("GET", "/api/patients", { token: raviOld });
check("reset signs out every device", r.status === 401);
check("old password no longer works", (await login("ravi@passlab.test", "Staff@1234")).status === 401);
check("new password works", (await login("ravi@passlab.test", "NewPass@123")).status === 200);
check("'password changed' notice emailed", lastMail("ravi@passlab.test")?.subject === "Your password was changed");
r = await call("POST", "/api/auth/reset-password", { body: { token: "garbage-token-garbage-token", password: "NewPass@123" } });
check("garbage token -> 400", r.status === 400);

console.log("forgot-password rate limit");
ipN = 12;
for (let i = 0; i < 3; i++) await call("POST", "/api/auth/forgot-password", { body: { email: "meena@passlab.test" } });
r = await call("POST", "/api/auth/forgot-password", { body: { email: "meena@passlab.test" } });
check("4th request for one email in an hour -> 429", r.status === 429, r.status);

console.log("change own password");
ipN = 13;
const raviLogin = await login("ravi@passlab.test", "NewPass@123");
const raviTab1 = raviLogin.json.accessToken;
const raviTab2 = (await login("ravi@passlab.test", "NewPass@123")).json.accessToken;
r = await call("POST", "/api/auth/change-password", { token: raviTab1, body: { currentPassword: "wrong", newPassword: "Changed@123" } });
check("wrong current password -> 400 on that field", r.status === 400 && r.json.error.fields?.currentPassword, r.json);
r = await call("POST", "/api/auth/change-password", { token: raviTab1, body: { currentPassword: "NewPass@123", newPassword: "NewPass@123" } });
check("same password again -> 400", r.status === 400);
r = await call("POST", "/api/auth/change-password", { token: raviTab1, body: { currentPassword: "NewPass@123", newPassword: "Changed@123" } });
check("changed", r.status === 200 && r.json.user.email === "ravi@passlab.test");
check("this device stays signed in", (await call("GET", "/api/patients", { token: raviTab1 })).status === 200);
check("other devices signed out", (await call("GET", "/api/patients", { token: raviTab2 })).status === 401);

console.log("owner: roles and branch");
const centre = (await call("POST", "/api/lab/branches", { token: owner, body: { name: "Thane centre", code: "THN", type: "COLLECTION_CENTRE" } })).json.branch;
r = await call("PUT", `/api/users/${ravi.id}/access`, { token: owner, body: { roleKeys: ["front_desk", "phlebotomist"], branchId: centre.id } });
check("roles and branch changed", r.status === 204, r.json);
let list = (await call("GET", "/api/users", { token: owner })).json.users;
let row = list.find((u) => u.id === ravi.id);
check("list shows both roles at Thane", row.roles.length === 2 && row.roles.every((x) => x.branch === "Thane centre") && row.branchId === centre.id, row);
r = await call("GET", "/api/auth/me", { token: raviTab1 });
check("takes effect straight away", r.json.user.branches.length === 1 && r.json.user.branches[0].name === "Thane centre", r.json.user.branches);
r = await call("PUT", `/api/users/${ravi.id}/access`, { token: owner, body: { roleKeys: ["nope"], branchId: null } });
check("unknown role -> 400", r.status === 400);
const ownerId = signup.json.user.id;
r = await call("PUT", `/api/users/${ownerId}/access`, { token: owner, body: { roleKeys: ["technician"], branchId: null } });
check("can't change your own roles -> 400", r.status === 400);
r = await call("PUT", `/api/users/${meena.id}/access`, { token: raviTab1, body: { roleKeys: ["owner"], branchId: null } });
check("front desk can't change roles -> 403", r.status === 403);

console.log("owner: the last owner is protected");
r = await call("PUT", `/api/users/${meena.id}/access`, { token: owner, body: { roleKeys: ["owner"], branchId: null } });
check("Meena made an owner", r.status === 204);
const meenaToken = (await login("meena@passlab.test", "Staff@1234")).json.accessToken;
r = await call("POST", `/api/users/${ownerId}/status`, { token: meenaToken, body: { isActive: false } });
check("an owner can disable another owner while one remains", r.status === 204, r.json);
r = await call("POST", `/api/users/${ownerId}/status`, { token: meenaToken, body: { isActive: true } });
check("and enable them again", r.status === 204);
check("being disabled signed the owner out", (await call("GET", "/api/users", { token: owner })).status === 401);
owner = (await login("pooja@passlab.test", "Owner@1234")).json.accessToken;
r = await call("POST", `/api/users/${ownerId}/status`, { token: owner, body: { isActive: false } });
check("can't disable yourself -> 400", r.status === 400);
r = await call("PUT", `/api/users/${meena.id}/access`, { token: owner, body: { roleKeys: ["technician"], branchId: null } });
check("Meena back to technician", r.status === 204);
r = await call("PUT", `/api/users/${ownerId}/access`, { token: meenaToken, body: { roleKeys: ["technician"], branchId: null } });
check("Meena's owner rights are gone at once -> 403", r.status === 403);

console.log("owner: disable and enable");
r = await call("POST", `/api/users/${ravi.id}/status`, { token: owner, body: { isActive: false } });
check("Ravi disabled", r.status === 204);
check("Ravi signed out at once", (await call("GET", "/api/patients", { token: raviTab1 })).status === 401);
check("Ravi can't sign in", (await login("ravi@passlab.test", "Changed@123")).status === 401);
r = await call("POST", "/api/auth/forgot-password", { body: { email: "ravi@passlab.test" }, ip: "10.8.0.14" });
const before = mailsTo("ravi@passlab.test").length;
check("disabled users get no reset email", r.status === 204 && mailsTo("ravi@passlab.test").length === before);
r = await call("POST", `/api/users/${ravi.id}/status`, { token: owner, body: { isActive: false } });
check("disabling twice -> 409", r.status === 409);
r = await call("POST", `/api/users/${ravi.id}/send-reset`, { token: owner });
check("can't send a reset to a disabled user -> 400", r.status === 400);
r = await call("POST", `/api/users/${ravi.id}/status`, { token: owner, body: { isActive: true } });
check("Ravi enabled", r.status === 204 && (await login("ravi@passlab.test", "Changed@123")).status === 200);

console.log("owner: password help");
r = await call("POST", `/api/users/${ravi.id}/send-reset`, { token: owner });
check("owner sends a reset link", r.status === 200 && r.json.sent === true, r.json);
check("Ravi got it", lastMail("ravi@passlab.test")?.subject === "Reset your password");
r = await call("POST", `/api/users/${ravi.id}/password`, { token: owner, body: { password: "Temp@4321" } });
check("owner sets a temporary password", r.status === 204, r.json);
const temp = await login("ravi@passlab.test", "Temp@4321");
check("Ravi signs in with it and must change it", temp.status === 200 && temp.json.user.mustChangePassword === true, temp.json.user);
r = await call("GET", "/api/users", { token: owner });
check("owner sees the pending change", r.json.users.find((u) => u.id === ravi.id).mustChangePassword === true);
r = await call("POST", "/api/auth/change-password", { token: temp.json.accessToken, body: { currentPassword: "Temp@4321", newPassword: "Ravi@98765" } });
check("after changing, the flag clears", r.status === 200 && r.json.user.mustChangePassword === false);
r = await call("POST", `/api/users/${ownerId}/password`, { token: owner, body: { password: "Whatever@123" } });
check("can't set your own temporary password -> 400", r.status === 400);

console.log("audit");
r = await call("GET", "/api/users", { token: owner });
check("still 3 users", r.json.users.length === 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
