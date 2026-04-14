/**
 * Local "all quality checks" runner: benchmark reconcile (always), then
 * economic quality gate when Supabase env vars are present (same as CI).
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function runNode(scriptName) {
  const script = join(__dirname, scriptName);
  execFileSync(process.execPath, [script], { stdio: "inherit" });
}

function hasGateEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

console.error("[quality-ci] 1/2 benchmark reconcile (no secrets required)…");
runNode("model-benchmark-reconcile.mjs");

if (hasGateEnv()) {
  console.error("[quality-ci] 2/2 economic quality gate (Supabase metrics)…");
  runNode("model-quality-gate.mjs");
} else {
  console.warn(
    "[quality-ci] skip quality:gate — set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY for live metric checks.",
  );
}

console.error("[quality-ci] done.");
