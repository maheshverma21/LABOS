// Run the built app on one PC, with no cloud services:
//   npm run start:local            (builds first if needed)
//   npm run start:local -- --demo  (also adds the demo lab and users)
//
// The database is PGlite (Postgres compiled to WebAssembly) kept in .local-data/,
// Redis is a small in-memory stand-in. Fine for one lab on one PC, a pilot or a
// demo. For many labs, use the Docker setup in deploy/ with real Postgres.
//
// Back up by copying the .local-data folder while the app is stopped.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { startMiniRedis } from "../test-stack/mini-redis.mjs";

const root = resolve(fileURLToPath(import.meta.url), "../../..");
const apiDir = join(root, "apps/api");
const webDir = join(root, "apps/web");
const dataDir = resolve(process.env.LMS_DATA_DIR ?? join(root, ".local-data"));
const demo = process.argv.includes("--demo");
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
// Fixed: the web app's /api proxy target is set when it is built.
const API_PORT = 4000;
const PG_PORT = 55433;
const REDIS_PORT = 56380;
const shell = process.platform === "win32";

function run(cmd, args, cwd, env, quiet = false) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd, env, stdio: quiet ? "ignore" : "inherit", shell });
    p.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(" ")} exited with ${code}`))));
  });
}

// Secrets are made once per PC and kept with the data, so sign-ins and saved
// WhatsApp keys survive restarts. Keep this folder private.
mkdirSync(dataDir, { recursive: true });
const secretsFile = join(dataDir, "secrets.json");
if (!existsSync(secretsFile)) {
  writeFileSync(
    secretsFile,
    JSON.stringify({ jwt: randomBytes(48).toString("base64url"), secrets: randomBytes(48).toString("base64url") }, null, 2),
  );
}
const secrets = JSON.parse(readFileSync(secretsFile, "utf8"));

const dbUrl = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres?sslmode=disable&connection_limit=1&pgbouncer=true`;
const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(API_PORT),
  WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
  API_URL: `http://127.0.0.1:${API_PORT}`,
  DATABASE_URL: dbUrl,
  DIRECT_URL: dbUrl,
  REDIS_URL: `redis://127.0.0.1:${REDIS_PORT}`,
  JWT_ACCESS_SECRET: secrets.jwt,
  SECRETS_KEY: secrets.secrets,
  // Plain http on a local network: cookies can't be HTTPS-only here.
  COOKIE_SECURE: "false",
  // Two-step sign-in for the platform admin console is optional on a single PC.
  ADMIN_MFA_REQUIRED: process.env.ADMIN_MFA_REQUIRED ?? "false",
  // Emails are saved here unless SMTP_URL is set.
  MAIL_DIR: process.env.SMTP_URL ? "" : join(dataDir, "mail"),
};

// 1. Build once (and again after an update).
const built = existsSync(join(apiDir, "dist/index.js")) && existsSync(join(webDir, ".next/BUILD_ID"));
if (!built || process.argv.includes("--rebuild")) {
  console.log("Building the app (a few minutes the first time)...");
  await run("npm", ["run", "build"], root, { ...env, NODE_ENV: "production" });
}

// 2. Database and Redis.
const dbDir = join(dataDir, "db");
const fresh = !existsSync(dbDir);
mkdirSync(dbDir, { recursive: true });
const db = await PGlite.create(dbDir);
const pg = new PGLiteSocketServer({ db, port: PG_PORT, host: "127.0.0.1", maxConnections: 20 });
await pg.start();
const redis = await startMiniRedis(REDIS_PORT);

console.log(fresh ? "Creating a new database..." : `Using the database in ${dataDir}`);
await run("npx", ["prisma", "migrate", "deploy"], apiDir, env, true);
if (demo) {
  console.log("Adding the demo lab (owner@demo-lab.test, password Demo@12345)...");
  // The seed refuses to run in production mode, which is right for real servers.
  await run("npx", ["tsx", "prisma/seed.ts"], apiDir, { ...env, NODE_ENV: "development" }, true);
}

// 3. API and web.
const api = spawn("node", ["dist/index.js"], { cwd: apiDir, env, stdio: ["ignore", "ignore", "inherit"] });
const web = spawn("npx", ["next", "start", "-p", String(WEB_PORT), "-H", "0.0.0.0"], { cwd: webDir, env, stdio: ["ignore", "ignore", "inherit"], shell });

for (let i = 0; i < 120; i++) {
  const ok = await fetch(`http://127.0.0.1:${WEB_PORT}/api/health`).then((r) => r.ok).catch(() => false);
  if (ok) break;
  await new Promise((r) => setTimeout(r, 500));
}

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => `http://${a.address}:${WEB_PORT}`);
console.log(`
LabOS is running.
  On this PC:            http://localhost:${WEB_PORT}
${lan.map((u) => `  On the same network:   ${u}`).join("\n")}
  Admin console:         http://localhost:${WEB_PORT}/admin
  Data:                  ${dataDir}
${fresh && !demo ? "\n  New database: open the link and use \"Create an account\" to set up your lab.\n" : ""}
Keep this window open. Press Ctrl+C to stop.
`);
if (shell && !process.env.NO_BROWSER) spawn("cmd", ["/c", "start", "", `http://localhost:${WEB_PORT}`], { stdio: "ignore", detached: true });

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  console.log("Stopping...");
  for (const p of [api, web]) {
    if (shell) spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore" });
    else p.kill();
  }
  redis.close();
  await pg.stop();
  await db.close();
  process.exit(0);
}
// `npm run dev:stop` from another window asks for a clean shutdown too.
const stopFile = join(root, ".dev-stop");
rmSync(stopFile, { force: true });
setInterval(() => {
  if (existsSync(stopFile)) {
    rmSync(stopFile, { force: true });
    void stop();
  }
}, 1000).unref();
process.on("SIGINT", stop);
// Closing the console window on Windows: still shut the database down cleanly.
process.on("SIGHUP", stop);
process.on("SIGTERM", stop);
api.on("exit", (code) => {
  if (!stopping) console.error(`The API stopped (exit ${code}). Run start again; if it keeps happening, run it with --rebuild.`);
  void stop();
});
web.on("exit", () => void stop());
