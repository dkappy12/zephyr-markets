const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const STRICT = process.env.QUALITY_GATE_STRICT === "1";

const PREMIUM_MAE_LIMIT = Number(process.env.PREMIUM_MAE_LIMIT || "25");
const FALLBACK_RATE_LIMIT = Number(process.env.CLASSIFY_FALLBACK_RATE_LIMIT || "0.15");
const ATTRIBUTION_R2_MIN = Number(process.env.ATTRIBUTION_R2_MIN || "0.05");

function fail(msg) {
  console.error(`[quality-gate] FAIL: ${msg}`);
  process.exit(1);
}

function warn(msg) {
  console.warn(`[quality-gate] WARN: ${msg}`);
}

/** Threshold breaches block the process only when QUALITY_GATE_STRICT=1. */
function failThreshold(msg) {
  if (STRICT) {
    fail(msg);
  }
  warn(`threshold (non-strict): ${msg}`);
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
    throw new Error(`Query failed (${res.status}) ${path}`);
  }
  return res.json();
}

function avg(nums) {
  if (!nums.length) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const msg = "Supabase env vars missing; skipping economic quality gate.";
    if (STRICT) fail(msg);
    warn(msg);
    return;
  }

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const sinceDate = since.slice(0, 10);

  const [premiumRows, fallbackRows, attemptRows, attributionRows] =
    await Promise.all([
      query(
        `premium_predictions?select=absolute_error_gbp_mwh,is_filled,created_at&is_filled=eq.true&created_at=gte.${encodeURIComponent(
          since,
        )}`,
      ),
      query(
        `auth_audit_log?select=event,created_at&event=eq.classify_positions_model_fallback&created_at=gte.${encodeURIComponent(
          since,
        )}`,
      ),
      query(
        `auth_audit_log?select=event,created_at&event=eq.classify_positions_attempted&created_at=gte.${encodeURIComponent(
          since,
        )}`,
      ),
      query(
        `portfolio_pnl?select=date,attribution_json&date=gte.${sinceDate}&order=date.desc&limit=200`,
      ),
    ]);

  const mae = avg(
    premiumRows
      .map((r) => Number(r.absolute_error_gbp_mwh))
      .filter((n) => Number.isFinite(n)),
  );
  if (mae != null && mae > PREMIUM_MAE_LIMIT) {
    failThreshold(
      `premium MAE ${mae.toFixed(2)} > ${PREMIUM_MAE_LIMIT}`,
    );
  }

  const attempts = attemptRows.length;
  const fallbackRate = attempts > 0 ? fallbackRows.length / attempts : 0;
  if (attempts > 0 && fallbackRate > FALLBACK_RATE_LIMIT) {
    failThreshold(
      `classification fallback rate ${(fallbackRate * 100).toFixed(1)}% > ${(
        FALLBACK_RATE_LIMIT * 100
      ).toFixed(1)}%`,
    );
  }

  const r2Values = attributionRows
    .map((r) => {
      const j = r.attribution_json ?? {};
      const d = j.diagnostics ?? {};
      return Number(d.calibration_r2);
    })
    .filter((n) => Number.isFinite(n));
  const medianR2 = r2Values.length
    ? r2Values.sort((a, b) => a - b)[Math.floor(r2Values.length / 2)]
    : null;
  if (medianR2 != null && medianR2 < ATTRIBUTION_R2_MIN) {
    failThreshold(
      `attribution median R2 ${medianR2.toFixed(3)} < ${ATTRIBUTION_R2_MIN}`,
    );
  }

  console.log("[quality-gate] PASS");
  console.log(
    JSON.stringify(
      {
        premium_mae: mae,
        fallback_rate: fallbackRate,
        attempts,
        attribution_median_r2: medianR2,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  if (STRICT) fail(err instanceof Error ? err.message : String(err));
  warn(err instanceof Error ? err.message : String(err));
});

