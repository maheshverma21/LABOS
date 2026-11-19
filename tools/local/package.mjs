// Makes a zip of the project to set up on another PC:
//   npm run package
// It contains the committed source only (no node_modules, builds, databases or
// secrets), so commit your changes first. Output: release/labos-<date>-<commit>.zip
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../../..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const dirty = git("status", "--porcelain");
if (dirty) {
  console.warn("Note: there are uncommitted changes; they are NOT in the zip:\n" + dirty.split("\n").slice(0, 10).join("\n") + "\n");
}
const sha = git("rev-parse", "--short", "HEAD");
const date = new Date().toISOString().slice(0, 10);
mkdirSync(join(root, "release"), { recursive: true });
const out = join(root, "release", `labos-${date}-${sha}.zip`);
git("archive", "--format=zip", "--prefix=labos/", "-o", out, "HEAD");
console.log(`Created ${out} (${(statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
console.log("On the other PC: unzip it, then follow SETUP-WINDOWS.md (setup.bat, then start.bat).");
