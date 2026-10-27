// Runs the OFFICIAL Meterless eval runner (evals/runner/index.ts, vendored unmodified)
// against this Scout implementation. Cross-platform: sets SCOUT_IMPL itself.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const filter = args[0] ?? "all";
const env = { ...process.env, SCOUT_IMPL: resolve(root, "src", "index.ts") };
const r = spawnSync(
  process.execPath,
  ["--import", "tsx", resolve(root, "evals", "runner", "index.ts"), filter],
  { cwd: root, env, stdio: "inherit" },
);
process.exit(r.status ?? 1);
