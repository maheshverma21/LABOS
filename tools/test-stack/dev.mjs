// Run the whole app on this machine with no cloud services:
//   npm run dev:local
// Postgres is PGlite (Postgres compiled to WebAssembly) saved in .local-db/,
// Redis is a small in-memory stand-in. Good for trying things out and for
// development; use real Postgres and Redis (see README) for anything else.
// Delete .local-db/ to start again from a fresh demo lab.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { startMiniRedis } from "./mini-redis.mjs";

const root = resolve(fileURLToPath(import.meta.url), "../../..");
const apiDir = join(root, "apps/api");
const dataDir = join(root, ".local-db");
const PG_PORT = 55432;
const REDIS_PORT = 56379;

const dbUrl = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres?sslmode=disable&connection_limit=1&pgbouncer=true`;
const env = {
  ...process.env,
  NODE_ENV: "development",
  WEB_ORIGIN: "http://localhost:3000",
  API_URL: "http://localhost:4000",
  DATABASE_URL: dbUrl,
  DIRECT_URL: dbUrl,
  REDIS_URL: `redis://127.0.0.1:${REDIS_PORT}`,
  JWT_ACCESS_SECRET: "local-dev-only-secret-local-dev-only-secret",
  ACCESS_TOKEN_TTL: "900",
  REFRESH_TOKEN_TTL_DAYS: "30",
  // Emails (e.g. password resets) are saved as files here instead of being sent.
  MAIL_DIR: join(root, ".local-mail"),
};
const shell = process.platform === "win32";

function run(cmd, args, cwd) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd, env, stdio: "inherit", shell });
    p.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(" ")} exited with ${code}`))));
  });
}

const fresh = !existsSync(dataDir);
mkdirSync(dataDir, { recursive: true });
const db = await PGlite.create(dataDir);
const pg = new PGLiteSocketServer({ db, port: PG_PORT, host: "127.0.0.1", maxConnections: 20 });
await pg.start();
const redis = await startMiniRedis(REDIS_PORT);

console.log(fresh ? "Creating a local database with a demo lab..." : "Using the local database in .local-db/");
await run("npx", ["prisma", "migrate", "deploy"], apiDir);
await run("npx", ["tsx", "prisma/seed.ts"], apiDir);
console.log("\nOpen http://localhost:3000 and sign in as owner@demo-lab.test (password in apps/api/prisma/seed.ts).\n");

// API and web with reload, from the repo's normal dev script.
const app = spawn("npm", ["run", "dev"], { cwd: root, env, stdio: "inherit", shell });

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (shell) spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
  else app.kill();
  redis.close();
  await pg.stop();
  await db.close();
  process.exit(0);
}
// `npm run dev:stop` drops this file to ask for a clean shutdown: a hard kill can
// leave the PGlite database unreadable.
const stopFile = join(root, ".dev-stop");
rmSync(stopFile, { force: true });
setInterval(() => {
  if (existsSync(stopFile)) {
    rmSync(stopFile, { force: true });
    console.log("Stopping cleanly...");
    void stop();
  }
}, 1000).unref();
process.on("SIGINT", stop);
// Closing the console window on Windows: still shut the database down cleanly.
process.on("SIGHUP", stop);
process.on("SIGTERM", stop);
app.on("exit", stop);
