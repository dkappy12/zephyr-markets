"use client";

import { createBrowserClient } from "@/lib/supabase/client";
import { format, parseISO } from "date-fns";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
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
const AMBER = "#D97706";

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
};

type PowerPriceRow = {
  price_gbp_mwh: number | null;
  price_date: string;
  settlement_period: number | null;
};

type GasPriceRow = {
  price_eur_mwh: number | null;
  price_time: string;
};

type DailyPnL = { date: string; pnl: number };

type Scenario = {
  name: string;
  period: string;
  description: string;
  moves: { GB_power: number; TTF: number; NBP: number };
};

const STRESS_SCENARIOS: Scenario[] = [
  {
    name: "2022 Energy Crisis Peak",
    period: "August 2022",
    description:
      "European gas and power markets reached record highs following supply disruptions",
    moves: { GB_power: 400, TTF: 100, NBP: 150 },
  },
  {
    name: "Ukraine Invasion Spike",
    period: "February 2022",
    description:
      "Immediate market reaction to Russia's invasion of Ukraine",
    moves: { GB_power: 150, TTF: 50, NBP: 60 },
  },
  {
    name: "2021 Gas Supply Crisis",
    period: "October 2021",
    description:
      "Low storage and reduced Norwegian flows drove GB gas to record levels",
    moves: { GB_power: 200, TTF: 80, NBP: 100 },
  },
  {
    name: "Wind Drought Event",
    period: "January 2025",
    description:
      "Sustained low wind output drove gas-marginal pricing across GB",
    moves: { GB_power: 80, TTF: 5, NBP: 8 },
  },
  {
    name: "Renewable Oversupply",
    period: "Summer 2024",
    description:
      "High wind and solar drove negative pricing across multiple settlement periods",
    moves: { GB_power: -40, TTF: -2, NBP: -3 },
  },
];

function asNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function asDateOnly(iso: string): string {
  return iso.slice(0, 10);
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

const calculateDailyPnL = (
  positions: PositionRow[],
  powerPricesByDay: Record<string, number>,
  gasPricesByDay: Record<string, number>,
  gbpEurRate: number,
): DailyPnL[] => {
  const dates = Object.keys(powerPricesByDay).sort();
  const result: DailyPnL[] = [];

  for (let i = 1; i < dates.length; i++) {
    const prevDate = dates[i - 1];
    const currDate = dates[i];
    let dayPnL = 0;

    for (const pos of positions) {
      const direction = pos.direction === "long" ? 1 : -1;
      const size = pos.size ?? 0;

      if (pos.market === "GB_power" || pos.market === "GB POWER") {
        const prevPrice = powerPricesByDay[prevDate] ?? 0;
        const currPrice = powerPricesByDay[currDate] ?? 0;
        dayPnL += (currPrice - prevPrice) * size * direction;
      } else if (pos.market === "TTF") {
        const prevPrice = (gasPricesByDay[prevDate] ?? 0) * gbpEurRate;
        const currPrice = (gasPricesByDay[currDate] ?? 0) * gbpEurRate;
        dayPnL += (currPrice - prevPrice) * size * direction;
      } else if (pos.market === "NBP") {
        const prevNbp = ((gasPricesByDay[prevDate] ?? 0) * gbpEurRate) / 2.931 * 100;
        const currNbp = ((gasPricesByDay[currDate] ?? 0) * gbpEurRate) / 2.931 * 100;
        dayPnL += ((currNbp - prevNbp) * size) / 100 * direction;
      }
    }
    result.push({ date: currDate, pnl: dayPnL });
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

    if (market.includes("GB_POWER") || market.includes("GB POWER")) {
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
  const [gbpEurRate, setGbpEurRate] = useState(0.86);

  useEffect(() => {
    fetch("/api/fx-rate")
      .then((r) => r.json())
      .then((d) => setGbpEurRate(d.rate ?? 0.86))
      .catch(() => setGbpEurRate(0.86));
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
      setUserId(user?.id ?? null);
      if (!user?.id) {
        setPositions([]);
        setPowerPrices([]);
        setGasPrices([]);
        setLoading(false);
        return;
      }

      const [
        { data: positionsData },
        { data: powerData },
        { data: gasData },
        { data: pnlHistory },
        { data: latestPremium },
      ] = await Promise.all([
          supabase
            .from("positions")
            .select("*")
            .eq("user_id", user.id)
            .eq("is_closed", false),
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
            .from("portfolio_pnl")
            .select(
              "date, total_pnl, wind_attribution_gbp, gas_attribution_gbp, remit_attribution_gbp",
            )
            .eq("user_id", user.id)
            .order("date", { ascending: true }),
          supabase
            .from("physical_premium")
            .select("*")
            .order("calculated_at", { ascending: false })
            .limit(1)
            .single(),
      ]);
      void pnlHistory;
      void latestPremium;

      setPositions((positionsData ?? []) as PositionRow[]);
      setPowerPrices((powerData ?? []) as PowerPriceRow[]);
      setGasPrices((gasData ?? []) as GasPriceRow[]);
      setLoading(false);
    }
    void load();
  }, [supabase]);

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

  const gasPricesByDay = useMemo(() => {
    const buckets = new Map<string, { sum: number; count: number }>();
    for (const row of gasPrices) {
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

  const dailyPnLSeries = useMemo(
    () => calculateDailyPnL(positions, powerPricesByDay, gasPricesByDay, gbpEurRate),
    [positions, powerPricesByDay, gasPricesByDay, gbpEurRate],
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
      const series = calculateDailyPnL([p], powerPricesByDay, gasPricesByDay, gbpEurRate);
      const worst = series.length > 0 ? series.reduce((min, d) => (d.pnl < min.pnl ? d : min), series[0]) : null;
      return { position: p, worst };
    });
  }, [positions, powerPricesByDay, gasPricesByDay, gbpEurRate]);

  const sumIndividualVaRs = perPositionRisk.reduce(
    (sum, r) => sum + Math.abs(r.worst?.pnl ?? 0),
    0,
  );
  const diversificationBenefit = sumIndividualVaRs - Math.abs(var95);
  const totalRiskBase = Math.max(Math.abs(var95), 1);
  const anyPositionRiskOver100 =
    !noHistory &&
    perPositionRisk.some(
      ({ worst }) => (Math.abs(worst?.pnl ?? 0) / totalRiskBase) * 100 > 100,
    );

  const scenarioResults = useMemo(
    () => STRESS_SCENARIOS.map((s) => ({ scenario: s, ...calculateScenarioImpact(s, positions, gbpEurRate) })),
    [positions, gbpEurRate],
  );

  const marketExposure = useMemo(() => {
    const bucket: Record<string, { value: number; unit: "MW" | "tCO2" }> = {};
    for (const p of positions) {
      const market = (p.market ?? "Unknown").toUpperCase();
      const size = Math.abs(p.size ?? 0);
      const isCarbon = market === "UKA" || market === "EUA" || (p.instrument_type ?? "").toLowerCase().includes("carbon");
      const value = market === "NBP" ? size / 293.1 : size;
      const key = market;
      if (!bucket[key]) bucket[key] = { value: 0, unit: isCarbon ? "tCO2" : "MW" };
      bucket[key].value += value;
      if (isCarbon) bucket[key].unit = "tCO2";
    }
    const rows = Object.entries(bucket).map(([market, v]) => ({ market, ...v }));
    const total = rows.reduce((s, r) => s + Math.abs(r.value), 0);
    return rows
      .map((r) => ({ ...r, pct: total > 0 ? (Math.abs(r.value) / total) * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct);
  }, [positions]);

  const concentrationFlag = marketExposure.find((m) => m.pct > 60);
  const today = new Date();
  const tenorBuckets = useMemo(() => {
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
  }, [positions, today]);

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

  const hasPositions = positions.length > 0;
  const noHistory = dailyPnLSeries.length === 0;
  const coveragePct = Math.min(100, (dailyPnLSeries.length / 20) * 100);
  const coverageColor = dailyPnLSeries.length < 10 ? TERRACOTTA : dailyPnLSeries.length < 20 ? AMBER : BRAND_GREEN;

  return (
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
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid gap-4 border-b-[0.5px] border-ivory-border bg-ivory px-4 py-4 sm:grid-cols-2 lg:grid-cols-4 sm:px-5"
          >
            <div>
              <p className={sectionLabel}>95% 1-day VaR</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                {noHistory ? "—" : formatGbp(Math.abs(var95))}
              </p>
              <p className="mt-1 text-xs text-ink-light">
                {noHistory ? "Accumulating data" : `Based on ${dailyPnLSeries.length} days of data`}
              </p>
            </div>
            <div>
              <p className={sectionLabel}>99% 1-day VaR</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                {dailyPnLSeries.length < 5 ? "—" : formatGbp(Math.abs(var99))}
              </p>
              <p className="mt-1 text-xs text-ink-light">
                {dailyPnLSeries.length < 5 ? "Need 5+ days" : `Historical · ${dailyPnLSeries.length} days`}
              </p>
            </div>
            <div>
              <p className={sectionLabel}>Worst day</p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-[#8B3A3A]">
                {worstDay ? `${formatSignedGbp(worstDay.pnl)} on ${formatDay(worstDay.date)}` : "Accumulating data"}
              </p>
            </div>
            <div>
              <p className={sectionLabel}>Data coverage</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                {dailyPnLSeries.length} days of history
              </p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-sm bg-ivory-border/60">
                <div className="h-full rounded-sm" style={{ width: `${coveragePct}%`, backgroundColor: coverageColor }} />
              </div>
              <p className="mt-1 text-xs text-ink-light">{dailyPnLSeries.length} / 20 days to full VaR confidence</p>
            </div>
          </motion.div>
          <p className="text-xs text-ink-light text-right">EUR/GBP: {gbpEurRate.toFixed(4)} · via ECB</p>

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
              <div className="mt-4 rounded-[6px] border border-[#D4CCBB] bg-card px-3 py-3">
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={dailyPnLSeries}>
                    <XAxis dataKey="date" tickFormatter={formatDay} tick={{ fontSize: 10, fill: "#6B6760" }} />
                    <YAxis tickFormatter={(v) => `£${Math.round(v).toLocaleString("en-GB")}`} tick={{ fontSize: 10, fill: "#6B6760" }} />
                    <Tooltip
                      contentStyle={{ background: "#F5F0E8", border: "1px solid #D4CCBB", borderRadius: 6, fontSize: 12 }}
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
                  <span>Sharpe equivalent: {sharpe.toFixed(1)}</span>
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
            <div className="mt-4 overflow-x-auto rounded-[6px] border border-[#D4CCBB] bg-card">
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
            {noHistory ? (
              <p className="mt-2 text-xs text-ink-light">Risk metrics accumulate with price history</p>
            ) : null}
            {anyPositionRiskOver100 ? (
              <p className="mt-2 text-xs text-ink-light">
                Individual positions can exceed 100% when others offset portfolio
                risk.
              </p>
            ) : null}
            {diversificationBenefit > 0 ? (
              <p className="mt-3 text-sm text-ink-mid">
                Diversification benefit: {formatGbp(diversificationBenefit)} (your positions partially offset each other&apos;s risk)
              </p>
            ) : null}
          </section>

          <section>
            <p className={sectionLabel}>Stress testing</p>
            <h2 className="mt-1 font-serif text-xl text-ink">Historical scenario analysis</h2>
            <p className="mt-1 text-sm text-ink-light">
              How your current book would have performed during past energy market extremes · price moves are historically observed, not modelled
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {scenarioResults.map(({ scenario, total, breakdown }) => (
                <article
                  key={scenario.name}
                  className="rounded-lg border border-[#D4CCBB] p-5"
                  style={{ borderLeft: `3px solid ${total >= 0 ? BRAND_GREEN : TERRACOTTA}` }}
                >
                  <p className="text-[10px] uppercase tracking-[0.12em] text-ink-light">{scenario.period}</p>
                  <h3 className="mt-1 font-serif text-xl text-ink">{scenario.name}</h3>
                  <p className="mt-1 text-xs italic text-ink-light">{scenario.description}</p>
                  <p className={`mt-4 text-3xl font-serif ${total >= 0 ? "text-[#1D6B4E]" : "text-[#8B3A3A]"}`}>
                    {formatSignedGbp(total)}
                  </p>
                  <span className={`mt-2 inline-block rounded px-2 py-1 text-[10px] font-semibold uppercase ${
                    total >= 0 ? "bg-[#1D6B4E]/15 text-[#1D6B4E]" : "bg-[#8B3A3A]/15 text-[#8B3A3A]"
                  }`}>
                    {total >= 0 ? "STRESS GAIN" : "STRESS LOSS"}
                  </span>
                  <div className="my-3 border-t border-ivory-border" />
                  <div className="space-y-1 text-xs text-ink-mid">
                    {breakdown.length === 0 ? (
                      <p>No direct exposure in this scenario.</p>
                    ) : (
                      breakdown.map((b, i) => (
                        <p key={`${b.instrument}-${i}`}>
                          {b.instrument}: {formatSignedGbp(b.impact)}
                        </p>
                      ))
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section>
            <p className={sectionLabel}>Concentration</p>
            <h2 className="mt-1 font-serif text-xl text-ink">Concentration analysis</h2>
            <p className="mt-1 text-sm text-ink-light">Diversification across markets, tenors, and directions</p>
            <div className="mt-4 space-y-6 rounded-[6px] border border-[#D4CCBB] bg-card px-5 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-mid">Market concentration</p>
                <div className="mt-3 space-y-3">
                  {marketExposure.map((m) => (
                    <div key={m.market}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-ink">{m.market}</span>
                        <span className="text-ink-mid">{m.pct.toFixed(0)}% · {m.value.toFixed(1)} {m.unit}</span>
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
                <p className="mt-2 text-xs text-ink-light">
                  MW-denominated positions only · gas positions excluded from MW
                  delta
                </p>
              </div>
            </div>
          </section>

          <div className="rounded-[6px] border border-[#D4CCBB] bg-transparent px-5 py-5">
            <p className="text-xs uppercase tracking-widest text-ink-light mb-2">RISK LIMITS</p>
            <p className="text-sm text-ink-mid mb-4">
              Set position limits and VaR thresholds to receive alerts when your book approaches defined risk boundaries.
            </p>
            <button
              disabled
              className="text-xs uppercase tracking-widest border border-stone-300 text-stone-400 px-4 py-2 rounded cursor-not-allowed"
            >
              CONFIGURE RISK LIMITS — COMING SOON
            </button>
          </div>
        </>
      )}
    </div>
  );
}
