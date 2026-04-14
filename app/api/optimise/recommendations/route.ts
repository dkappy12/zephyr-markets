import { optimisePortfolio, buildHistoricalScenarios, stressScenarios, type OptimiseObjective } from "@/lib/portfolio/optimise";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { requireUser } from "@/lib/auth/require-user";
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

function isMissingFxTableError(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("fx_rates") && (m.includes("does not exist") || m.includes("schema cache"));
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

function optimiserQuality(input: {
  historicalScenarioCount: number;
  candidatePackageCount: number;
  fallbackUsed: boolean;
  nbpProxyUsed: boolean;
  stabilityPass: boolean;
}): { quality: "high" | "medium" | "low"; warnings: string[] } {
  const warnings: string[] = [];
  if (input.fallbackUsed) {
    warnings.push("No historical scenarios available; using fallback distribution.");
  }
  if (input.historicalScenarioCount < 20) {
    warnings.push("Historical scenario depth is below 20 days.");
  }
  if (input.nbpProxyUsed) {
    warnings.push("NBP history missing for some dates; scenario coverage is reduced.");
  }
  if (input.candidatePackageCount < 30) {
    warnings.push("Hedge search space is narrow; recommendations may be unstable.");
  }
  if (!input.stabilityPass) {
    warnings.push("Top packages are unstable; recommendation ranking may be noisy.");
  }
  if (warnings.length >= 2) return { quality: "low", warnings };
  if (warnings.length === 1) return { quality: "medium", warnings };
  return { quality: "high", warnings };
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
    const auth = await requireUser(supabase);
    if (auth.response) return auth.response;
    const user = auth.user!;
    const rateLimit = checkRateLimit({
      key: user.id,
      bucket: "optimise_recommendations",
      limit: 20,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          code: "RATE_LIMITED",
          error: "Too many requests. Please wait before retrying.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSec) },
        },
      );
    }

    const since = new Date();
    since.setDate(since.getDate() - 120);
    const sinceDate = since.toISOString().slice(0, 10);

    const [positionsRes, powerRes, gasRes, fxRes] = await Promise.all([
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
        .select("price_time, price_eur_mwh, hub")
        .in("hub", ["TTF", "NBP"])
        .gte("price_time", `${sinceDate}T00:00:00`)
        .order("price_time", { ascending: true }),
      supabase
        .from("fx_rates")
        .select("rate_date, rate")
        .eq("base", "EUR")
        .eq("quote", "GBP")
        .gte("rate_date", sinceDate)
        .order("rate_date", { ascending: true }),
    ]);

    if (
      positionsRes.error ||
      powerRes.error ||
      gasRes.error ||
      (fxRes.error && !isMissingFxTableError(fxRes.error.message))
    ) {
      return NextResponse.json(
        {
          error:
            positionsRes.error?.message ??
            powerRes.error?.message ??
            gasRes.error?.message ??
            fxRes.error?.message ??
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
    let nbpProxyUsed = false;
    for (const row of gasRes.data ?? []) {
      const day = parseDateOnly(row.price_time);
      const ttf = parseNum(row.price_eur_mwh);
      const hub = String(row.hub ?? "").toUpperCase();
      if (!day || ttf == null) continue;
      if (hub === "TTF") addDailySample(ttfAgg, day, ttf);
      if (hub === "NBP") addDailySample(nbpAgg, day, ttf);
    }
    const powerByDay = finaliseDailyAverage(powerAgg);
    const ttfByDay = finaliseDailyAverage(ttfAgg);
    const nbpByDay = finaliseDailyAverage(nbpAgg);
    for (const day of Object.keys(ttfByDay)) {
      if (nbpByDay[day] == null) nbpProxyUsed = true;
    }
    const fxByDay: Record<string, number> = {};
    for (const row of (fxRes.error ? [] : fxRes.data) ?? []) {
      const day = parseDateOnly(String(row.rate_date ?? ""));
      const rate = parseNum(row.rate);
      if (!day || rate == null) continue;
      fxByDay[day] = rate;
    }

    const scenarios = [
      ...buildHistoricalScenarios({
        powerByDay,
        ttfByDayEur: ttfByDay,
        nbpByDayPth: nbpByDay,
        fxByDay,
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
      nbpProxyUsed,
    });
    const quality = optimiserQuality({
      historicalScenarioCount: result.diagnostics.historicalScenarioCount,
      candidatePackageCount: result.diagnostics.candidatePackageCount,
      fallbackUsed: result.diagnostics.fallbackUsed,
      nbpProxyUsed: result.diagnostics.nbpProxyUsed,
      stabilityPass: result.diagnostics.stabilityPass,
    });
    const blocked = quality.quality === "low";

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      objective,
      confidence,
      maxTrades,
      includeStress,
      gbpPerEur,
      quality: quality.quality,
      qualityWarnings: quality.warnings,
      blocked,
      blockedReason: blocked
        ? "Recommendations are blocked because model quality is low."
        : null,
      provenance: {
        power: "market_prices (N2EX/APX daily avg)",
        gas: "gas_prices (TTF+NBP daily avg)",
        fx: "Frankfurter ECB latest + fx_rates historical",
      },
      ...result,
      recommendations: blocked ? [] : result.recommendations,
      alternatives: blocked ? [] : result.alternatives,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
