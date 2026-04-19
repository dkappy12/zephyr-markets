"use client";

import { TierGate } from "@/components/billing/TierGate";
import {
  rechartsTooltipContentStyle,
  rechartsTooltipItemStyle,
  rechartsTooltipLabelStyle,
} from "@/lib/charts/recharts-tooltip-styles";
import { RISK_HISTORICAL_NOTE } from "@/lib/portfolio/desk-copy";
import { PORTFOLIO_STRESS_SCENARIOS } from "@/lib/portfolio/stress-scenarios-data";
import {
  formatReliabilityConfidenceDesk,
  reliabilityConfidenceFromVaRHistoryDays,
} from "@/lib/reliability/contract";
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
};

type PowerPriceRow = {
  price_gbp_mwh: number | null;
  price_date: string;
  settlement_period: number | null;
};

type GasPriceRow = {
  price_eur_mwh: number | null;
  price_time: string;
  hub: string | null;
};

type FxRateRow = {
  rate_date: string;
  rate: number | null;
};

type DailyPnL = { date: string; pnl: number };

type Scenario = {
  name: string;
  period: string;
  description: string;
  moves: { GB_power: number; TTF: number; NBP: number };
};

const STRESS_SCENARIOS: Scenario[] = PORTFOLIO_STRESS_SCENARIOS.map((s) => ({
  name: s.name,
  period: s.period,
  description: s.description,
  moves: { GB_power: s.gbPowerMove, TTF: s.ttfMoveEurMwh, NBP: s.nbpMovePth },
}));

function asNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function asDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** Earliest calendar day the user had any row in `positions` (Book), for trimming tape-backed history. */
function earliestBookActivityDate(
  rows: readonly { entry_date?: string | null; created_at?: string | null }[],
): string | null {
  let minD: string | null = null;
  for (const r of rows) {
    const rawEntry = r.entry_date?.trim() ?? "";
    const fromCreated = r.created_at ? asDateOnly(String(r.created_at)) : "";
    const d = /^\d{4}-\d{2}-\d{2}$/.test(rawEntry)
      ? rawEntry
      : fromCreated || null;
    if (!d) continue;
    if (minD == null || d < minD) minD = d;
  }
  return minD;
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

const calculateDailyPnL = (
  positions: PositionRow[],
  powerPricesByDay: Record<string, number>,
  ttfPricesByDay: Record<string, number>,
  nbpPricesByDay: Record<string, number>,
  fxByDay: Record<string, number>,
  options?: { minResultDate?: string | null },
): DailyPnL[] => {
  const minResultDate = options?.minResultDate ?? null;
  const dateUniverse = new Set<string>([
    ...Object.keys(powerPricesByDay),
    ...Object.keys(ttfPricesByDay),
    ...Object.keys(nbpPricesByDay),
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

    for (const pos of positions) {
      const direction = pos.direction === "long" ? 1 : -1;
      const size = pos.size ?? 0;

      if (isGbPowerMarket(pos.market)) {
        const prevPrice = powerPricesByDay[prevDate];
        const currPrice = powerPricesByDay[currDate];
        if (prevPrice == null || currPrice == null) continue;
        dayPnL += (currPrice - prevPrice) * size * direction;
        hasContributingSeries = true;
      } else if (pos.market === "TTF") {
        const prevFx = fxByDay[prevDate] ?? HISTORICAL_GBP_PER_EUR;
        const currFx = fxByDay[currDate] ?? HISTORICAL_GBP_PER_EUR;
        const prevTtf = ttfPricesByDay[prevDate];
        const currTtf = ttfPricesByDay[currDate];
        if (prevTtf == null || currTtf == null) continue;
        const prevPrice = prevTtf * prevFx;
        const currPrice = currTtf * currFx;
        dayPnL += (currPrice - prevPrice) * size * direction;
        hasContributingSeries = true;
      } else if (pos.market === "NBP") {
        const prevNbp = nbpPricesByDay[prevDate];
        const currNbp = nbpPricesByDay[currDate];
        if (prevNbp == null || currNbp == null) continue;
        dayPnL += ((currNbp - prevNbp) * size) / 100 * direction;
        hasContributingSeries = true;
      }
    }
    if (hasContributingSeries) {
      result.push({ date: currDate, pnl: dayPnL });
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
  /** First day the user had any position in Book (all rows); trims global price backfill from charts/VaR. */
  const [bookStartDate, setBookStartDate] = useState<string | null>(null);

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
        setBookStartDate(null);
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
        { data: bookActivityRows, error: bookActivityError },
        { data: powerData, error: powerError },
        { data: gasData, error: gasError },
        { data: fxData, error: fxError },
        { data: riskLimitsData, error: riskLimitsError },
      ] = await Promise.all([
          supabase
            .from("positions")
            .select("*")
            .eq("user_id", user.id)
            .eq("is_closed", false),
          supabase
            .from("positions")
            .select("entry_date, created_at")
            .eq("user_id", user.id),
          supabase
            .from("market_prices")
            .select(
              "price_gbp_mwh, price_date, settlement_period, market, source, volume, fetched_at",
            )
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
      setBookStartDate(
        bookActivityError
          ? earliestBookActivityDate(positionsData ?? [])
          : earliestBookActivityDate(bookActivityRows ?? []),
      );
      setPowerPrices((powerData ?? []) as PowerPriceRow[]);
      setGasPrices((gasData ?? []) as GasPriceRow[]);
      setFxRates((fxData ?? []) as FxRateRow[]);
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

  const powerPricesByDay = useMemo(() => {
    const buckets = new Map<string, { sum: number; count: number }>();
    for (const row of powerPrices) {
      const d = row.price_date;
      const p = asNum(row.price_gbp_mwh);
      const cur = buckets.get(d) ?? { sum: 0, count: 0 };
      cur.sum += p;
      cur.count += 1;
      buckets.set(d, cur);
    }
    const out: Record<string, number> = {};
    for (const [k, v] of buckets) {
      out[k] = v.count > 0 ? v.sum / v.count : 0;
    }
    return out;
  }, [powerPrices]);

  const ttfPricesByDay = useMemo(() => {
    const buckets = new Map<string, { sum: number; count: number }>();
    for (const row of gasPrices) {
      if ((row.hub ?? "").toUpperCase() !== "TTF") continue;
      const d = asDateOnly(row.price_time);
      const p = asNum(row.price_eur_mwh);
      const cur = buckets.get(d) ?? { sum: 0, count: 0 };
      cur.sum += p;
      cur.count += 1;
      buckets.set(d, cur);
    }
    const out: Record<string, number> = {};
    for (const [k, v] of buckets) {
      out[k] = v.count > 0 ? v.sum / v.count : 0;
    }
    return out;
  }, [gasPrices]);

  const nbpPricesByDay = useMemo(() => {
    const buckets = new Map<string, { sum: number; count: number }>();
    for (const row of gasPrices) {
      if ((row.hub ?? "").toUpperCase() !== "NBP") continue;
      const d = asDateOnly(row.price_time);
      const p = asNum(row.price_eur_mwh);
      const cur = buckets.get(d) ?? { sum: 0, count: 0 };
      cur.sum += p;
      cur.count += 1;
      buckets.set(d, cur);
    }
    const out: Record<string, number> = {};
    for (const [k, v] of buckets) {
      out[k] = v.count > 0 ? v.sum / v.count : 0;
    }
    return out;
  }, [gasPrices]);

  const fxByDay = useMemo(() => {
    const out: Record<string, number> = {};
    for (const row of fxRates) {
      if (!row.rate_date) continue;
      const rate = asNum(row.rate);
      if (rate > 0) out[row.rate_date.slice(0, 10)] = rate;
    }
    return out;
  }, [fxRates]);

  const dailyPnLSeries = useMemo(
    () =>
      calculateDailyPnL(positions, powerPricesByDay, ttfPricesByDay, nbpPricesByDay, fxByDay, {
        minResultDate: bookStartDate,
      }),
    [positions, powerPricesByDay, ttfPricesByDay, nbpPricesByDay, fxByDay, bookStartDate],
  );

  const var95 = calculateVaR(dailyPnLSeries.map((d) => d.pnl), 0.95);
  const var99 = calculateVaR(dailyPnLSeries.map((d) => d.pnl), 0.99);
  const worstDay =
    dailyPnLSeries.length > 0
      ? dailyPnLSeries.reduce((min, d) => (d.pnl < min.pnl ? d : min), dailyPnLSeries[0])
      : null;
  const avgDailyPnL =
    dailyPnLSeries.length > 0
      ? dailyPnLSeries.reduce((sum, d) => sum + d.pnl, 0) / dailyPnLSeries.length
      : 0;
  const variance =
    dailyPnLSeries.length > 0
      ? dailyPnLSeries.reduce((sum, d) => sum + (d.pnl - avgDailyPnL) ** 2, 0) /
        dailyPnLSeries.length
      : 0;
  const dailyVolatility = Math.sqrt(variance);
  const annualisedVolatility = dailyVolatility * Math.sqrt(252);
  const sharpe = dailyVolatility > 0 ? (avgDailyPnL / dailyVolatility) * Math.sqrt(252) : 0;

  const perPositionRisk = useMemo(() => {
    return positions.map((p) => {
      const series = calculateDailyPnL(
        [p],
        powerPricesByDay,
        ttfPricesByDay,
        nbpPricesByDay,
        fxByDay,
        { minResultDate: bookStartDate },
      );
      const worst = series.length > 0 ? series.reduce((min, d) => (d.pnl < min.pnl ? d : min), series[0]) : null;
      return { position: p, worst };
    });
  }, [positions, powerPricesByDay, ttfPricesByDay, nbpPricesByDay, fxByDay, bookStartDate]);

  const sumIndividualVaRs = perPositionRisk.reduce(
    (sum, r) => sum + Math.abs(r.worst?.pnl ?? 0),
    0,
  );
  const diversificationBenefit = sumIndividualVaRs - Math.abs(var95);
  const totalRiskBase = Math.max(Math.abs(var95), 1);

  const scenarioResults = useMemo(
    () => STRESS_SCENARIOS.map((s) => ({ scenario: s, ...calculateScenarioImpact(s, positions, gbpEurRate) })),
    [positions, gbpEurRate],
  );

  const marketExposure = useMemo(() => {
    const bucket: Record<
      string,
      { valueForPct: number; displayValue: number; unit: string }
    > = {};
    for (const p of positions) {
      const market = (p.market ?? "Unknown").toUpperCase();
      const size = Math.abs(p.size ?? 0);
      const unit = (p.unit ?? "").trim() || "units";
      const valueForPct = market === "NBP" ? size / 293.1 : size;
      const key = market;
      if (!bucket[key]) {
        bucket[key] = { valueForPct: 0, displayValue: 0, unit };
      }
      bucket[key].valueForPct += valueForPct;
      bucket[key].displayValue += size;
      if (bucket[key].unit === "units") {
        bucket[key].unit = unit;
      }
    }
    const rows = Object.entries(bucket).map(([market, v]) => ({ market, ...v }));
    const total = rows.reduce((s, r) => s + Math.abs(r.valueForPct), 0);
    return rows
      .map((r) => ({
        ...r,
        pct: total > 0 ? (Math.abs(r.valueForPct) / total) * 100 : 0,
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [positions]);

  const concentrationFlag = marketExposure.find((m) => m.pct > 60);
  const tenorBuckets = useMemo(() => {
    const today = new Date();
    let near = 0;
    let medium = 0;
    let long = 0;
    let none = 0;
    const total = positions.length || 1;
    for (const p of positions) {
      if (!p.expiry_date) {
        none += 1;
        continue;
      }
      const days = (new Date(p.expiry_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
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
  const coveragePct = Math.min(100, (dailyPnLSeries.length / 20) * 100);
  const reliabilityLabel = formatReliabilityConfidenceDesk(
    reliabilityConfidenceFromVaRHistoryDays(dailyPnLSeries.length),
  );
  const hasAnyPriceSeries =
    Object.keys(powerPricesByDay).length > 0 ||
    Object.keys(ttfPricesByDay).length > 0 ||
    Object.keys(nbpPricesByDay).length > 0;

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
                  {dailyPnLSeries.length < 5 ? "—" : formatGbp(Math.abs(var99))}
                </p>
                <p className="mt-1 text-xs text-ink-light">
                  {dailyPnLSeries.length < 5
                    ? "Need 5+ days of data"
                    : `Historical · ${dailyPnLSeries.length} days`}
                </p>
              </div>
              <div className="flex-1 min-w-0">
                <p className={sectionLabel}>Worst day</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[#8B3A3A]">
                  {worstDay ? formatSignedGbp(worstDay.pnl) : "—"}
                </p>
                <p className="mt-1 text-xs text-ink-light">
                  {worstDay ? formatDay(worstDay.date) : "Accumulating data"}
                </p>
              </div>
            </div>
            <p className="mt-4 font-mono text-[10px] text-ink-light leading-relaxed">
              EUR/GBP {gbpEurRate.toFixed(4)} · {dailyPnLSeries.length} days of history ·
              Historical VaR uses date-aligned rates from fx_rates
            </p>
          </motion.div>

          <section>
            <p className={sectionLabel}>Distribution</p>
            <h2 className="mt-1 font-serif text-xl text-ink">Daily P&amp;L Distribution</h2>
            <p className="mt-1 text-xs italic text-ink-light">
              Historical daily mark-to-market moves on your current book · accuracy improves as data accumulates
            </p>
            {noHistory ? (
              <p className="mt-4 text-sm text-ink-mid">
                No price history available yet. P&amp;L tracking begins once prices are recorded across multiple days.
              </p>
            ) : (
              <div className="mt-4 rounded-[6px] border-[0.5px] border-ivory-border bg-card px-3 py-3">
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={dailyPnLSeries}>
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
                      contentStyle={rechartsTooltipContentStyle}
                      labelStyle={rechartsTooltipLabelStyle}
                      itemStyle={rechartsTooltipItemStyle}
                      formatter={(v) => [`£${Math.round(Number(v)).toLocaleString("en-GB")}`, "P&L"]}
                      labelFormatter={(d) => formatDay(String(d))}
                    />
                    <ReferenceLine y={0} stroke="#9ca3af" />
                    {var95 < 0 ? (
                      <ReferenceLine y={var95} stroke={TERRACOTTA} strokeDasharray="4 2" label="95% VaR" />
                    ) : null}
                    <Bar dataKey="pnl">
                      {dailyPnLSeries.map((d) => (
                        <Cell key={d.date} fill={d.pnl >= 0 ? BRAND_GREEN : TERRACOTTA} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-mid">
                  <span>Average daily P&amp;L: {formatGbp(avgDailyPnL)}</span>
                  <span>Daily volatility: {formatGbp(dailyVolatility)}</span>
                  <span>Annualised volatility: {formatGbp(annualisedVolatility)}</span>
                  {dailyPnLSeries.length >= 20 && (
                    <span>Sharpe equivalent: {sharpe.toFixed(1)}</span>
                  )}
                </div>
                <p className="mt-2 text-xs italic text-ink-light">
                  Based on {dailyPnLSeries.length} days · VaR confidence improves significantly after 20 trading days
                </p>
              </div>
            )}
          </section>

          <section>
            <p className={sectionLabel}>Position risk</p>
            <h2 className="mt-1 font-serif text-xl text-ink">Risk by position</h2>
            <p className="mt-1 text-sm text-ink-light">Contribution of each position to total portfolio VaR</p>
            <div className="mt-4 rounded-[6px] border-[0.5px] border-ivory-border bg-card">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-ivory-border text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-mid">
                    <th className="px-4 py-3">Instrument</th>
                    <th className="px-3 py-3">Dir</th>
                    <th className="px-3 py-3">Size</th>
                    <th className="px-3 py-3">Worst day</th>
                    <th className="px-3 py-3">% of total risk</th>
                    <th className="px-4 py-3">Market</th>
                  </tr>
                </thead>
                <tbody>
                  {perPositionRisk.map(({ position, worst }) => {
                    const pct = noHistory ? 0 : (Math.abs(worst?.pnl ?? 0) / totalRiskBase) * 100;
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
                  Individual positions can exceed 100% when others offset portfolio risk.
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
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-mid">Market concentration</p>
                <div className="mt-3 space-y-3">
                  {marketExposure.map((m) => (
                    <div key={m.market}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-ink">{m.market}</span>
                        <span className="text-ink-mid">
                          {m.pct.toFixed(0)}% ·{" "}
                          {m.displayValue.toLocaleString("en-GB", {
                            maximumFractionDigits: 1,
                          })}{" "}
                          {m.unit}
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-sm bg-ivory-border/60">
                        <div className="h-full rounded-sm" style={{ width: `${m.pct}%`, backgroundColor: BRAND_GREEN }} />
                      </div>
                    </div>
                  ))}
                </div>
                {concentrationFlag ? (
                  <p className="mt-3 text-sm text-[#8B3A3A]">
                    ⚠ Concentrated in {concentrationFlag.market} — single market represents {concentrationFlag.pct.toFixed(0)}% of exposure
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
