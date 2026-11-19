// Single entry point for Hostinger Node.js hosting (and any host that runs ONE node process).
// Hostinger gives the app one public PORT. This launcher:
//   1. applies database migrations (prisma migrate deploy)
//   2. starts the API privately on 127.0.0.1:4000
//   3. starts the Next.js web app on the public PORT (it proxies /api/* to the API)
// Start command on Hostinger:  node hostinger/server.js
const { spawn, spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const apiDir = join(root, "apps/api");
const webDir = join(root, "apps/web");
const PUBLIC_PORT = process.env.PORT || "3000";
const API_PORT = "4000"; // must match API_URL used at build time (see HOSTINGER.md)

// Hostinger's panel injects env vars; a local .env at the project root is also read for testing.
if (existsSync(join(root, ".env"))) {
  try { process.loadEnvFile(join(root, ".env")); } catch {}
}
process.env.NODE_ENV = "production";
if (!process.env.DIRECT_URL) process.env.DIRECT_URL = process.env.DATABASE_URL;

const need = ["DATABASE_URL", "REDIS_URL", "JWT_ACCESS_SECRET", "WEB_ORIGIN"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing environment variables: " + missing.join(", ") + ". See hostinger/.env.example");
  process.exit(1);
}

const bin = (pkg, rel) => join(root, "node_modules", pkg, rel);
const prismaCli = existsSync(bin("prisma", "build/index.js")) ? bin("prisma", "build/index.js") : null;

if (prismaCli && process.env.SKIP_MIGRATE !== "1") {
  console.log("Applying database migrations...");
  const m = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: apiDir, env: process.env, stdio: "inherit",
  });
  if (m.status !== 0) {
    console.error("Migration failed. Check DATABASE_URL / DIRECT_URL.");
    process.exit(1);
  }
}

const api = spawn(process.execPath, ["dist/index.js"], {
  cwd: apiDir,
  env: { ...process.env, PORT: API_PORT },
  stdio: "inherit",
});

const nextBin = existsSync(join(webDir, "node_modules/next/dist/bin/next"))
  ? join(webDir, "node_modules/next/dist/bin/next")
  : bin("next", "dist/bin/next");
const web = spawn(process.execPath, [nextBin, "start", "-p", PUBLIC_PORT, "-H", "0.0.0.0"], {
  cwd: webDir,
  env: process.env,
  stdio: "inherit",
});

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  api.kill();
  web.kill();
  setTimeout(() => process.exit(code), 500);
}
api.on("exit", (c) => { console.error("API exited with " + c); stop(1); });
web.on("exit", (c) => { console.error("Web exited with " + c); stop(1); });
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
