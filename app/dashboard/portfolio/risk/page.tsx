"use client";

import { TierGate } from "@/components/billing/TierGate";
import { chartTooltipBoxStyle } from "@/lib/charts/recharts-tooltip-styles";
import { RISK_HISTORICAL_NOTE } from "@/lib/portfolio/desk-copy";
import { PORTFOLIO_STRESS_SCENARIOS } from "@/lib/portfolio/stress-scenarios-data";
import {
  formatReliabilityConfidenceDesk,
  reliabilityConfidenceFromVaRHistoryDays,
} from "@/lib/reliability/contract";
import { positionNotionalGbp, tenorToExpiryDate } from "@/lib/portfolio/book";
import { aggregateDailyPowerPrices } from "@/lib/portfolio/power-aggregate";
import {
  aggregateDailyGasPrices,
  buildNbpPthByDayFromGasRows,
} from "@/lib/portfolio/gas-aggregate";
import { createBrowserClient } from "@/lib/supabase/client";
import { format, parseISO } from "date-fns";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const sectionLabel =
  "text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid";
const BRAND_GREEN = "#1D6B4E";
const TERRACOTTA = "#8B3A3A";
const HISTORICAL_GBP_PER_EUR = 0.86;
/**
 * Historical lookback used for VaR / CVaR / volatility on the Risk page.
 * Matches the server-side window used by the Optimise recommendations API
 * (see app/api/optimise/recommendations/route.ts) so the two pages can't
 * show contradictory VaR numbers for the same book.
 */
const RISK_LOOKBACK_DAYS = 120;

type PositionRow = {
  id: string;
  user_id: string;
  instrument: string | null;
  direction: string | null;
  market: string | null;
  size: number | null;
  unit: string | null;
  expiry_date: string | null;
  tenor: string | null;
  instrument_type: string | null;
  is_closed: boolean | null;
  entry_date: string | null;
  created_at: string;
  trade_price: number | null;
  currency: string | null;
};

type PowerPriceRow = {
  price_gbp_mwh: number | null;
  price_date: string;
  settlement_period: number | null;
  market: string | null;
  source: string | null;
  volume: number | null;
};

/** Safety cap on inferred day-over-day GB power move (£/MWh). Moves above this
 * threshold are almost always data-pipeline artefacts (imbalance-price spikes,
 * stale rows, bad FX) rather than genuine forward-curve moves. Mirrors the
 * HISTORICAL_MOVE_CAPS used by the Optimise engine. */
const POWER_MOVE_SANITY_CAP_GBP_MWH = 250;

/**
 * Matches HISTORICAL_MOVE_CAPS in optimise.ts. NBP is stored in p/th and
 * the feed is a single daily close from Stooq NF.F, so a Δ above 30 p/th
 * day-over-day is almost always a feed artefact (e.g. the well-known case
 * where the upstream source briefly prints ~15 p/th for a day or two,
 * then snaps back to ~60 p/th and manufactures a 45 p/th fake spike).
 * Real day-ahead NBP rarely moves > 20 p/th in a single session.
 */
const NBP_MOVE_SANITY_CAP_PTH = 30;

/**
 * EUR/MWh. TTF day-over-day moves above 25 €/MWh have historically been
 * print errors rather than real moves — even the 2022 war spikes settled
 * under this threshold at the daily-close level (intra-day of course
 * moved further). Lower than the previous 60 €/MWh to catch the same
 * Stooq-style single-print artefacts we see in NBP.
 */
const TTF_MOVE_SANITY_CAP_EUR_MWH = 25;

type GasPriceRow = {
  price_eur_mwh: number | null;
  price_time: string;
  hub: string | null;
};

type CarbonPriceRow = {
  price_gbp_per_t: number | null;
  price_eur_per_t: number | null;
  price_date: string;
  hub: string | null;
};

type FxRateRow = {
  rate_date: string;
  rate: number | null;
};

type MarketKey = "GB_POWER" | "TTF" | "NBP" | "UKA" | "EUA";

type DailyPnLBreakdown = {
  /** Per-market P&L contribution to the day, in GBP. */
  byMarket: Partial<Record<MarketKey, number>>;
  /**
   * Raw day-over-day moves in each market's native units so the tooltip can
   * explain "why" without the reader having to re-derive them:
   *   - GB_POWER: £/MWh (δ in GBP/MWh)
   *   - TTF:      EUR/MWh (pre-FX)
   *   - NBP:      pence/therm
   *   - UKA:      £/t
   *   - EUA:      EUR/t (pre-FX)
   */
  moves: Partial<Record<MarketKey, number>>;
};

type DailyPnL = { date: string; pnl: number } & DailyPnLBreakdown;

type Scenario = {
  name: string;
  period: string;
  description: string;
  moves: {
    GB_power: number;
    TTF: number;
    NBP: number;
    UKA: number;
    EUA: number;
  };
};

const STRESS_SCENARIOS: Scenario[] = PORTFOLIO_STRESS_SCENARIOS.map((s) => ({
  name: s.name,
  period: s.period,
  description: s.description,
  moves: {
    GB_power: s.gbPowerMove,
    TTF: s.ttfMoveEurMwh,
    NBP: s.nbpMovePth,
    UKA: s.ukaMoveGbpT ?? 0,
    EUA: s.euaMoveEurT ?? 0,
  },
}));

function asNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatGbp(v: number): string {
  return `£${Math.round(v).toLocaleString("en-GB")}`;
}

function formatSignedGbp(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}${formatGbp(Math.abs(v))}`;
}

function formatDay(d: string): string {
  try {
    return format(parseISO(`${d}T00:00:00.000Z`), "dd MMM");
  } catch {
    return d;
  }
}

const MARKET_ORDER: MarketKey[] = ["GB_POWER", "TTF", "NBP", "UKA", "EUA"];
const MARKET_LABEL: Record<MarketKey, string> = {
  GB_POWER: "GB Power",
  TTF: "TTF",
  NBP: "NBP",
  UKA: "UKA",
  EUA: "EUA",
};

/** Human-friendly native-unit formatter for the per-market raw move row. */
function formatMove(market: MarketKey, move: number): string {
  const sign = move >= 0 ? "+" : "−";
  const abs = Math.abs(move);
  switch (market) {
    case "GB_POWER":
      return `${sign}£${abs.toFixed(2)}/MWh`;
    case "TTF":
      return `${sign}€${abs.toFixed(2)}/MWh`;
    case "NBP":
      return `${sign}${abs.toFixed(2)}p/th`;
    case "UKA":
      return `${sign}£${abs.toFixed(2)}/t`;
    case "EUA":
      return `${sign}€${abs.toFixed(2)}/t`;
  }
}

type DailyPnlTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload?: DailyPnL }>;
  label?: string;
  bookStartDate: string | null;
};

/**
 * Replaces the default Recharts tooltip with a drill-down that explains how
 * each day's simulated P&L was assembled. Without this, a £18k outlier is
 * opaque — the reader can't tell whether it came from a genuine GB power
 * spike, a TTF move, or a data artefact. The breakdown shows:
 *   - Total P&L for the day
 *   - Per-market contribution to that total (GBP)
 *   - The underlying native-unit move that drove each contribution
 *
 * When all bars are tiny except one, hovering the outlier immediately tells
 * you which feed spiked — if no single market dominates, the outlier is
 * likely a legitimate correlated move; if one market does, that's the one
 * to verify in the raw price table.
 */
function DailyPnlTooltip({
  active,
  payload,
  label,
  bookStartDate,
}: DailyPnlTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload;
  if (!datum) return null;
  const dateStr = String(label ?? datum.date);
  const preBook = bookStartDate != null && dateStr < bookStartDate;
  const entries = MARKET_ORDER.filter(
    (m) =>
      (datum.byMarket[m] != null && datum.byMarket[m] !== 0) ||
      datum.moves[m] != null,
  );
  return (
    <div style={chartTooltipBoxStyle}>
      <div style={{ color: "var(--ink-mid)", fontWeight: 500 }}>
        {formatDay(dateStr)}
        {preBook ? " · pre-book (simulated)" : ""}
      </div>
      <div
        style={{
          marginTop: 4,
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          fontWeight: 600,
        }}
      >
        <span>Total P&amp;L</span>
        <span>{formatSignedGbp(datum.pnl)}</span>
      </div>
      {entries.length > 0 ? (
        <div
          style={{
            marginTop: 6,
            borderTop: "0.5px solid var(--ivory-border)",
            paddingTop: 6,
            display: "grid",
            rowGap: 2,
          }}
        >
          {entries.map((m) => {
            const contribution = datum.byMarket[m] ?? 0;
            const rawMove = datum.moves[m];
            return (
              <div
                key={m}
                style={{
                  display: "grid",
                  gridTemplateColumns: "64px 72px 1fr",
                  gap: 8,
                  color: "var(--ink-mid)",
                }}
              >
                <span style={{ color: "var(--ink)" }}>{MARKET_LABEL[m]}</span>
                <span
                  style={{
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--ink)",
                  }}
                >
                  {formatSignedGbp(contribution)}
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {rawMove != null ? `Δ ${formatMove(m, rawMove)}` : "—"}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

type LimitSeverity = "warn" | "over";

function limitSeverity(current: number, max: number | null): LimitSeverity | null {
  if (max == null || !Number.isFinite(max) || max <= 0) return null;
  if (current >= max) return "over";
  if (current >= max * 0.8) return "warn";
  return null;
}

function LimitStatusBadge({ severity }: { severity: LimitSeverity | null }) {
  if (!severity) return null;
  const over = severity === "over";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[3px] border-[0.5px] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${
        over
          ? "border-[#8B3A3A]/40 bg-[#8B3A3A]/10 text-[#8B3A3A]"
          : "border-watch/40 bg-watch/12 text-watch"
      }`}
    >
      {over ? "Over limit" : "Near limit"}
    </span>
  );
}

function parseOptionalLimitNumber(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Enter a valid non-negative number, or leave the field empty.");
  }
  return n;
}

function isGbPowerMarket(market: string | null | undefined): boolean {
  const m = (market ?? "").toLowerCase().replace(/[\s_]/g, "");
  return m === "gbpower" || m === "n2ex" || m === "apx";
}

function isUkaMarket(market: string | null | undefined): boolean {
  return (market ?? "").toLowerCase().replace(/[\s_]/g, "") === "uka";
}

function isEuaMarket(market: string | null | undefined): boolean {
  return (market ?? "").toLowerCase().replace(/[\s_]/g, "") === "eua";
}

/**
 * True for markets the Risk engine actually marks to market. Anything
 * outside this set (e.g. OTHER_POWER, OTHER_GAS variants, custom
 * instruments) is silently excluded from VaR, CVaR and stress impacts,
 * so the Risk page surfaces a banner to the user.
 */
function isRiskMarkableMarket(market: string | null | undefined): boolean {
  const normalised = (market ?? "").toUpperCase().replace(/\s/g, "_");
  return (
    isGbPowerMarket(market) ||
    normalised === "TTF" ||
    normalised === "NBP" ||
    isUkaMarket(market) ||
    isEuaMarket(market)
  );
}

const calculateDailyPnL = (
  positions: PositionRow[],
  powerPricesByDay: Record<string, number>,
  ttfPricesByDay: Record<string, number>,
  nbpPricesByDay: Record<string, number>,
  fxByDay: Record<string, number>,
  options?: {
    minResultDate?: string | null;
    ukaPricesByDay?: Record<string, number>;
    euaPricesByDay?: Record<string, number>;
  },
): DailyPnL[] => {
  const minResultDate = options?.minResultDate ?? null;
  const ukaPricesByDay = options?.ukaPricesByDay ?? {};
  const euaPricesByDay = options?.euaPricesByDay ?? {};
  const dateUniverse = new Set<string>([
    ...Object.keys(powerPricesByDay),
    ...Object.keys(ttfPricesByDay),
    ...Object.keys(nbpPricesByDay),
    ...Object.keys(ukaPricesByDay),
    ...Object.keys(euaPricesByDay),
  ]);
  const dates = Array.from(dateUniverse).sort();
  const result: DailyPnL[] = [];

  for (let i = 1; i < dates.length; i++) {
    const prevDate = dates[i - 1];
    const currDate = dates[i];
    if (minResultDate && currDate < minResultDate) {
      continue;
    }
    let dayPnL = 0;
    let hasContributingSeries = false;
    const byMarket: Partial<Record<MarketKey, number>> = {};
    const moves: Partial<Record<MarketKey, number>> = {};
    const addContribution = (market: MarketKey, contribution: number) => {
      byMarket[market] = (byMarket[market] ?? 0) + contribution;
    };

    for (const pos of positions) {
      const direction = pos.direction === "long" ? 1 : -1;
      const size = pos.size ?? 0;

      if (isGbPowerMarket(pos.market)) {
        const prevPrice = powerPricesByDay[prevDate];
        const currPrice = powerPricesByDay[currDate];
        if (prevPrice == null || currPrice == null) continue;
        const move = currPrice - prevPrice;
        // Defensive guardrail: reject obviously bogus day-over-day moves that
        // slip past the aggregator (e.g. one settlement period in the day
        // still triggered an imbalance spike despite coverage thresholding).
        if (Math.abs(move) > POWER_MOVE_SANITY_CAP_GBP_MWH) continue;
        const contribution = move * size * direction;
        dayPnL += contribution;
        addContribution("GB_POWER", contribution);
        moves.GB_POWER = move;
        hasContributingSeries = true;
      } else if (pos.market === "TTF") {
        const prevFx = fxByDay[prevDate] ?? HISTORICAL_GBP_PER_EUR;
        const currFx = fxByDay[currDate] ?? HISTORICAL_GBP_PER_EUR;
        const prevTtf = ttfPricesByDay[prevDate];
        const currTtf = ttfPricesByDay[currDate];
        if (prevTtf == null || currTtf == null) continue;
        // Reject bogus moves in the underlying EUR/MWh series before FX is
        // applied — once FX has scaled the print, the clean signal is lost.
        if (Math.abs(currTtf - prevTtf) > TTF_MOVE_SANITY_CAP_EUR_MWH) continue;
        const prevPrice = prevTtf * prevFx;
        const currPrice = currTtf * currFx;
        const contribution = (currPrice - prevPrice) * size * direction;
        dayPnL += contribution;
        addContribution("TTF", contribution);
        moves.TTF = currTtf - prevTtf;
        hasContributingSeries = true;
      } else if (pos.market === "NBP") {
        const prevNbp = nbpPricesByDay[prevDate];
        const currNbp = nbpPricesByDay[currDate];
        if (prevNbp == null || currNbp == null) continue;
        const move = currNbp - prevNbp;
        // NBP feed occasionally prints stale/placeholder values; cap wild
        // day-over-day p/th moves so they can't manufacture a fake VaR tail.
        if (Math.abs(move) > NBP_MOVE_SANITY_CAP_PTH) continue;
        const contribution = (move * size * direction) / 100;
        dayPnL += contribution;
        addContribution("NBP", contribution);
        moves.NBP = move;
        hasContributingSeries = true;
      } else if (isUkaMarket(pos.market)) {
        // UKA is stored in GBP/t; size is in tCO2.
        const prevPrice = ukaPricesByDay[prevDate];
        const currPrice = ukaPricesByDay[currDate];
        if (prevPrice == null || currPrice == null) continue;
        const contribution = (currPrice - prevPrice) * size * direction;
        dayPnL += contribution;
        addContribution("UKA", contribution);
        moves.UKA = currPrice - prevPrice;
        hasContributingSeries = true;
      } else if (isEuaMarket(pos.market)) {
        // EUA is stored in EUR/t; FX-adjust each leg before differencing to
        // match how TTF is handled above.
        const prevFx = fxByDay[prevDate] ?? HISTORICAL_GBP_PER_EUR;
        const currFx = fxByDay[currDate] ?? HISTORICAL_GBP_PER_EUR;
        const prevEua = euaPricesByDay[prevDate];
        const currEua = euaPricesByDay[currDate];
        if (prevEua == null || currEua == null) continue;
        const prevPrice = prevEua * prevFx;
        const currPrice = currEua * currFx;
        const contribution = (currPrice - prevPrice) * size * direction;
        dayPnL += contribution;
        addContribution("EUA", contribution);
        moves.EUA = currEua - prevEua;
        hasContributingSeries = true;
      }
    }
    if (hasContributingSeries) {
      result.push({ date: currDate, pnl: dayPnL, byMarket, moves });
    }
  }
  return result;
};

const calculateVaR = (dailyPnLs: number[], confidence: number): number => {
  if (dailyPnLs.length === 0) return 0;
  const sorted = [...dailyPnLs].sort((a, b) => a - b);
  const index = Math.floor((1 - confidence) * sorted.length);
  return sorted[Math.max(0, index)];
};

const calculateScenarioImpact = (
  scenario: Scenario,
  positions: PositionRow[],
  gbpEurRate: number,
) => {
  let total = 0;
  const breakdown: { instrument: string; impact: number }[] = [];

  for (const pos of positions) {
    const direction = pos.direction === "long" ? 1 : -1;
    const size = pos.size ?? 0;
    let positionImpact = 0;
    const market = (pos.market ?? "").toUpperCase().replace(" ", "_");

    if (isGbPowerMarket(pos.market)) {
      positionImpact = scenario.moves.GB_power * size * direction;
    } else if (market === "TTF") {
      positionImpact = scenario.moves.TTF * gbpEurRate * size * direction;
    } else if (market === "NBP") {
      positionImpact = (scenario.moves.NBP * size * direction) / 100;
    } else if (market === "UKA") {
      // UKA positions: GBP/t × tCO2 → GBP directly.
      positionImpact = scenario.moves.UKA * size * direction;
    } else if (market === "EUA") {
      // EUA positions: EUR/t × tCO2 × FX → GBP.
      positionImpact = scenario.moves.EUA * gbpEurRate * size * direction;
    }

    total += positionImpact;
    if (positionImpact !== 0) {
      breakdown.push({ instrument: pos.instrument ?? "Position", impact: positionImpact });
    }
  }
  return { total, breakdown };
};

export default function RiskPage() {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [powerPrices, setPowerPrices] = useState<PowerPriceRow[]>([]);
  const [gasPrices, setGasPrices] = useState<GasPriceRow[]>([]);
  const [carbonPrices, setCarbonPrices] = useState<CarbonPriceRow[]>([]);
  const [fxRates, setFxRates] = useState<FxRateRow[]>([]);
  const [gbpEurRate, setGbpEurRate] = useState(0.86);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedScenarios, setExpandedScenarios] = useState<Record<string, boolean>>(
    {},
  );
  const [currentTier, setCurrentTier] = useState<"free" | "pro" | "team" | null>(null);
  const [maxPositionMwInput, setMaxPositionMwInput] = useState("");
  const [maxVarGbpInput, setMaxVarGbpInput] = useState("");
  const [maxDrawdownGbpInput, setMaxDrawdownGbpInput] = useState("");
  const [limitsSaving, setLimitsSaving] = useState(false);
  const [limitsMessage, setLimitsMessage] = useState<string | null>(null);
  const [limitsError, setLimitsError] = useState<string | null>(null);
  const [riskLimitsFetchError, setRiskLimitsFetchError] = useState<string | null>(null);

  /**
   * Which slice of the simulated daily P&L series to show on the histogram and
   * in the footer stats. The VaR / CVaR / volatility tiles above the chart
   * deliberately always use the full 120-day sample (they need it to be
   * statistically reliable); this toggle only re-scopes the *display*.
   *
   * Initial value is read lazily from localStorage on the client; on the
   * server and in private-mode browsers we fall back to the 120-day default
   * (which matches the server-rendered HTML so hydration is stable).
   */
  const [histogramWindow, setHistogramWindow] = useState<
    "book" | "30d" | "90d" | "120d"
  >(() => {
    if (typeof window === "undefined") return "120d";
    try {
      const stored = window.localStorage.getItem("risk.histogramWindow");
      if (
        stored === "book" ||
        stored === "30d" ||
        stored === "90d" ||
        stored === "120d"
      ) {
        return stored;
      }
    } catch {
      // localStorage may be unavailable (private mode); safe to ignore.
    }
    return "120d";
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("risk.histogramWindow", histogramWindow);
    } catch {
      // See above.
    }
  }, [histogramWindow]);

  useEffect(() => {
    fetch("/api/billing/status")
      .then((r) => r.json())
      .then((body: { effectiveTier?: string }) => {
        const t = body.effectiveTier;
        setCurrentTier(t === "pro" || t === "team" ? t : "free");
      })
      .catch(() => setCurrentTier("free"));
  }, []);

  useEffect(() => {
    fetch("/api/fx-rate")
      .then((r) => r.json())
      .then((d) => setGbpEurRate(d.rate ?? 0.86))
      .catch(() => setGbpEurRate(0.86));
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);
      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
      setUserId(user?.id ?? null);
      if (!user?.id) {
        setPositions([]);
        setPowerPrices([]);
        setGasPrices([]);
        setCarbonPrices([]);
        setMaxPositionMwInput("");
        setMaxVarGbpInput("");
        setMaxDrawdownGbpInput("");
        setRiskLimitsFetchError(null);
        setLoading(false);
        return;
      }

      const fmtLimit = (v: unknown) => {
        if (v == null || v === "") return "";
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? String(n) : "";
      };

      const [
        { data: positionsData, error: positionsError },
        { data: powerData, error: powerError },
        { data: gasData, error: gasError },
        { data: fxData, error: fxError },
        { data: carbonData, error: carbonError },
        { data: riskLimitsData, error: riskLimitsError },
      ] = await Promise.all([
          supabase
            .from("positions")
            .select("*")
            .eq("user_id", user.id)
            .eq("is_closed", false),
          // Scope to GB day-ahead power (N2EX / APX). Without the filter we
          // pick up any other row in market_prices — system/imbalance prints,
          // non-GB markets, one-off backfill runs — and average them into a
          // single daily "GB power" mark, which manufactures spurious
          // day-over-day moves on the Daily P&L distribution. Matches the
          // scoping used by AttributionPageClient and Overview.
          supabase
            .from("market_prices")
            .select(
              "price_gbp_mwh, price_date, settlement_period, market, source, volume, fetched_at",
            )
            .or("market.eq.N2EX,market.eq.APX")
            .order("price_date", { ascending: true })
            .order("settlement_period", { ascending: true }),
          supabase
            .from("gas_prices")
            .select("price_eur_mwh, price_time, hub, source, fetched_at")
            .order("price_time", { ascending: true }),
          supabase
            .from("fx_rates")
            .select("rate_date, rate")
            .eq("base", "EUR")
            .eq("quote", "GBP")
            .order("rate_date", { ascending: true }),
          supabase
            .from("carbon_prices")
            .select("price_gbp_per_t, price_eur_per_t, price_date, hub")
            .in("hub", ["UKA", "EUA"])
            .order("price_date", { ascending: true }),
          supabase
            .from("risk_limits")
            .select("max_position_mw, max_var_gbp, max_drawdown_gbp")
            .eq("user_id", user.id)
            .maybeSingle(),
      ]);

      if (positionsError || powerError || gasError || fxError) {
        setLoadError(
          positionsError?.message ??
            powerError?.message ??
            gasError?.message ??
            fxError?.message ??
            "Could not load risk data.",
        );
      } else {
        setLoadError(null);
      }

      if (riskLimitsError) {
        setRiskLimitsFetchError(riskLimitsError.message);
      } else {
        setRiskLimitsFetchError(null);
        const row = riskLimitsData as {
          max_position_mw?: number | string | null;
          max_var_gbp?: number | string | null;
          max_drawdown_gbp?: number | string | null;
        } | null;
        setMaxPositionMwInput(fmtLimit(row?.max_position_mw));
        setMaxVarGbpInput(fmtLimit(row?.max_var_gbp));
        setMaxDrawdownGbpInput(fmtLimit(row?.max_drawdown_gbp));
      }

      setPositions((positionsData ?? []) as PositionRow[]);
      setPowerPrices((powerData ?? []) as PowerPriceRow[]);
      setGasPrices((gasData ?? []) as GasPriceRow[]);
      setFxRates((fxData ?? []) as FxRateRow[]);
      setCarbonPrices(carbonError ? [] : ((carbonData ?? []) as CarbonPriceRow[]));
      setLoading(false);
    }
    void load();
  }, [supabase]);

  useEffect(() => {
    if (!limitsMessage) return;
    const t = setTimeout(() => setLimitsMessage(null), 3200);
    return () => clearTimeout(t);
  }, [limitsMessage]);

  const saveRiskLimits = useCallback(async () => {
    if (!userId) return;
    setLimitsError(null);
    setLimitsMessage(null);
    let max_position_mw: number | null;
    let max_var_gbp: number | null;
    let max_drawdown_gbp: number | null;
    try {
      max_position_mw = parseOptionalLimitNumber(maxPositionMwInput);
      max_var_gbp = parseOptionalLimitNumber(maxVarGbpInput);
      max_drawdown_gbp = parseOptionalLimitNumber(maxDrawdownGbpInput);
    } catch (e) {
      setLimitsError(e instanceof Error ? e.message : "Invalid input");
      return;
    }
    setLimitsSaving(true);
    const { error } = await supabase.from("risk_limits").upsert(
      {
        user_id: userId,
        max_position_mw,
        max_var_gbp,
        max_drawdown_gbp,
      },
      { onConflict: "user_id" },
    );
    setLimitsSaving(false);
    if (error) {
      setLimitsError(error.message);
      return;
    }
    setLimitsMessage("Saved");
  }, [
    userId,
    supabase,
    maxPositionMwInput,
    maxVarGbpInput,
    maxDrawdownGbpInput,
  ]);

  const powerPricesByDay = useMemo(
    () => aggregateDailyPowerPrices(powerPrices),
    [powerPrices],
  );

  const ttfPricesByDay = useMemo(
    () =>
      aggregateDailyGasPrices(
        gasPrices.filter((row) => (row.hub ?? "").toUpperCase() === "TTF"),
        { kind: "TTF" },
      ),
    [gasPrices],
  );

  const fxByDay = useMemo(() => {
    const out: Record<string, number> = {};
    for (const row of fxRates) {
      if (!row.rate_date) continue;
      const rate = asNum(row.rate);
      if (rate > 0) out[row.rate_date.slice(0, 10)] = rate;
    }
    return out;
  }, [fxRates]);

  /**
   * NBP daily p/th: Stooq `hub === "NBP"` (column is pence/therm despite
   * `price_eur_mwh`) plus, for any date the live series does not cover,
   * TTF-in-EUR/MWh from `NBP_DEPRECATED_YAHOO_BACKFILL` converted via
   * `buildNbpPthByDayFromGasRows` + day FX. Same-day Stooq wins. Level floor
   * in {@link aggregateDailyGasPrices} applies to both.
   */
  const nbpPricesByDay = useMemo(
    () => buildNbpPthByDayFromGasRows(gasPrices, fxByDay),
    [gasPrices, fxByDay],
  );

  const ukaPricesByDay = useMemo(() => {
    const buckets = new Map<string, { sum: number; count: number }>();
    for (const row of carbonPrices) {
      if ((row.hub ?? "").toUpperCase() !== "UKA") continue;
      const d = row.price_date?.slice(0, 10);
      if (!d) continue;
      const p = asNum(row.price_gbp_per_t);
      if (!Number.isFinite(p) || p <= 0) continue;
      const cur = buckets.get(d) ?? { sum: 0, count: 0 };
      cur.sum += p;
      cur.count += 1;
      buckets.set(d, cur);
    }
    const out: Record<string, number> = {};
    for (const [k, v] of buckets) {
      if (v.count > 0) out[k] = v.sum / v.count;
    }
    return out;
  }, [carbonPrices]);

  const euaPricesByDay = useMemo(() => {
    // Prefer EUR/t so FX variance shows up in the P&L path; fall back to
    // GBP/t converted back to EUR if only the GBP column is populated.
    const buckets = new Map<string, { sum: number; count: number }>();
    for (const row of carbonPrices) {
      if ((row.hub ?? "").toUpperCase() !== "EUA") continue;
      const d = row.price_date?.slice(0, 10);
      if (!d) continue;
      const eur = asNum(row.price_eur_per_t);
      if (!Number.isFinite(eur) || eur <= 0) continue;
      const cur = buckets.get(d) ?? { sum: 0, count: 0 };
      cur.sum += eur;
      cur.count += 1;
      buckets.set(d, cur);
    }
    const out: Record<string, number> = {};
    for (const [k, v] of buckets) {
      if (v.count > 0) out[k] = v.sum / v.count;
    }
    return out;
  }, [carbonPrices]);

  const varLookbackMinDate = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - RISK_LOOKBACK_DAYS);
    return d.toISOString().slice(0, 10);
  }, []);

  /**
   * Earliest date the user was tracking any of their current open positions on
   * the platform. Used to visually distinguish "simulated pre-book" bars from
   * "simulated during the user's tenure" bars in the distribution, and to clip
   * the Worst-day tile so we don't advertise a worst-day from before the user
   * existed.
   *
   * We prefer `entry_date` when provided (user-asserted trade date, which may
   * pre-date created_at on imported historical trades) and fall back to the
   * DB row creation date. The full 120-day simulation window is kept intact
   * for the VaR / CVaR / volatility stats — those need the sample size.
   */
  const bookStartDate = useMemo<string | null>(() => {
    let earliest: string | null = null;
    for (const p of positions) {
      const candidate = p.entry_date ?? p.created_at.slice(0, 10);
      if (!candidate) continue;
      if (earliest == null || candidate < earliest) earliest = candidate;
    }
    return earliest;
  }, [positions]);

  const dailyPnLSeries = useMemo(
    () =>
      calculateDailyPnL(positions, powerPricesByDay, ttfPricesByDay, nbpPricesByDay, fxByDay, {
        minResultDate: varLookbackMinDate,
        ukaPricesByDay,
        euaPricesByDay,
      }),
    [
      positions,
      powerPricesByDay,
      ttfPricesByDay,
      nbpPricesByDay,
      fxByDay,
      varLookbackMinDate,
      ukaPricesByDay,
      euaPricesByDay,
    ],
  );

  /**
   * Histogram slice derived from the full dailyPnLSeries. The VaR / CVaR /
   * volatility tiles keep using the full 120-day `dailyPnLSeries`; this is
   * purely for the chart and its own footer stats (avg P&L, daily vol, etc.).
   *   - "120d" → full lookback (unchanged from current behaviour).
   *   - "90d" / "30d" → last N calendar days.
   *   - "book" → days on or after bookStartDate (falls back to 120d when the
   *     user has no positions yet, so we don't render an empty chart).
   */
  const histogramFloorDate = useMemo<string>(() => {
    if (histogramWindow === "120d") return varLookbackMinDate;
    if (histogramWindow === "book") {
      return bookStartDate && bookStartDate > varLookbackMinDate
        ? bookStartDate
        : varLookbackMinDate;
    }
    const days = histogramWindow === "30d" ? 30 : 90;
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    const iso = d.toISOString().slice(0, 10);
    return iso < varLookbackMinDate ? varLookbackMinDate : iso;
  }, [histogramWindow, varLookbackMinDate, bookStartDate]);
  const visibleSeries = useMemo(
    () => dailyPnLSeries.filter((d) => d.date >= histogramFloorDate),
    [dailyPnLSeries, histogramFloorDate],
  );

  /**
   * Exact date in visibleSeries on or after bookStartDate — used as the x
   * value for the book-opened ReferenceLine. Recharts expects the x value to
   * match a category present in the data, so we snap to the first series day
   * rather than using the raw bookStartDate which may land on a weekend.
   *
   * Returns null when bookStart is outside the currently visible window
   * (either before the earliest visible day — marker would sit off-chart —
   * or after today), or when the user has no book yet.
   */
  const bookStartMarkerDate = useMemo<string | null>(() => {
    if (!bookStartDate) return null;
    const first = visibleSeries.find((d) => d.date >= bookStartDate);
    if (!first) return null;
    // If the first visible day is ALREADY post-book, there's no pre-book
    // region on-screen and the marker would sit at the chart's left edge,
    // which reads as noise rather than signal. Suppress.
    if (visibleSeries[0] && visibleSeries[0].date >= bookStartDate) return null;
    return first.date;
  }, [bookStartDate, visibleSeries]);

  const var95 = calculateVaR(dailyPnLSeries.map((d) => d.pnl), 0.95);
  const var99 = calculateVaR(dailyPnLSeries.map((d) => d.pnl), 0.99);
  /**
   * Clip Worst-day to days the user actually held these positions. VaR itself
   * still uses the full simulation window (it needs the sample), but "your
   * worst day was £X on 12 Dec 2025" reads as realised P&L — which is
   * misleading if the user only opened the book last week.
   */
  const worstDaySeries = useMemo(
    () =>
      bookStartDate
        ? dailyPnLSeries.filter((d) => d.date >= bookStartDate)
        : dailyPnLSeries,
    [dailyPnLSeries, bookStartDate],
  );
  const worstDay =
    worstDaySeries.length > 0
      ? worstDaySeries.reduce((min, d) => (d.pnl < min.pnl ? d : min), worstDaySeries[0])
      : null;
  // Footer stats under the histogram are scoped to the *visible* window so
  // "Average daily P&L" etc. match what the user is actually seeing. VaR /
  // CVaR / worst-stress tiles above the chart still use the full 120-day
  // series regardless of this toggle.
  const visibleAvgPnL =
    visibleSeries.length > 0
      ? visibleSeries.reduce((sum, d) => sum + d.pnl, 0) / visibleSeries.length
      : 0;
  const visibleVariance =
    visibleSeries.length > 0
      ? visibleSeries.reduce((sum, d) => sum + (d.pnl - visibleAvgPnL) ** 2, 0) /
        visibleSeries.length
      : 0;
  const visibleDailyVol = Math.sqrt(visibleVariance);
  const visibleAnnualisedVol = visibleDailyVol * Math.sqrt(252);
  const visibleSharpe =
    visibleDailyVol > 0 ? (visibleAvgPnL / visibleDailyVol) * Math.sqrt(252) : 0;

  /**
   * Flag the single biggest |P&L| day when it dwarfs the rest of the window.
   * Without this, a 5σ outlier (legitimate or data artefact) silently
   * dominates daily vol / annualised vol / Sharpe without any visual cue
   * beyond "one bar is tall". Surfacing it in text makes it audit-able.
   *
   * Threshold: the day's |pnl| exceeds 3× the std dev of the *other* days
   * in the visible window AND is > £5k in absolute terms, so small books
   * with naturally noisy histories don't trigger spurious warnings.
   */
  const outlierDay = useMemo(() => {
    if (visibleSeries.length < 5) return null;
    const sorted = [...visibleSeries].sort(
      (a, b) => Math.abs(b.pnl) - Math.abs(a.pnl),
    );
    const top = sorted[0];
    const rest = sorted.slice(1);
    if (rest.length < 2) return null;
    const restMean = rest.reduce((s, d) => s + d.pnl, 0) / rest.length;
    const restVar =
      rest.reduce((s, d) => s + (d.pnl - restMean) ** 2, 0) / rest.length;
    const restStd = Math.sqrt(restVar);
    const threshold = Math.max(5000, restStd * 3);
    return Math.abs(top.pnl) > threshold ? { day: top, restStd } : null;
  }, [visibleSeries]);

  const perPositionRisk = useMemo(() => {
    return positions.map((p) => {
      const series = calculateDailyPnL(
        [p],
        powerPricesByDay,
        ttfPricesByDay,
        nbpPricesByDay,
        fxByDay,
        {
          minResultDate: varLookbackMinDate,
          ukaPricesByDay,
          euaPricesByDay,
        },
      );
      const worst = series.length > 0 ? series.reduce((min, d) => (d.pnl < min.pnl ? d : min), series[0]) : null;
      return { position: p, worst };
    });
  }, [
    positions,
    powerPricesByDay,
    ttfPricesByDay,
    nbpPricesByDay,
    fxByDay,
    varLookbackMinDate,
    ukaPricesByDay,
    euaPricesByDay,
  ]);

  const sumIndividualVaRs = perPositionRisk.reduce(
    (sum, r) => sum + Math.abs(r.worst?.pnl ?? 0),
    0,
  );
  const diversificationBenefit = sumIndividualVaRs - Math.abs(var95);
  // Normalise by gross risk (sum of abs per-position worst-day losses) so the
  // column is a share that always sums to 100%. Previously it divided by
  // portfolio VaR95, which produced 200%+ per row on concentrated books —
  // technically valid but visually alarming and hard to read at a glance.
  const grossRiskBase = Math.max(sumIndividualVaRs, 1);

  const scenarioResults = useMemo(
    () => STRESS_SCENARIOS.map((s) => ({ scenario: s, ...calculateScenarioImpact(s, positions, gbpEurRate) })),
    [positions, gbpEurRate],
  );

  const marketExposure = useMemo(() => {
    // Concentration is computed on a unified £ notional basis (|size| ×
    // trade_price, unit/currency converted to GBP) so that tco2, MW, and
    // therm positions are directly comparable rather than lumped on a
    // single mixed-unit axis.
    const bucket: Record<string, { notionalGbp: number; missing: number }> = {};
    for (const p of positions) {
      const market = (p.market ?? "Unknown").toUpperCase();
      const notional = positionNotionalGbp(p, gbpEurRate);
      if (!bucket[market]) {
        bucket[market] = { notionalGbp: 0, missing: 0 };
      }
      if (notional != null && Number.isFinite(notional)) {
        bucket[market].notionalGbp += notional;
      } else {
        bucket[market].missing += 1;
      }
    }
    const rows = Object.entries(bucket).map(([market, v]) => ({
      market,
      notionalGbp: v.notionalGbp,
      missing: v.missing,
    }));
    const total = rows.reduce((s, r) => s + r.notionalGbp, 0);
    return rows
      .map((r) => ({
        ...r,
        pct: total > 0 ? (r.notionalGbp / total) * 100 : 0,
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [positions, gbpEurRate]);

  const concentrationFlag = marketExposure.find((m) => m.pct > 60);
  const tenorBuckets = useMemo(() => {
    const today = new Date();
    let near = 0;
    let medium = 0;
    let long = 0;
    let none = 0;
    const total = positions.length || 1;
    for (const p of positions) {
      // Prefer the stored expiry_date, but fall back to deriving it from the
      // tenor label so older positions imported before tenor->expiry
      // back-fill was in place still bucket correctly.
      const derived = p.expiry_date ?? tenorToExpiryDate(p.tenor);
      if (!derived) {
        none += 1;
        continue;
      }
      const days = (new Date(derived).getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
      if (days <= 90) near += 1;
      else if (days <= 365) medium += 1;
      else long += 1;
    }
    return {
      near: (near / total) * 100,
      medium: (medium / total) * 100,
      long: (long / total) * 100,
      none: (none / total) * 100,
    };
  }, [positions]);

  const mwPositions = positions.filter(
    (p) => (p.unit ?? "").toLowerCase() === "mw",
  );
  const netLongMW = mwPositions
    .filter((p) => p.direction === "long")
    .reduce((sum, p) => sum + (p.size ?? 0), 0);
  const netShortMW = mwPositions
    .filter((p) => p.direction === "short")
    .reduce((sum, p) => sum + (p.size ?? 0), 0);
  const netDelta = netLongMW - netShortMW;
  const totalExposure = netLongMW + netShortMW;
  const longPct =
    totalExposure > 0
      ? Number(((netLongMW / totalExposure) * 100).toFixed(0))
      : 0;
  const shortPct =
    totalExposure > 0
      ? Number(((netShortMW / totalExposure) * 100).toFixed(0))
      : 0;

  const savedMaxPositionMw = useMemo(() => {
    const n = Number(maxPositionMwInput);
    return maxPositionMwInput.trim() !== "" && Number.isFinite(n) ? n : null;
  }, [maxPositionMwInput]);
  const savedMaxVarGbp = useMemo(() => {
    const n = Number(maxVarGbpInput);
    return maxVarGbpInput.trim() !== "" && Number.isFinite(n) ? n : null;
  }, [maxVarGbpInput]);
  const savedMaxDrawdownGbp = useMemo(() => {
    const n = Number(maxDrawdownGbpInput);
    return maxDrawdownGbpInput.trim() !== "" && Number.isFinite(n) ? n : null;
  }, [maxDrawdownGbpInput]);

  const currentVaRMagnitude =
    dailyPnLSeries.length === 0 ? 0 : Math.abs(var95);
  const worstDayLossMag =
    worstDay && worstDay.pnl < 0 ? Math.abs(worstDay.pnl) : 0;

  const positionLimitSeverity = limitSeverity(totalExposure, savedMaxPositionMw);
  const varLimitSeverity = limitSeverity(currentVaRMagnitude, savedMaxVarGbp);
  const drawdownLimitSeverity = limitSeverity(worstDayLossMag, savedMaxDrawdownGbp);

  const hasPositions = positions.length > 0;
  const noHistory = dailyPnLSeries.length === 0;
  // Positions with markets we can't mark are silently skipped in VaR/CVaR
  // and stress — list them so traders know the headline numbers are
  // incomplete.
  const unmarkablePositions = useMemo(
    () => positions.filter((p) => !isRiskMarkableMarket(p.market)),
    [positions],
  );
  // Coverage = how much of the 120-day risk lookback we actually have
  // simulated daily P&L for. Previously this divided by 20 (the minimum
  // days for a meaningful empirical VaR), so a book with just 21 days of
  // simulated P&L would show "100% coverage" — true to the reliability
  // threshold but misleading as a data-depth signal for traders.
  const coveragePct = Math.min(
    100,
    (dailyPnLSeries.length / RISK_LOOKBACK_DAYS) * 100,
  );
  const reliabilityLabel = formatReliabilityConfidenceDesk(
    reliabilityConfidenceFromVaRHistoryDays(dailyPnLSeries.length),
  );
  const hasAnyPriceSeries =
    Object.keys(powerPricesByDay).length > 0 ||
    Object.keys(ttfPricesByDay).length > 0 ||
    Object.keys(nbpPricesByDay).length > 0 ||
    Object.keys(ukaPricesByDay).length > 0 ||
    Object.keys(euaPricesByDay).length > 0;

  return (
    <TierGate
      requiredTier="pro"
      currentTier={currentTier}
      featureName="Portfolio Risk"
      description="Value at Risk, stress tests, and concentration analysis for your book. Available on the Pro plan."
      mockup={
        <div className="space-y-4 p-6">
          <div className="h-9 w-20 rounded bg-ink/10" />
          <div className="h-4 w-60 rounded bg-ink/8" />
          <div className="grid grid-cols-3 gap-3">
            {["VAR 95", "CVAR 95", "WORST STRESS"].map((l) => (
              <div key={l} className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-4">
                <div className="mb-3 h-3 w-16 rounded bg-ink/10" />
                <div className="mb-2 h-8 w-24 rounded bg-ink/15" />
                <div className="h-3 w-20 rounded bg-ink/8" />
              </div>
            ))}
          </div>
          <div className="h-48 rounded-[4px] border-[0.5px] border-ivory-border bg-card p-4" />
          <div className="h-32 rounded-[4px] border-[0.5px] border-ivory-border bg-card p-4" />
        </div>
      }
    >
      <div className="space-y-10">
        <div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-4xl font-serif text-ink-dark mb-1">Risk</h1>
            <p className="text-sm text-ink-light mb-6">
              Value at Risk, stress tests, and concentration analysis for your current book.
            </p>
          </motion.div>
        </div>

        {loading ? (
          <p className="text-sm text-ink-mid">Loading risk analysis…</p>
        ) : !userId ? (
          <p className="text-sm text-ink-mid">Sign in to view risk analysis.</p>
        ) : !hasPositions ? (
        <div className="flex flex-col items-center justify-center rounded-[4px] border-[0.5px] border-ivory-border bg-card px-6 py-16 text-center">
          <p className="font-serif text-xl text-ink">No positions to analyse</p>
          <p className="mt-2 max-w-md text-sm text-ink-mid">
            Import positions in the Book tab to see risk analysis.
          </p>
        </div>
      ) : (
        <>
          {loadError ? (
            <p className="text-sm text-[#8B3A3A]">{loadError}</p>
          ) : null}
          {!loadError && !hasAnyPriceSeries ? (
            <p className="text-sm text-ink-mid">
              Insufficient aligned market history for risk calculations. Risk
              metrics will appear once price series data is available.
            </p>
          ) : null}
          {unmarkablePositions.length > 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-[4px] border-[0.5px] border-amber-700/30 bg-amber-50/60 px-4 py-3"
              role="status"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-900">
                No mark source
              </p>
              <p className="mt-1 text-sm text-amber-900">
                {unmarkablePositions.length === 1
                  ? "1 position is"
                  : `${unmarkablePositions.length} positions are`}{" "}
                excluded from VaR, CVaR and stress calculations because no live
                mark series is wired up for{" "}
                {Array.from(
                  new Set(
                    unmarkablePositions.map((p) => p.market ?? "unknown"),
                  ),
                ).join(", ")}
                . Supported markets: GB Power, TTF, NBP, UKA, EUA.
              </p>
            </motion.div>
          ) : null}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 py-4"
          >
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-light">
              Confidence {reliabilityLabel} · coverage {coveragePct.toFixed(0)}% · historical mark-to-market
            </p>
            <div className="flex flex-col gap-6 sm:flex-row sm:gap-0">
              <div className="flex-1 min-w-0 sm:border-r-[0.5px] sm:border-ivory-border sm:pr-6 sm:mr-6">
                <p className={sectionLabel}>95% 1-day VaR</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                  {noHistory ? "—" : formatGbp(Math.abs(var95))}
                </p>
                <p className="mt-1 text-xs text-ink-light">
                  {noHistory
                    ? "Accumulating data"
                    : `Based on ${dailyPnLSeries.length} days`}
                </p>
              </div>
              <div className="flex-1 min-w-0 sm:border-r-[0.5px] sm:border-ivory-border sm:pr-6 sm:mr-6">
                <p className={sectionLabel}>99% 1-day VaR</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                  {/* Empirical 99% VaR reads the ~1st-worst day in the series; with
                      fewer than 100 days that estimate is pinned to one outlier
                      and carries no real information. Hold the tile until depth
                      is meaningful. */}
                  {dailyPnLSeries.length < 100 ? "—" : formatGbp(Math.abs(var99))}
                </p>
                <p className="mt-1 text-xs text-ink-light">
                  {dailyPnLSeries.length < 100
                    ? `Need 100+ days (have ${dailyPnLSeries.length})`
                    : `Historical · ${dailyPnLSeries.length} days`}
                </p>
              </div>
              <div className="flex-1 min-w-0">
                <p className={sectionLabel}>Worst day</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[#8B3A3A]">
                  {worstDay ? formatSignedGbp(worstDay.pnl) : "—"}
                </p>
                <p
                  className="mt-1 text-xs text-ink-light"
                  title={
                    bookStartDate
                      ? `Worst daily P&L since you opened this book on ${formatDay(bookStartDate)}. Pre-book simulated days are excluded from this tile.`
                      : "Worst daily P&L across the simulation window."
                  }
                >
                  {worstDay
                    ? `${formatDay(worstDay.date)} · since book opened`
                    : bookStartDate
                      ? "No days since book opened yet"
                      : "Accumulating data"}
                </p>
              </div>
            </div>
            <p className="mt-4 font-mono text-[10px] text-ink-light leading-relaxed">
              EUR/GBP {gbpEurRate.toFixed(4)} · {dailyPnLSeries.length} days of history ·
              Historical VaR uses date-aligned rates from fx_rates
            </p>
          </motion.div>

          <section>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <p className={sectionLabel}>Stress simulation</p>
                <h2 className="mt-1 font-serif text-xl text-ink">
                  Simulated daily P&amp;L
                </h2>
                <p className="mt-1 text-xs italic text-ink-light">
                  Reprices your current book against the last {RISK_LOOKBACK_DAYS} days of market moves. Not a record of realised P&amp;L. Bars left of the &quot;book opened&quot; marker show what today&apos;s positions would have returned on days before you held them.
                </p>
              </div>
              <div
                role="group"
                aria-label="Histogram window"
                className="inline-flex shrink-0 rounded-[4px] border-[0.5px] border-ivory-border bg-card p-0.5"
              >
                {([
                  { id: "book", label: "Since book opened" },
                  { id: "30d", label: "30d" },
                  { id: "90d", label: "90d" },
                  { id: "120d", label: "120d" },
                ] as const).map((opt) => {
                  const active = histogramWindow === opt.id;
                  const disabled = opt.id === "book" && !bookStartDate;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={disabled}
                      aria-pressed={active}
                      onClick={() => setHistogramWindow(opt.id)}
                      className={`rounded-[3px] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.08em] transition-colors ${
                        active
                          ? "bg-ink text-ivory"
                          : "text-ink-mid hover:bg-ivory-border/50"
                      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {noHistory ? (
              <p className="mt-4 text-sm text-ink-mid">
                No price history available yet. P&amp;L tracking begins once prices are recorded across multiple days.
              </p>
            ) : visibleSeries.length === 0 ? (
              <p className="mt-4 text-sm text-ink-mid">
                No simulated days in this window. Try widening the lookback.
              </p>
            ) : (
              <div className="mt-4 rounded-[6px] border-[0.5px] border-ivory-border bg-card px-3 pt-6 pb-3">
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart
                    data={visibleSeries}
                    margin={{ top: 12, right: 10, left: 0, bottom: 0 }}
                  >
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatDay}
                      tick={{ fontSize: 10, fill: "var(--ink-mid)" }}
                    />
                    <YAxis
                      tickFormatter={(v) => `£${Math.round(v).toLocaleString("en-GB")}`}
                      tick={{ fontSize: 10, fill: "var(--ink-mid)" }}
                    />
                    <Tooltip
                      content={
                        <DailyPnlTooltip bookStartDate={bookStartDate} />
                      }
                      cursor={{ fill: "rgba(0,0,0,0.04)" }}
                    />
                    <ReferenceLine y={0} stroke="#9ca3af" />
                    {var95 < 0 ? (
                      <ReferenceLine y={var95} stroke={TERRACOTTA} strokeDasharray="4 2" label="95% VaR" />
                    ) : null}
                    {bookStartMarkerDate ? (
                      <ReferenceLine
                        x={bookStartMarkerDate}
                        stroke="var(--ink-mid)"
                        strokeDasharray="3 3"
                        label={{
                          value: "Book opened",
                          position: "insideTopRight",
                          fill: "var(--ink-mid)",
                          fontSize: 10,
                        }}
                      />
                    ) : null}
                    <Bar dataKey="pnl">
                      {visibleSeries.map((d) => {
                        const preBook =
                          bookStartDate != null && d.date < bookStartDate;
                        const base = d.pnl >= 0 ? BRAND_GREEN : TERRACOTTA;
                        return (
                          <Cell
                            key={d.date}
                            fill={base}
                            fillOpacity={preBook ? 0.3 : 1}
                          />
                        );
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-mid">
                  <span>Average daily P&amp;L: {formatGbp(visibleAvgPnL)}</span>
                  <span>Daily volatility: {formatGbp(visibleDailyVol)}</span>
                  <span>Annualised volatility: {formatGbp(visibleAnnualisedVol)}</span>
                  {visibleSeries.length >= 20 && (
                    <span>Sharpe equivalent: {visibleSharpe.toFixed(1)}</span>
                  )}
                </div>
                <p className="mt-2 text-xs italic text-ink-light">
                  Based on {visibleSeries.length} simulated days in this window
                  {bookStartDate
                    ? ` · book opened ${formatDay(bookStartDate)}`
                    : ""}
                  · VaR tiles above use the full {RISK_LOOKBACK_DAYS}-day sample regardless of this selection
                </p>
                {outlierDay ? (
                  <div
                    className="mt-3 rounded-[4px] border-[0.5px] border-amber-700/30 bg-amber-50/60 px-3 py-2"
                    role="status"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-900">
                      Outlier day
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-900">
                      <span className="font-semibold">
                        {formatDay(outlierDay.day.date)}
                      </span>{" "}
                      {formatSignedGbp(outlierDay.day.pnl)} is{" "}
                      {(
                        Math.abs(outlierDay.day.pnl) /
                        Math.max(outlierDay.restStd, 1)
                      ).toFixed(1)}
                      σ vs the rest of this window. Biggest contributors:{" "}
                      {MARKET_ORDER.filter(
                        (m) =>
                          outlierDay.day.byMarket[m] != null &&
                          outlierDay.day.byMarket[m] !== 0,
                      )
                        .sort(
                          (a, b) =>
                            Math.abs(outlierDay.day.byMarket[b] ?? 0) -
                            Math.abs(outlierDay.day.byMarket[a] ?? 0),
                        )
                        .slice(0, 3)
                        .map((m) => {
                          const contrib = outlierDay.day.byMarket[m] ?? 0;
                          const move = outlierDay.day.moves[m];
                          return `${MARKET_LABEL[m]} ${formatSignedGbp(contrib)}${
                            move != null ? ` (Δ ${formatMove(m, move)})` : ""
                          }`;
                        })
                        .join(" · ") || "—"}
                      . One large day can dominate daily vol and Sharpe; hover
                      the bar for the full breakdown and verify the raw price
                      move is real before trusting the headline numbers.
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <section>
            <p className={sectionLabel}>Position risk</p>
            <h2 className="mt-1 font-serif text-xl text-ink">Risk by position</h2>
            <p className="mt-1 text-sm text-ink-light">
              Each position&apos;s contribution to portfolio VaR. Worst-day values are simulated against the last {RISK_LOOKBACK_DAYS} days of market moves, not realised P&amp;L.
            </p>
            <div className="mt-4 rounded-[6px] border-[0.5px] border-ivory-border bg-card">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-ivory-border text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-mid">
                    <th className="px-4 py-3">Instrument</th>
                    <th className="px-3 py-3">Dir</th>
                    <th className="px-3 py-3">Size</th>
                    <th className="px-3 py-3">Worst day</th>
                    <th
                      className="px-3 py-3"
                      title="Share of gross portfolio risk — each position's worst-day loss divided by the sum of every position's worst-day loss (absolute). Rows add to 100%."
                    >
                      Share of gross risk
                    </th>
                    <th className="px-4 py-3">Market</th>
                  </tr>
                </thead>
                <tbody>
                  {perPositionRisk.map(({ position, worst }) => {
                    const pct = noHistory
                      ? 0
                      : (Math.abs(worst?.pnl ?? 0) / grossRiskBase) * 100;
                    return (
                      <tr key={position.id} className="border-b border-ivory-border/80">
                        <td className="px-4 py-3 text-ink">{position.instrument ?? "—"}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            position.direction === "short" ? "bg-[#8B3A3A]/15 text-[#8B3A3A]" : "bg-[#1D6B4E]/15 text-[#1D6B4E]"
                          }`}>
                            {position.direction === "short" ? "SHORT" : "LONG"}
                          </span>
                        </td>
                        <td className="px-3 py-3 tabular-nums text-ink-mid">{position.size ?? 0} {position.unit ?? ""}</td>
                        <td className="px-3 py-3 tabular-nums text-ink-mid">
                          {noHistory ? "—" : worst ? `${formatSignedGbp(worst.pnl)} (${formatDay(worst.date)})` : "—"}
                        </td>
                        <td className="px-3 py-3 text-ink-mid">
                          {noHistory ? "—" : `${pct.toFixed(0)}%`}
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-ivory-border/60">
                            <div className="h-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: position.direction === "short" ? TERRACOTTA : BRAND_GREEN }} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-ink-mid">{position.market ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              <div className="border-t-[0.5px] border-ivory-border px-4 pt-3 mt-3 pb-3">
                <p className="text-[11px] text-ink-light">
                  Share of gross risk sums to 100% across rows. Portfolio VaR can be
                  lower than the sum of individual worst-day losses when positions
                  offset each other — that gap is the diversification benefit below.
                </p>
                {diversificationBenefit > 0 ? (
                  <p className="mt-2 text-[11px] text-ink">
                    Diversification benefit:{" "}
                    <span className="font-semibold">{formatGbp(diversificationBenefit)}</span>
                    <span className="text-ink-light">
                      {" "}
                      · your positions partially offset each other&apos;s risk
                    </span>
                  </p>
                ) : null}
              </div>
            </div>
            {noHistory ? (
              <p className="mt-2 text-xs text-ink-light">Risk metrics accumulate with price history</p>
            ) : null}
          </section>

          <section>
            <p className={sectionLabel}>Stress testing</p>
            <h2 className="mt-1 font-serif text-xl text-ink">Historical scenario analysis</h2>
            <p className="mt-1 text-sm text-ink-light">
              Stylised shocks to GB power, TTF, and NBP — illustrative stress on your
              current book, not a forecast of future P&amp;L.
            </p>
            <p className="mt-1 text-[10px] leading-snug text-ink-light">
              {RISK_HISTORICAL_NOTE}
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {scenarioResults.map(({ scenario, total, breakdown }) => {
                const sorted = [...breakdown].sort(
                  (a, b) => Math.abs(b.impact) - Math.abs(a.impact),
                );
                const topLegs = sorted.slice(0, 3);
                const expanded = expandedScenarios[scenario.name] ?? false;
                return (
                  <article
                    key={scenario.name}
                    className="rounded-lg border-[0.5px] border-ivory-border bg-card p-5"
                    style={{
                      borderLeft: `3px solid ${total >= 0 ? BRAND_GREEN : TERRACOTTA}`,
                    }}
                  >
                    <p className="text-[10px] uppercase tracking-[0.12em] text-ink-light">
                      {scenario.period}
                    </p>
                    <h3 className="mt-1 font-serif text-xl text-ink">{scenario.name}</h3>
                    <p className="mt-1 text-xs italic text-ink-light">{scenario.description}</p>
                    <p
                      className={`mt-4 text-3xl font-serif ${total >= 0 ? "text-[#1D6B4E]" : "text-[#8B3A3A]"}`}
                    >
                      {formatSignedGbp(total)}
                    </p>
                    <span
                      className={`mt-2 inline-block rounded px-2 py-1 text-[10px] font-semibold uppercase ${
                        total >= 0
                          ? "bg-[#1D6B4E]/15 text-[#1D6B4E]"
                          : "bg-[#8B3A3A]/15 text-[#8B3A3A]"
                      }`}
                    >
                      {total >= 0 ? "STRESS GAIN" : "STRESS LOSS"}
                    </span>
                    <div className="my-3 border-t border-ivory-border" />
                    {breakdown.length === 0 ? (
                      <p className="text-xs text-ink-mid">No direct exposure in this scenario.</p>
                    ) : (
                      <>
                        <p className="text-[10px] uppercase tracking-[0.1em] text-ink-light">
                          Position legs ({breakdown.length})
                        </p>
                        <ul className="mt-2 space-y-1.5 text-xs text-ink-mid">
                          {(expanded ? sorted : topLegs).map((b, i) => (
                            <li
                              key={`${b.instrument}-${i}`}
                              className="flex justify-between gap-2 border-b border-ivory-border/60 pb-1.5 font-mono last:border-0"
                            >
                              <span className="min-w-0 truncate">{b.instrument}</span>
                              <span className="shrink-0 tabular-nums">
                                {formatSignedGbp(b.impact)}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {breakdown.length > 3 ? (
                          <button
                            type="button"
                            className="mt-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-mid transition-colors hover:text-ink"
                            onClick={() =>
                              setExpandedScenarios((prev) => ({
                                ...prev,
                                [scenario.name]: !expanded,
                              }))
                            }
                          >
                            {expanded
                              ? "Hide leg detail"
                              : `Show all ${breakdown.length} legs`}
                          </button>
                        ) : null}
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <section>
            <p className={sectionLabel}>Concentration</p>
            <h2 className="mt-1 font-serif text-xl text-ink">Concentration analysis</h2>
            <p className="mt-1 text-sm text-ink-light">Diversification across markets, tenors, and directions</p>
            <div className="mt-4 space-y-6 rounded-[6px] border-[0.5px] border-ivory-border bg-card px-5 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-mid">
                  Market concentration
                </p>
                <p className="mt-1 text-[11px] text-ink-light">
                  Share of book by £ notional (size × entry price, FX-adjusted).
                </p>
                <div className="mt-3 space-y-3">
                  {marketExposure.map((m) => (
                    <div key={m.market}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-ink">{m.market}</span>
                        <span className="text-ink-mid tabular-nums">
                          {m.pct.toFixed(0)}% · £
                          {m.notionalGbp.toLocaleString("en-GB", {
                            maximumFractionDigits: 0,
                          })}
                          {m.missing > 0 ? (
                            <span
                              className="ml-1 text-ink-light"
                              title="Some positions in this market have no trade_price set and are excluded from the notional calculation."
                            >
                              ({m.missing} unpriced)
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-sm bg-ivory-border/60">
                        <div
                          className="h-full rounded-sm"
                          style={{ width: `${m.pct}%`, backgroundColor: BRAND_GREEN }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {concentrationFlag ? (
                  <p className="mt-3 text-sm text-[#8B3A3A]">
                    ⚠ Concentrated in {concentrationFlag.market} — single market represents {concentrationFlag.pct.toFixed(0)}% of book notional
                  </p>
                ) : null}
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-mid">Tenor concentration</p>
                <div className="mt-3 space-y-3">
                  {[
                    { label: "Near-term (≤90d)", value: tenorBuckets.near },
                    { label: "Medium-term (90-365d)", value: tenorBuckets.medium },
                    { label: "Long-term (>365d)", value: tenorBuckets.long },
                    { label: "No expiry set", value: tenorBuckets.none },
                  ].map((row) => (
                    <div key={row.label}>
                      <div className="flex justify-between text-sm">
                        <span className="text-ink">{row.label}</span>
                        <span className="text-ink-mid">{row.value.toFixed(0)}%</span>
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-sm bg-ivory-border/60">
                        <div className="h-full rounded-sm" style={{ width: `${row.value}%`, backgroundColor: BRAND_GREEN }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-mid">Direction exposure</p>
                <p className="mt-2 text-sm text-[#1D6B4E]">Long exposure: {netLongMW.toLocaleString("en-GB")} MW ({longPct}%)</p>
                <p className="text-sm text-[#8B3A3A]">Short exposure: {netShortMW.toLocaleString("en-GB")} MW ({shortPct}%)</p>
                <p className="mt-1 text-sm text-ink-mid">
                  Net delta: {netDelta >= 0 ? "+" : "−"}{Math.abs(netDelta).toLocaleString("en-GB")} MW {netDelta >= 0 ? "net long" : "net short"}
                </p>
                <div className="mt-2 flex h-2 w-full overflow-hidden rounded-sm bg-ivory-border/60">
                  <div className="h-full" style={{ width: `${longPct}%`, backgroundColor: BRAND_GREEN }} />
                  <div className="h-full" style={{ width: `${shortPct}%`, backgroundColor: TERRACOTTA }} />
                </div>
                <p className="mt-1 text-xs text-ink-light">
                  MW positions only · gas positions in therms excluded
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[6px] border-[0.5px] border-ivory-border bg-card px-5 py-5">
            <p className={sectionLabel}>Risk limits</p>
            <h2 className="mt-1 font-serif text-xl text-ink">Configure limits</h2>
            <p className="mt-1 text-sm text-ink-light">
              Optional caps on book size and loss metrics. Leave a field empty if you do not want a limit on that
              dimension.
            </p>
            {riskLimitsFetchError ? (
              <p className="mt-3 text-xs text-[#8B3A3A]" role="alert">
                Could not load saved limits: {riskLimitsFetchError}
              </p>
            ) : null}
            <div className="mt-6 space-y-6">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="risk-limit-mw" className={sectionLabel}>
                    Max position size
                  </label>
                  <LimitStatusBadge severity={positionLimitSeverity} />
                </div>
                <p className="mt-1 text-xs text-ink-light">
                  Gross MW exposure (long plus short legs) on power markets — compared to your book summary above.
                </p>
                <input
                  id="risk-limit-mw"
                  type="number"
                  min={0}
                  step={0.1}
                  inputMode="decimal"
                  value={maxPositionMwInput}
                  onChange={(e) => setMaxPositionMwInput(e.target.value)}
                  placeholder="No limit"
                  className="mt-2 w-full max-w-xs rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2.5 text-sm text-ink outline-none focus:border-ink/40"
                />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="risk-limit-var" className={sectionLabel}>
                    Max VaR (95%)
                  </label>
                  <LimitStatusBadge severity={varLimitSeverity} />
                </div>
                <p className="mt-1 text-xs text-ink-light">
                  One-day 95% VaR in £ — compared to the headline VaR figure on this page once history is available.
                </p>
                <input
                  id="risk-limit-var"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="decimal"
                  value={maxVarGbpInput}
                  onChange={(e) => setMaxVarGbpInput(e.target.value)}
                  placeholder="No limit"
                  className="mt-2 w-full max-w-xs rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2.5 text-sm text-ink outline-none focus:border-ink/40"
                />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="risk-limit-dd" className={sectionLabel}>
                    Max drawdown
                  </label>
                  <LimitStatusBadge severity={drawdownLimitSeverity} />
                </div>
                <p className="mt-1 text-xs text-ink-light">
                  Largest single-day loss in £ on your current book — compared to the worst day shown above.
                </p>
                <input
                  id="risk-limit-dd"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="decimal"
                  value={maxDrawdownGbpInput}
                  onChange={(e) => setMaxDrawdownGbpInput(e.target.value)}
                  placeholder="No limit"
                  className="mt-2 w-full max-w-xs rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2.5 text-sm text-ink outline-none focus:border-ink/40"
                />
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={limitsSaving || !userId}
                onClick={() => void saveRiskLimits()}
                className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-dark px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:border-ink/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {limitsSaving ? "Saving…" : "Save limits"}
              </button>
              {limitsMessage ? (
                <span className="text-xs font-medium text-[#1D6B4E]">{limitsMessage}</span>
              ) : null}
              {limitsError ? (
                <span className="text-xs text-[#8B3A3A]" role="alert">
                  {limitsError}
                </span>
              ) : null}
            </div>
          </section>
        </>
      )}
      </div>
    </TierGate>
  );
}
