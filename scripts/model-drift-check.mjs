const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const PREMIUM_ERROR_DRIFT_LIMIT = Number(
  process.env.PREMIUM_ERROR_DRIFT_LIMIT || "0.4",
);
const FALLBACK_DRIFT_LIMIT = Number(process.env.FALLBACK_DRIFT_LIMIT || "0.08");

async function query(path) {
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Query failed (${res.status}): ${path}`);
  return res.json();
}

function avg(nums) {
  if (!nums.length) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function relativeDelta(a, b) {
  if (a == null || b == null || Math.abs(a) < 1e-9) return 0;
  return (b - a) / Math.abs(a);
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log("[drift-check] Missing Supabase env vars; skipping.");
    return;
  }
  const now = Date.now();
  const last7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const prev7 = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [premiumPrev, premiumLast, fallbackPrev, fallbackLast, attemptsPrev, attemptsLast] =
    await Promise.all([
      query(
        `premium_predictions?select=absolute_error_gbp_mwh,created_at&is_filled=eq.true&created_at=gte.${encodeURIComponent(
          prev7,
        )}&created_at=lt.${encodeURIComponent(last7)}`,
      ),
      query(
        `premium_predictions?select=absolute_error_gbp_mwh,created_at&is_filled=eq.true&created_at=gte.${encodeURIComponent(
          last7,
        )}`,
      ),
      query(
        `admin_job_log?select=created_at&job_name=eq.auth_audit&message=eq.classify_positions_model_fallback&created_at=gte.${encodeURIComponent(
          prev7,
        )}&created_at=lt.${encodeURIComponent(last7)}`,
      ),
      query(
        `admin_job_log?select=created_at&job_name=eq.auth_audit&message=eq.classify_positions_model_fallback&created_at=gte.${encodeURIComponent(
          last7,
        )}`,
      ),
      query(
        `admin_job_log?select=created_at&job_name=eq.auth_audit&message=eq.classify_positions_attempted&created_at=gte.${encodeURIComponent(
          prev7,
        )}&created_at=lt.${encodeURIComponent(last7)}`,
      ),
      query(
        `admin_job_log?select=created_at&job_name=eq.auth_audit&message=eq.classify_positions_attempted&created_at=gte.${encodeURIComponent(
          last7,
        )}`,
      ),
    ]);

  const maePrev = avg(
    premiumPrev
      .map((r) => Number(r.absolute_error_gbp_mwh))
      .filter((n) => Number.isFinite(n)),
  );
  const maeLast = avg(
    premiumLast
      .map((r) => Number(r.absolute_error_gbp_mwh))
      .filter((n) => Number.isFinite(n)),
  );
  const maeDelta = relativeDelta(maePrev, maeLast);

  const fallbackRatePrev =
    attemptsPrev.length > 0 ? fallbackPrev.length / attemptsPrev.length : 0;
  const fallbackRateLast =
    attemptsLast.length > 0 ? fallbackLast.length / attemptsLast.length : 0;
  const fallbackDelta = fallbackRateLast - fallbackRatePrev;

  const alarms = [];
  if (maeDelta > PREMIUM_ERROR_DRIFT_LIMIT) {
    alarms.push(
      `premium absolute error drift too high: ${(maeDelta * 100).toFixed(1)}%`,
    );
  }
  if (fallbackDelta > FALLBACK_DRIFT_LIMIT) {
    alarms.push(
      `classification fallback drift too high: +${(fallbackDelta * 100).toFixed(1)}pp`,
    );
  }

  const summary = {
    mae_prev: maePrev,
    mae_last: maeLast,
    mae_delta_ratio: maeDelta,
    fallback_rate_prev: fallbackRatePrev,
    fallback_rate_last: fallbackRateLast,
    fallback_delta: fallbackDelta,
    alarms,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (alarms.length > 0) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[drift-check] failed:", err);
  process.exit(1);
});

