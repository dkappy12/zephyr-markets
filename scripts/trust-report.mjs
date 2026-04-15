/**
 * Aggregates benchmark reconcile, economic quality gate, and optional drift / walk-forward
 * into a Markdown report (stdout or --out path). See docs/self-improvement-assurance.md.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function runNodeCapture(scriptName, extraEnv = {}) {
  const script = join(__dirname, scriptName);
  try {
    const stdout = execFileSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
    });
    return { ok: true, stdout: stdout.trim(), code: 0 };
  } catch (e) {
    const err = e;
    return {
      ok: false,
      stdout: (err.stdout && String(err.stdout).trim()) || "",
      stderr: (err.stderr && String(err.stderr).trim()) || "",
      code: err.status ?? 1,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function hasSupabaseGateEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function main() {
  const args = process.argv.slice(2);
  let outPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) {
      outPath = args[i + 1];
      i++;
    }
  }

  const lines = [];
  const stamp = new Date().toISOString();
  lines.push("# Zephyr trust report");
  lines.push("");
  lines.push(`Generated: ${stamp}`);
  lines.push("");

  lines.push("## Benchmark reconcile (`quality:reconcile`)");
  lines.push("");
  const rec = runNodeCapture("model-benchmark-reconcile.mjs");
  lines.push(rec.ok ? "```json" : "```");
  lines.push(rec.ok ? rec.stdout : rec.stdout || rec.message);
  if (!rec.ok && rec.stderr) lines.push(rec.stderr);
  lines.push("```");
  if (!rec.ok) lines.push(`_Exit code ${rec.code}_`);
  lines.push("");

  lines.push("## Economic quality gate (`quality:gate`)");
  lines.push("");
  if (!hasSupabaseGateEnv()) {
    lines.push("_Skipped — set `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY`._");
  } else {
    const gate = runNodeCapture("model-quality-gate.mjs", {
      QUALITY_GATE_STRICT: "0",
    });
    lines.push("```");
    lines.push(gate.ok ? gate.stdout : gate.stdout || gate.message);
    if (!gate.ok && gate.stderr) lines.push(gate.stderr);
    lines.push("```");
    if (!gate.ok) lines.push(`_Exit code ${gate.code} — thresholds may be breached or query failed._`);
  }
  lines.push("");

  lines.push("## Drift check (`quality:drift`)");
  lines.push("");
  if (!hasSupabaseGateEnv()) {
    lines.push("_Skipped — same Supabase env as gate._");
  } else {
    const drift = runNodeCapture("model-drift-check.mjs");
    lines.push("```");
    lines.push(drift.ok ? drift.stdout : drift.stdout || drift.message);
    if (!drift.ok && drift.stderr) lines.push(drift.stderr);
    lines.push("```");
    if (drift.code === 2) {
      lines.push("_Exit code 2 — drift alarms present (see JSON above)._");
    } else if (!drift.ok) {
      lines.push(`_Exit code ${drift.code}_`);
    }
  }
  lines.push("");

  lines.push("## Walk-forward (`quality:walk-forward`)");
  lines.push("");
  if (!hasSupabaseGateEnv()) {
    lines.push("_Skipped — same Supabase env as gate._");
  } else {
    const wf = runNodeCapture("model-walk-forward-report.mjs");
    lines.push("```");
    lines.push(wf.ok ? wf.stdout : wf.stdout || wf.message);
    if (!wf.ok && wf.stderr) lines.push(wf.stderr);
    lines.push("```");
    if (!wf.ok) lines.push(`_Exit code ${wf.code}_`);
  }
  lines.push("");

  lines.push("## Release notes");
  lines.push("");
  lines.push("- Paste this artifact into the release train record.");
  lines.push("- If gate failed, investigate thresholds in `docs/self-improvement-assurance.md` before shipping.");

  const md = lines.join("\n");
  console.log(md);
  if (outPath) {
    writeFileSync(outPath, md, "utf8");
    console.error(`[trust-report] wrote ${outPath}`);
  }

  if (!rec.ok) process.exit(1);
}

main();
