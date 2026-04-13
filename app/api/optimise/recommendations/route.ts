import { optimisePortfolio, buildHistoricalScenarios, stressScenarios, ttfEurMwhToNbpPth, type OptimiseObjective } from "@/lib/portfolio/optimise";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function parseDateOnly(v: string | null): string | null {
  if (!v) return null;
  return v.slice(0, 10);
}

function parseNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function addDailySample(
  map: Record<string, { sum: number; count: number }>,
  day: string,
  value: number,
) {
  const existing = map[day];
  if (existing) {
    existing.sum += value;
    existing.count += 1;
    return;
  }
  map[day] = { sum: value, count: 1 };
}

function finaliseDailyAverage(
  map: Record<string, { sum: number; count: number }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [day, agg] of Object.entries(map)) {
    if (agg.count > 0) out[day] = agg.sum / agg.count;
  }
  return out;
}

async function fetchGbpPerEur(): Promise<number> {
  try {
    const resp = await fetch(
      "https://api.frankfurter.app/latest?from=EUR&to=GBP",
      { next: { revalidate: 3600 } },
    );
    if (!resp.ok) return 0.86;
    const body = (await resp.json()) as { rates?: { GBP?: number } };
    return body.rates?.GBP && Number.isFinite(body.rates.GBP) ? body.rates.GBP : 0.86;
  } catch {
    return 0.86;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const objectiveRaw = (url.searchParams.get("objective") ?? "cvar").toLowerCase();
    const objective: OptimiseObjective =
      objectiveRaw === "var" ? "var" : "cvar";
    const confidence = Math.min(
      0.99,
      Math.max(0.9, Number(url.searchParams.get("confidence") ?? "0.95")),
    );
    const maxTrades = Math.min(
      4,
      Math.max(1, Number(url.searchParams.get("maxTrades") ?? "3")),
    );
    const includeStress =
      (url.searchParams.get("includeStress") ?? "true").toLowerCase() !== "false";

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const since = new Date();
    since.setDate(since.getDate() - 120);
    const sinceDate = since.toISOString().slice(0, 10);

    const [positionsRes, powerRes, gasRes] = await Promise.all([
      supabase
        .from("positions")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_closed", false),
      supabase
        .from("market_prices")
        .select("price_date, price_gbp_mwh, market")
        .or("market.eq.N2EX,market.eq.APX")
        .gte("price_date", sinceDate)
        .order("price_date", { ascending: true }),
      supabase
        .from("gas_prices")
        .select("price_time, ttf_eur_mwh")
        .gte("price_time", `${sinceDate}T00:00:00`)
        .order("price_time", { ascending: true }),
    ]);

    if (positionsRes.error || powerRes.error || gasRes.error) {
      return NextResponse.json(
        {
          error:
            positionsRes.error?.message ??
            powerRes.error?.message ??
            gasRes.error?.message ??
            "Failed loading optimise data",
        },
        { status: 500 },
      );
    }

    const gbpPerEur = await fetchGbpPerEur();
    const powerAgg: Record<string, { sum: number; count: number }> = {};
    for (const row of powerRes.data ?? []) {
      const day = parseDateOnly(row.price_date);
      const px = parseNum(row.price_gbp_mwh);
      if (!day || px == null) continue;
      addDailySample(powerAgg, day, px);
    }

    const ttfAgg: Record<string, { sum: number; count: number }> = {};
    const nbpAgg: Record<string, { sum: number; count: number }> = {};
    for (const row of gasRes.data ?? []) {
      const day = parseDateOnly(row.price_time);
      const ttf = parseNum(row.ttf_eur_mwh);
      if (!day || ttf == null) continue;
      addDailySample(ttfAgg, day, ttf);
      addDailySample(nbpAgg, day, ttfEurMwhToNbpPth(ttf, gbpPerEur));
    }
    const powerByDay = finaliseDailyAverage(powerAgg);
    const ttfByDay = finaliseDailyAverage(ttfAgg);
    const nbpByDay = finaliseDailyAverage(nbpAgg);

    const scenarios = [
      ...buildHistoricalScenarios({
        powerByDay,
        ttfByDayEur: ttfByDay,
        nbpByDayPth: nbpByDay,
      }),
      ...stressScenarios(),
    ];

    const result = optimisePortfolio({
      positions: positionsRes.data ?? [],
      scenarios,
      gbpPerEur,
      objective,
      confidence,
      maxTrades,
      includeStress,
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      objective,
      confidence,
      maxTrades,
      includeStress,
      gbpPerEur,
      ...result,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
