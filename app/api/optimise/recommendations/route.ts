import {
  buildHistoricalScenarios,
  nbpLevelsPthByDay,
  optimisePortfolio,
  stressScenarios,
  type OptimiseObjective,
} from "@/lib/portfolio/optimise";
import {
  aggregateDailyPowerPrices,
  type PowerPriceSample,
} from "@/lib/portfolio/power-aggregate";
import {
  aggregateDailyGasPrices,
  buildNbpPthByDayFromGasRows,
  NBP_DEPRECATED_YAHOO_HUB,
  type GasPriceSample,
} from "@/lib/portfolio/gas-aggregate";
import { logAuthAuditEvent } from "@/lib/auth/audit";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { requireEntitlement } from "@/lib/auth/require-entitlement";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { makeReliabilityEnvelope } from "@/lib/reliability/contract";

export const dynamic = "force-dynamic";

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

/**
 * Coarse model-health score from several independent checklist flags.
 * Each met condition appends a warning; 0/1/2+ warnings map to
 * high / medium / low. Low therefore means two or more issues at once, not
 * a single gappy NBP or narrow search space in isolation.
 */
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
    const objectiveRaw = (
      url.searchParams.get("objective") ?? "cvar"
    ).toLowerCase();
    if (!["var", "cvar"].includes(objectiveRaw)) {
      return NextResponse.json(
        {
          code: "INVALID_OBJECTIVE",
          error: "objective must be one of: var, cvar.",
        },
        { status: 400 },
      );
    }
    const objective: OptimiseObjective = objectiveRaw as OptimiseObjective;
    const confidenceRaw = Number(url.searchParams.get("confidence") ?? "0.95");
    const maxTradesRaw = Number(url.searchParams.get("maxTrades") ?? "3");
    if (!Number.isFinite(confidenceRaw) || !Number.isFinite(maxTradesRaw)) {
      return NextResponse.json(
        {
          code: "INVALID_QUERY",
          error: "confidence and maxTrades must be numeric.",
        },
        { status: 400 },
      );
    }
    const confidence = Math.min(0.99, Math.max(0.9, confidenceRaw));
    const maxTrades = Math.min(4, Math.max(1, maxTradesRaw));
    const includeStress =
      (url.searchParams.get("includeStress") ?? "true").toLowerCase() !== "false";

    const supabase = await createClient();
    const auth = await requireUser(supabase);
    if (auth.response) {
      await logAuthAuditEvent({
        event: "optimise_recommendations_unauthorized",
        status: "failure",
      });
      return auth.response;
    }
    const user = auth.user!;
    const entitlement = await requireEntitlement(supabase, user.id, {
      feature: "portfolioEnabled",
      minimumTier: "pro",
    });
    if (entitlement.response) {
      await logAuthAuditEvent({
        event: "optimise_recommendations_plan_required",
        userId: user.id,
        status: "failure",
      });
      return entitlement.response;
    }

    const rateLimit = await checkRateLimit({
      key: user.id,
      bucket: "optimise_recommendations",
      limit: 20,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      await logAuthAuditEvent({
        event: "optimise_recommendations_rate_limited",
        userId: user.id,
        status: "failure",
      });
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
      // Query market_prices directly and aggregate client-side so Optimise
      // uses the same coverage-gated, volume-weighted daily mark as the Risk
      // page. Scope to GB day-ahead hubs (N2EX/APX) to exclude imbalance
      // prints and one-off backfills that would contaminate the series.
      createAdminClient()
        .from("market_prices")
        .select("price_gbp_mwh, price_date, settlement_period, volume")
        .or("market.eq.N2EX,market.eq.APX")
        .gte("price_date", sinceDate)
        .order("price_date", { ascending: true })
        .order("settlement_period", { ascending: true }),
      createAdminClient()
        .from("gas_prices")
        .select("price_time, price_eur_mwh, hub")
        .in("hub", ["TTF", "NBP", NBP_DEPRECATED_YAHOO_HUB])
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
    const powerByDay = aggregateDailyPowerPrices(
      (powerRes.data ?? []) as PowerPriceSample[],
    );

    // Shared aggregator applies absolute-level sanity floors (TTF ≥ €10,
    // NBP ≥ 30 p/th) so feed artefacts — most notably the Stooq NF.F
    // ~15 p/th glitches — get dropped before they poison historical
    // scenarios rather than being silently averaged in.
    const gasRows = (gasRes.data ?? []) as Array<{
      price_time: string;
      price_eur_mwh: number | null;
      hub: string | null;
    }>;
    const ttfSamples: GasPriceSample[] = gasRows.filter(
      (r) => String(r.hub ?? "").toUpperCase() === "TTF",
    );
    const ttfByDay = aggregateDailyGasPrices(ttfSamples, { kind: "TTF" });
    const fxByDay: Record<string, number> = {};
    for (const row of (fxRes.error ? [] : fxRes.data) ?? []) {
      const day = parseDateOnly(String(row.rate_date ?? ""));
      const rate = parseNum(row.rate);
      if (!day || rate == null) continue;
      fxByDay[day] = rate;
    }

    const nbpStooqOnly = aggregateDailyGasPrices(
      gasRows.filter(
        (r) => String(r.hub ?? "").toUpperCase() === "NBP",
      ) as GasPriceSample[],
      { kind: "NBP" },
    );
    const nbpRawPthByDay = buildNbpPthByDayFromGasRows(gasRows, fxByDay);
    let nbpProxyUsed = false;
    for (const day of Object.keys(ttfByDay)) {
      const d = new Date(day + "T12:00:00Z");
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      if (nbpStooqOnly[day] == null) nbpProxyUsed = true;
    }

    const nbpByDayPth = nbpLevelsPthByDay(nbpRawPthByDay);

    const scenarios = [
      ...buildHistoricalScenarios({
        powerByDay,
        ttfByDayEur: ttfByDay,
        nbpByDayPth,
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
    const reliability = makeReliabilityEnvelope({
      modelVersion: "optimise_v1",
      dataVersion: `hist_${result.diagnostics.historicalScenarioCount}_stress_${result.diagnostics.stressScenarioCount}`,
      fallbackUsed: result.diagnostics.fallbackUsed,
      coverage: Math.min(1, result.diagnostics.historicalScenarioCount / 60),
      confidence:
        quality.quality === "high"
          ? "high"
          : quality.quality === "medium"
            ? "medium"
            : "low",
      evidence: [
        `historical_scenarios=${result.diagnostics.historicalScenarioCount}`,
        `candidate_packages=${result.diagnostics.candidatePackageCount}`,
        `stability_index=${result.diagnostics.stabilityIndex.toFixed(3)}`,
      ],
    });
    await logAuthAuditEvent({
      event: "optimise_recommendations_succeeded",
      userId: user.id,
      status: "success",
      metadata: {
        blocked,
        quality: quality.quality,
        historicalScenarioCount: result.diagnostics.historicalScenarioCount,
        candidatePackageCount: result.diagnostics.candidatePackageCount,
      },
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      objective,
      confidence,
      maxTrades,
      includeStress,
      gbpPerEur,
      historicalTailReliable: result.diagnostics.historicalTailReliable,
      quality: quality.quality,
      qualityWarnings: quality.warnings,
      blocked,
      blockedReason: blocked
        ? "Recommendations are blocked because model quality is low."
        : null,
      reliability,
      provenance: {
        power: "market_prices (N2EX/APX daily avg)",
        gas:
          "gas_prices (TTF daily avg in EUR/MWh; NBP daily avg in p/th, Stooq NF.F)",
        fx: "Frankfurter ECB latest + fx_rates historical",
        windowDays: 120,
        sinceDate,
      },
      ...result,
      recommendations: blocked ? [] : result.recommendations,
      alternatives: blocked ? [] : result.alternatives,
      // When the package is blocked, the "after" metrics describe a hedge the
      // user cannot execute — displaying them alongside an empty
      // recommendation list produces a misleading "97% reduction" on the cards.
      // Collapse to before == after so the UI shows an honest 0% reduction.
      after: blocked ? result.before : result.after,
      deltas: blocked
        ? {
            var95Reduction: 0,
            cvar95Reduction: 0,
            worstStressReduction: 0,
          }
        : result.deltas,
    });
  } catch (error: unknown) {
    await logAuthAuditEvent({
      event: "optimise_recommendations_failed",
      status: "failure",
      metadata: { reason: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
