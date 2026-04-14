const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

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

function p95(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)];
}

function splitWindows(rows, trainDays = 30, testDays = 7) {
  const windows = [];
  for (let i = 0; i + trainDays + testDays <= rows.length; i += testDays) {
    windows.push({
      train: rows.slice(i, i + trainDays),
      test: rows.slice(i + trainDays, i + trainDays + testDays),
    });
  }
  return windows;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log(
      "[walk-forward] Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY; skipping.",
    );
    return;
  }

  const rows = await query(
    "premium_predictions?select=created_at,absolute_error_gbp_mwh,is_filled&is_filled=eq.true&order=created_at.asc&limit=1000",
  );
  const points = rows
    .map((r) => ({
      created_at: r.created_at,
      abs_err: Number(r.absolute_error_gbp_mwh),
    }))
    .filter((r) => Number.isFinite(r.abs_err));

  const windows = splitWindows(points);
  const report = windows.map((w, idx) => {
    const train = w.train.map((x) => x.abs_err);
    const test = w.test.map((x) => x.abs_err);
    return {
      window: idx + 1,
      train_mae: avg(train),
      test_mae: avg(test),
      test_p95_abs_error: p95(test),
      sample_train: train.length,
      sample_test: test.length,
      test_start: w.test[0]?.created_at ?? null,
      test_end: w.test[w.test.length - 1]?.created_at ?? null,
    };
  });

  console.log("[walk-forward] Generated windows:", report.length);
  console.log(JSON.stringify({ windows: report }, null, 2));
}

main().catch((err) => {
  console.error("[walk-forward] failed:", err);
  process.exit(1);
});

