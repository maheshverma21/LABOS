// API test runner: starts an in-memory Postgres (PGlite) and Redis stand-in,
// migrates and seeds the demo lab, starts the API, runs tests/api/*.test.mjs
// one by one, then stops everything. No cloud services or Docker needed.
//
//   npm run test:api                 # all tests
//   npm run test:api -- samples      # files whose name contains "samples"
//   npm run test:api -- --prod       # production builds: built API (NODE_ENV=production)
//                                    # behind the built Next.js server, tests sent through its /api proxy
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { startMiniRedis } from "./mini-redis.mjs";

const root = resolve(fileURLToPath(import.meta.url), "../../..");
const apiDir = join(root, "apps/api");
const testsDir = join(root, "tests/api");
const PG_PORT = 55499;
const REDIS_PORT = 56390;
const API_PORT = 54000;
const WEB_PORT = 54001;
// tests/api/reports.test.mjs runs a stand-in for AiSensy here.
const AISENSY_MOCK_PORT = 54100;

// PGlite has one backend, so Prisma must not use named prepared statements (pgbouncer=true).
const dbUrl = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres?sslmode=disable&connection_limit=1&pgbouncer=true`;
const env = {
  ...process.env,
  NODE_ENV: "test",
  PORT: String(API_PORT),
  WEB_ORIGIN: "http://localhost:3000",
  DATABASE_URL: dbUrl,
  DIRECT_URL: dbUrl,
  REDIS_URL: `redis://127.0.0.1:${REDIS_PORT}`,
  JWT_ACCESS_SECRET: "test-only-secret-test-only-secret-1234567890",
  ACCESS_TOKEN_TTL: "900",
  REFRESH_TOKEN_TTL_DAYS: "30",
  // Report links point straight at the API so tests can fetch the WhatsApp media URL.
  PUBLIC_BASE_URL: `http://127.0.0.1:${API_PORT}`,
  AISENSY_API_URL: `http://127.0.0.1:${AISENSY_MOCK_PORT}/campaign`,
  AISENSY_API_KEY: "platform-key",
  AISENSY_CAMPAIGN: "shared_lab_report",
  // Emails are written here so tests can read reset links; two-step sign-in is enforced as in production.
  MAIL_DIR: join(root, ".test-mail"),
  ADMIN_MFA_REQUIRED: "true",
};
rmSync(env.MAIL_DIR, { recursive: true, force: true });

function run(cmd, args, opts = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd: apiDir, env, stdio: "inherit", shell: process.platform === "win32", ...opts });
    p.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(" ")} exited with ${code}`))));
  });
}

async function waitForApi() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${API_PORT}/api/health`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("API did not start");
}

const prod = process.argv.includes("--prod");
const filter = process.argv.slice(2).find((a) => !a.startsWith("--"));
const webDir = join(root, "apps/web");
const files = readdirSync(testsDir)
  .filter((f) => f.endsWith(".test.mjs") && (!filter || f.includes(filter)))
  .sort();

const db = await PGlite.create();
const pg = new PGLiteSocketServer({ db, port: PG_PORT, host: "127.0.0.1", maxConnections: 20 });
await pg.start();
const redis = await startMiniRedis(REDIS_PORT);
let api;
let web;
let failed = 0;

try {
  console.log("Migrating and seeding a fresh in-memory database...");
  await run("npx", ["prisma", "migrate", "deploy"], { stdio: "ignore" });
  await run("npx", ["tsx", "prisma/seed.ts"], { stdio: "ignore" });

  let base = `http://127.0.0.1:${API_PORT}`;
  if (prod) {
    console.log("Building the API and the web app for production...");
    await run("npm", ["run", "build"], { stdio: "ignore" });
    await run("npm", ["run", "build"], {
      cwd: webDir,
      stdio: "ignore",
      env: { ...env, NODE_ENV: "production", NEXT_STANDALONE: "1", API_URL: `http://127.0.0.1:${API_PORT}` },
    });
    // As deployed: production mode behind the Next.js proxy (the test client plays Caddy, setting X-Forwarded-For).
    const prodEnv = { ...env, NODE_ENV: "production", TRUST_PROXY: "1" };
    api = spawn("node", ["dist/index.js"], { cwd: apiDir, env: prodEnv, stdio: "ignore" });
    await waitForApi();
    web = spawn("node", [join(webDir, ".next/standalone/apps/web/server.js")], {
      cwd: join(webDir, ".next/standalone"),
      env: { ...prodEnv, PORT: String(WEB_PORT), HOSTNAME: "127.0.0.1" },
      stdio: "ignore",
    });
    base = `http://127.0.0.1:${WEB_PORT}`;
    for (let i = 0; i < 60; i++) {
      const ok = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log("Production servers up; tests go through the web app's /api proxy.");
  } else {
    api = spawn("npx", ["tsx", "src/index.ts"], { cwd: apiDir, env, stdio: process.env.API_LOG ? "inherit" : "ignore", shell: process.platform === "win32" });
    await waitForApi();
  }

  for (const f of files) {
    console.log(`\n=== ${f}`);
    try {
      await run("node", [join(testsDir, f)], { cwd: root, env: { ...env, BASE: base, AISENSY_MOCK_PORT: String(AISENSY_MOCK_PORT) } });
    } catch {
      failed++;
    }
  }
} finally {
  for (const p of [api, web]) {
    if (!p) continue;
    // Wait for taskkill: exiting first would leave the server running.
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore" });
    else p.kill();
  }
  redis.close();
  await pg.stop();
}

console.log(failed ? `\n${failed} of ${files.length} test files failed` : `\nAll ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
