#!/usr/bin/env node
/**
 * Data-health regression check.
 *
 * Fails CI if any row appears in `gas_prices` or `carbon_prices` that
 * violates the same write-time sanity ranges enforced by the ingestion
 * agent (`python-agents/ingestion-agent/main.py`) and the app-layer
 * aggregator (`lib/portfolio/gas-aggregate.ts`). Catches the class of
 * bug that produced the 2026-04 "Yahoo Finance / TTF-derived" 342-row
 * artefact: someone running an ad-hoc backfill (a Jupyter notebook,
 * a CSV upload via Supabase Studio, a one-off Python script) with
 * broken conversion math that lands silently-wrong values into the DB
 * and then slips past every other defense because the ingestion path
 * it bypasses can't see it.
 *
 * Thresholds intentionally match — and must be kept in sync with —
 * the ingestion constants (NBP_SANITY_MIN_PTH, EUA_SANITY_MIN_EUR_T,
 * etc.) and the app floors (NBP_LEVEL_FLOOR_PTH, TTF_LEVEL_FLOOR_EUR_MWH).
 * If any of them drift, update this script in the same commit.
 *
 * Behaviour:
 *   - No Supabase creds in env -> emit a GitHub annotation and exit 0
 *     (same pattern as model-quality-gate.mjs; keeps forks/PR-from-fork
 *     CI green without leaking secrets).
 *   - DATA_HEALTH_STRICT=1 -> any violation exits with code 1.
 *   - DATA_HEALTH_STRICT unset/0 -> violations are WARN-logged as GitHub
 *     annotations but CI still passes (prevents a legacy bad row from
 *     wedging merges while the team is triaging).
 *
 * Ignores rows that were already soft-quarantined by flipping their
 * hub to a `*_DEPRECATED_*` label (that's how we killed the 342-row
 * backfill on 2026-04-21).
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const STRICT = process.env.DATA_HEALTH_STRICT === "1";

const NBP_MIN_PTH = 30;
const NBP_MAX_PTH = 300;
const TTF_MIN_EUR_MWH = 10;
const TTF_MAX_EUR_MWH = 300;
const EUA_MIN_EUR_T = 5;
const EUA_MAX_EUR_T = 300;
const UKA_MIN_GBP_T = 5;
const UKA_MAX_GBP_T = 300;

function ghAnnotate(kind, title, msg) {
  /** Emit a GitHub Actions annotation so violations render in the PR UI. */
  const level = kind === "error" ? "error" : "warning";
  console.log(`::${level} title=${title}::${msg}`);
}

function fail(title, msg) {
  ghAnnotate("error", title, msg);
  console.error(`[data-health] FAIL: ${title} — ${msg}`);
  process.exit(1);
}

function warn(title, msg) {
  ghAnnotate("warning", title, msg);
  console.warn(`[data-health] WARN: ${title} — ${msg}`);
}

function report(title, msg) {
  if (STRICT) fail(title, msg);
  else warn(title, msg);
}

async function query(path) {
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(
      `Supabase query failed (${res.status}): ${path} — ${await res
        .text()
        .catch(() => "")}`,
    );
  }
  return res.json();
}

async function checkGasPrices() {
  /**
   * gas_prices stores TTF in €/MWh and NBP in pence/therm (see the
   * comment in aggregateDailyGasPrices). Filter on the active hub
   * value so soft-quarantined rows (hub = '*_DEPRECATED_*') do not
   * trigger this check.
   */
  const violations = [];

  const nbpBad = await query(
    `gas_prices?hub=eq.NBP&or=(price_eur_mwh.lt.${NBP_MIN_PTH},price_eur_mwh.gt.${NBP_MAX_PTH})&select=price_time,price_eur_mwh,source&limit=20`,
  );
  if (nbpBad.length > 0) {
    violations.push({
      hub: "NBP",
      range: `[${NBP_MIN_PTH}, ${NBP_MAX_PTH}] p/th`,
      samples: nbpBad,
    });
  }

  const ttfBad = await query(
    `gas_prices?hub=eq.TTF&or=(price_eur_mwh.lt.${TTF_MIN_EUR_MWH},price_eur_mwh.gt.${TTF_MAX_EUR_MWH})&select=price_time,price_eur_mwh,source&limit=20`,
  );
  if (ttfBad.length > 0) {
    violations.push({
      hub: "TTF",
      range: `[${TTF_MIN_EUR_MWH}, ${TTF_MAX_EUR_MWH}] €/MWh`,
      samples: ttfBad,
    });
  }

  return violations;
}

async function checkCarbonPrices() {
  const violations = [];

  const euaBad = await query(
    `carbon_prices?hub=eq.EUA&or=(price_eur_per_t.lt.${EUA_MIN_EUR_T},price_eur_per_t.gt.${EUA_MAX_EUR_T})&select=price_date,price_eur_per_t,price_gbp_per_t,source&limit=20`,
  );
  if (euaBad.length > 0) {
    violations.push({
      hub: "EUA",
      range: `[${EUA_MIN_EUR_T}, ${EUA_MAX_EUR_T}] €/t`,
      samples: euaBad,
    });
  }

  const ukaBad = await query(
    `carbon_prices?hub=eq.UKA&or=(price_gbp_per_t.lt.${UKA_MIN_GBP_T},price_gbp_per_t.gt.${UKA_MAX_GBP_T})&select=price_date,price_gbp_per_t,source&limit=20`,
  );
  if (ukaBad.length > 0) {
    violations.push({
      hub: "UKA",
      range: `[${UKA_MIN_GBP_T}, ${UKA_MAX_GBP_T}] £/t`,
      samples: ukaBad,
    });
  }

  return violations;
}

function describeViolation(v) {
  const n = v.samples.length;
  const head = v.samples[0];
  const priceField =
    v.hub === "EUA"
      ? `${head.price_eur_per_t} €/t`
      : v.hub === "UKA"
        ? `${head.price_gbp_per_t} £/t`
        : `${head.price_eur_mwh} ${v.hub === "NBP" ? "p/th" : "€/MWh"}`;
  const dateField = head.price_time ?? head.price_date ?? "unknown";
  return (
    `${n}+ ${v.hub} rows outside sanity range ${v.range}. ` +
    `Example: ${priceField} on ${dateField} from source="${head.source}". ` +
    `Run the quarantine UPDATE (flip hub to ${v.hub}_DEPRECATED_<reason>) ` +
    `after root-causing the writer.`
  );
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    ghAnnotate(
      "warning",
      "Data-health check",
      "Skipped — no Supabase URL + service role in env (expected for fork PRs). " +
        "Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the canonical " +
        "repo to enable strict regression checks on every merge.",
    );
    return;
  }

  let violations = [];
  try {
    const [gas, carbon] = await Promise.all([
      checkGasPrices(),
      checkCarbonPrices(),
    ]);
    violations = [...gas, ...carbon];
  } catch (err) {
    /**
     * Transient Supabase failures shouldn't permanently block the queue.
     * Log loudly but don't fail the build unless we're in strict mode —
     * the next run will re-check.
     */
    report(
      "Data-health check infra error",
      `Could not reach Supabase: ${err.message}. Check service-role key and URL.`,
    );
    return;
  }

  if (violations.length === 0) {
    console.log(
      `[data-health] OK: no rows outside sanity ranges in gas_prices or carbon_prices.`,
    );
    return;
  }

  for (const v of violations) {
    report(`Data-health: ${v.hub} out of range`, describeViolation(v));
  }
  if (!STRICT) {
    console.warn(
      `[data-health] ${violations.length} violation group(s) logged as warnings. ` +
        `Set DATA_HEALTH_STRICT=1 to fail the build on violations.`,
    );
  }
}

main().catch((err) => {
  console.error(`[data-health] Uncaught error: ${err.stack || err.message}`);
  process.exit(STRICT ? 1 : 0);
});
