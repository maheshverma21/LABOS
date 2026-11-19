// Creates a platform admin (for /admin) in the local one-PC setup.
// LabOS must be running (start.bat) in another window:
//   npm run admin:local -- you@example.com "Your Name"
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../../..");
const dataDir = resolve(process.env.LMS_DATA_DIR ?? join(root, ".local-data"));
const secretsFile = join(dataDir, "secrets.json");
if (!existsSync(secretsFile)) {
  console.error("No local data yet. Start LabOS once with start.bat first.");
  process.exit(1);
}
const secrets = JSON.parse(readFileSync(secretsFile, "utf8"));
const dbUrl = "postgresql://postgres:postgres@127.0.0.1:55433/postgres?sslmode=disable&connection_limit=1&pgbouncer=true";

const p = spawn("npx", ["tsx", "scripts/create-admin.ts", ...process.argv.slice(2)], {
  cwd: join(root, "apps/api"),
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: dbUrl,
    DIRECT_URL: dbUrl,
    REDIS_URL: "redis://127.0.0.1:56380",
    JWT_ACCESS_SECRET: secrets.jwt,
    SECRETS_KEY: secrets.secrets,
  },
});
p.on("exit", (code) => {
  if (code) console.error("\nIs LabOS running? Start it with start.bat in another window, then try again.");
  process.exit(code ?? 1);
});
