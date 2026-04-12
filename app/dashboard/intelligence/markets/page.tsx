"use client";

import { createBrowserClient } from "@/lib/supabase/client";
import { parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

const LOC_ORDER = ["DE", "FR", "NL", "AT"] as const;
const BRAND_GREEN = "#1D6B4E";
const INK = "#2C2A26";
const INK_MID = "#6B6760";
const SPARK_NEG = "#8B3A3A";
/** Currency bridge € → £ for TTF (€/MWh). */
const GBP_PER_EUR = 0.86;
const CCGT_ELECTRIC_EFF = 0.5;
/** UKA + CPS stack (£/MWh electric). */
const CARBON_ADDER = 26;
const VOM = 2;
const CO2_INTENSITY = 0.9;
const CO2_PRICE = 71;
const COAL_EFF = 0.36;

function utcTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** SP1 = 00:00 UTC start, 30 min per SP */
function spToUtcHHMM(sp: number): string {
  const mins = Math.max(0, (sp - 1) * 30);
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function spToMinutesFromMidnight(sp: number): number {
  return Math.max(0, (sp - 1) * 30);
}

type MidRow = {
  price_gbp_mwh: number;
  settlement_period: number;
  price_date: string;
  market: string;
  fetched_at: string | null;
  /** MID volume when present in DB */
  volume: number | null;
};

type PhysicalPremiumRow = {
  normalised_score: number | null;
  direction: string | null;
  residual_demand_gw: number | null;
  wind_gw: number | null;
  solar_gw: number | null;
  /** From latest row; Python agent — not summed from raw REMIT signals. */
  remit_mw_lost: number | null;
};

type GasRow = {
  price_eur_mwh: number;
  price_time: string;
};

type StorageRow = {
  location: string;
  full_pct: number | null;
  working_volume_twh: number | null;
  injection_twh: number | null;
  report_date: string;
};

function dedupeMidBySettlement(rows: MidRow[]): MidRow[] {
  const m = new Map<string, MidRow>();
  for (const r of rows) {
    const k = `${r.price_date}-${r.settlement_period}`;
    const cur = m.get(k);
    if (!cur) {
      m.set(k, r);
      continue;
    }
    if (r.market === "N2EX") m.set(k, r);
    else if (cur.market !== "N2EX") m.set(k, r);
  }
  return Array.from(m.values()).sort((a, b) => {
    if (a.price_date !== b.price_date) {
      return b.price_date.localeCompare(a.price_date);
    }
    return b.settlement_period - a.settlement_period;
  });
}

/**
 * SRMC: gas_gbp_per_mwh_thermal = ttf_eur_mwh * GBP_PER_EUR (skip THERM_PER_MWH=2.931; TTF is €/MWh).
 * gas_gbp_per_mwh_electric = gas_gbp_per_mwh_thermal / 0.50
 * SRMC = gas_gbp_per_mwh_electric + 26 + 2
 */
function gasGbpPerMwhThermal(ttfEur: number): number {
  return ttfEur * GBP_PER_EUR;
}

function gasGbpPerMwhElectric(ttfEur: number): number {
  return gasGbpPerMwhThermal(ttfEur) / CCGT_ELECTRIC_EFF;
}

function srmcGbpMwh(ttfEur: number): number {
  return gasGbpPerMwhElectric(ttfEur) + CARBON_ADDER + VOM;
}

function nbpGbpMwh(ttfEur: number): number {
  return gasGbpPerMwhThermal(ttfEur);
}

/** Spark spread = n2ex_price − SRMC(TTF). */
function sparkSpreadGbpMwh(n2ex: number, ttfEur: number): number {
  return n2ex - srmcGbpMwh(ttfEur);
}

function coalSrmcGbpMwh(ttfEur: number): number {
  return gasGbpPerMwhThermal(ttfEur) / COAL_EFF + CO2_INTENSITY * CO2_PRICE + VOM;
}

function darkSpreadGbpMwh(n2ex: number, ttfEur: number): number {
  return n2ex - coalSrmcGbpMwh(ttfEur);
}

function avgPriceForSpRange(rows: MidRow[], sps: number[]): number | null {
  const set = new Set(sps);
  const prices = rows
    .filter((r) => set.has(r.settlement_period))
    .map((r) => r.price_gbp_mwh);
  if (prices.length === 0) return null;
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

const X_TICK_MINUTES = [360, 540, 720, 900, 1080, 1260];

function priceCellClass(price: number): string {
  if (price > 50) return "text-watch";
  if (price < 0) return "text-bear/85";
  return "text-ink";
}

function formatVolumeMwh(v: unknown): string {
  const n = parseNum(v);
  if (n == null || n === 0) return "—";
  return `${new Intl.NumberFormat("en-GB").format(Math.round(n))} MWh`;
}

export default function MarketsPage() {
  const [loading, setLoading] = useState(true);
  const [midRows, setMidRows] = useState<MidRow[]>([]);
  const [todayRows, setTodayRows] = useState<MidRow[]>([]);
  const [todayDateStr, setTodayDateStr] = useState<string>(utcTodayStr());
  const [gasRow, setGasRow] = useState<GasRow | null>(null);
  const [storageLatest, setStorageLatest] = useState<StorageRow[]>([]);
  const [storageHistory, setStorageHistory] = useState<StorageRow[]>([]);
  const [tapeRows, setTapeRows] = useState<MidRow[]>([]);
  const [physicalPremium, setPhysicalPremium] =
    useState<PhysicalPremiumRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();
    const today = utcTodayStr();

    async function load() {
      setLoadError(null);
      try {
        const [
          ppRes,
          mpRes,
          todayRes,
          gasRes,
          stRes,
          stHistRes,
          tapeRes,
        ] = await Promise.all([
          supabase
            .from("physical_premium")
            .select(
              "normalised_score, direction, residual_demand_gw, wind_gw, solar_gw, remit_mw_lost",
            )
            .order("calculated_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("market_prices")
            .select(
              "price_gbp_mwh, settlement_period, price_date, market, fetched_at, volume",
            )
            .or("market.eq.N2EX,market.eq.APX")
            .order("price_date", { ascending: false })
            .order("settlement_period", { ascending: false })
            .limit(96),
          supabase
            .from("market_prices")
            .select(
              "price_gbp_mwh, settlement_period, price_date, market, fetched_at, volume",
            )
            .or("market.eq.N2EX,market.eq.APX")
            .eq("price_date", today)
            .order("settlement_period", { ascending: true }),
          supabase
            .from("gas_prices")
            .select("price_eur_mwh, price_time")
            .eq("hub", "TTF")
            .order("price_time", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("storage_levels")
            .select(
              "location, full_pct, working_volume_twh, injection_twh, report_date",
            )
            .in("location", [...LOC_ORDER])
            .order("report_date", { ascending: false })
            .limit(80),
          supabase
            .from("storage_levels")
            .select(
              "location, full_pct, injection_twh, report_date",
            )
            .in("location", [...LOC_ORDER])
            .order("report_date", { ascending: false })
            .limit(120),
          supabase
            .from("market_prices")
            .select(
              "price_gbp_mwh, settlement_period, price_date, market, fetched_at, volume",
            )
            .or("market.eq.N2EX,market.eq.APX")
            .eq("price_date", today)
            .order("settlement_period", { ascending: false })
            .limit(10),
        ]);

        if (ppRes.error) {
          setPhysicalPremium(null);
        } else if (ppRes.data) {
          const p = ppRes.data as Record<string, unknown>;
          setPhysicalPremium({
            normalised_score: parseNum(p.normalised_score),
            direction:
              typeof p.direction === "string" ? p.direction.trim() : null,
            residual_demand_gw: parseNum(p.residual_demand_gw),
            wind_gw: parseNum(p.wind_gw),
            solar_gw: parseNum(p.solar_gw),
            remit_mw_lost: parseNum(p.remit_mw_lost),
          });
        } else {
          setPhysicalPremium(null);
        }

        const mapMid = (raw: Record<string, unknown>[]): MidRow[] =>
          raw.map((r) => ({
            price_gbp_mwh: parseNum(r.price_gbp_mwh) ?? 0,
            settlement_period: Number(r.settlement_period) || 0,
            price_date: String(r.price_date ?? ""),
            market: String(r.market ?? ""),
            fetched_at: r.fetched_at != null ? String(r.fetched_at) : null,
            volume:
              parseNum(r.volume) ??
              parseNum((r as Record<string, unknown>).volume_mwh),
          }));

        if (mpRes.error) {
          setLoadError(mpRes.error.message);
          setMidRows([]);
        } else {
          setMidRows(dedupeMidBySettlement(mapMid((mpRes.data ?? []) as Record<string, unknown>[])).slice(0, 48));
        }

        let todayParsed = dedupeMidBySettlement(
          mapMid((todayRes.data ?? []) as Record<string, unknown>[]),
        );
        if (todayParsed.length === 0 && mpRes.data?.length) {
          const all = dedupeMidBySettlement(
            mapMid(mpRes.data as Record<string, unknown>[]),
          );
          const maxDate = all[0]?.price_date;
          if (maxDate) {
            todayParsed = all.filter((r) => r.price_date === maxDate);
            setTodayDateStr(maxDate);
          }
        } else {
          setTodayDateStr(today);
        }
        setTodayRows(todayParsed);

        if (gasRes.error || !gasRes.data) {
          setGasRow(null);
        } else {
          const g = gasRes.data as Record<string, unknown>;
          const pe = parseNum(g.price_eur_mwh);
          if (pe != null) {
            setGasRow({
              price_eur_mwh: pe,
              price_time: String(g.price_time ?? ""),
            });
          } else {
            setGasRow(null);
          }
        }

        if (stRes.error) {
          setStorageLatest([]);
        } else {
          const raw = (stRes.data ?? []) as Record<string, unknown>[];
          const seen = new Set<string>();
          const latest: StorageRow[] = [];
          for (const r of raw) {
            const loc = String(r.location ?? "");
            if (!LOC_ORDER.includes(loc as (typeof LOC_ORDER)[number])) continue;
            if (seen.has(loc)) continue;
            seen.add(loc);
            latest.push({
              location: loc,
              full_pct: parseNum(r.full_pct),
              working_volume_twh: parseNum(r.working_volume_twh),
              injection_twh: parseNum(r.injection_twh),
              report_date: String(r.report_date ?? ""),
            });
          }
          setStorageLatest(latest);
        }

        if (!stHistRes.error && stHistRes.data) {
          setStorageHistory(
            (stHistRes.data as Record<string, unknown>[]).map((r) => ({
              location: String(r.location ?? ""),
              full_pct: parseNum(r.full_pct),
              working_volume_twh: null,
              injection_twh: parseNum(r.injection_twh),
              report_date: String(r.report_date ?? ""),
            })),
          );
        } else {
          setStorageHistory([]);
        }

        if (tapeRes.error) {
          setTapeRows([]);
        } else {
          setTapeRows(
            dedupeMidBySettlement(
              mapMid((tapeRes.data ?? []) as Record<string, unknown>[]),
            ),
          );
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Load failed");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const ttfEur = gasRow?.price_eur_mwh ?? null;

  /** GB Power chart dashed line: same TTF-derived SRMC as the cost stack (no legacy £108.41 / DB SRMC). */
  const srmcRef =
    ttfEur != null && Number.isFinite(ttfEur) ? srmcGbpMwh(ttfEur) : null;

  const latestN2ex = midRows[0]?.price_gbp_mwh ?? null;
  const sixAgo = midRows[6]?.price_gbp_mwh ?? null;

  const trendPct =
    latestN2ex != null &&
    sixAgo != null &&
    sixAgo !== 0 &&
    midRows.length > 6
      ? ((latestN2ex - sixAgo) / sixAgo) * 100
      : null;

  const spark =
    latestN2ex != null && ttfEur != null
      ? sparkSpreadGbpMwh(latestN2ex, ttfEur)
      : null;

  const gbChartData = useMemo(() => {
    return [...todayRows]
      .sort((a, b) => a.settlement_period - b.settlement_period)
      .map((r) => ({
        sp: r.settlement_period,
        minutes: spToMinutesFromMidnight(r.settlement_period),
        timeLabel: spToUtcHHMM(r.settlement_period),
        price: r.price_gbp_mwh,
      }));
  }, [todayRows]);

  const bucketRows = todayRows;

  const morningAvg = avgPriceForSpRange(bucketRows, [17, 18, 19, 20]);
  const middayAvg = avgPriceForSpRange(bucketRows, [25, 26, 27, 28, 29, 30]);
  const eveningAvg = avgPriceForSpRange(bucketRows, [33, 34, 35, 36, 37, 38]);
  const overnightAvg = avgPriceForSpRange(bucketRows, [1, 2, 3, 4, 5, 6, 7, 8]);

  const sparkHistoryData = useMemo(() => {
    if (ttfEur == null) return [];
    const series = [...midRows].reverse();
    return series.map((r) => {
      const sp = sparkSpreadGbpMwh(r.price_gbp_mwh, ttfEur);
      return {
        sp: r.settlement_period,
        minutes: spToMinutesFromMidnight(r.settlement_period),
        spark: sp,
        sparkPos: sp >= 0 ? sp : null,
        sparkNeg: sp < 0 ? sp : null,
      };
    });
  }, [midRows, ttfEur]);

  const storageByLoc = useMemo(() => {
    const o: Record<string, StorageRow> = {};
    for (const r of storageLatest) {
      o[r.location] = r;
    }
    return o;
  }, [storageLatest]);

  const storageChartData = useMemo(
    () =>
      LOC_ORDER.map((loc) => {
        const r = storageByLoc[loc];
        return {
          loc,
          label: loc,
          full_pct: r?.full_pct ?? 0,
        };
      }),
    [storageByLoc],
  );

  const storageAvg = useMemo(() => {
    const pcts = LOC_ORDER.map((l) => storageByLoc[l]?.full_pct).filter(
      (v): v is number => v != null && Number.isFinite(v),
    );
    if (pcts.length === 0) return null;
    return pcts.reduce((a, b) => a + b, 0) / pcts.length;
  }, [storageByLoc]);

  const injectionRateTwhDay = useMemo(() => {
    const inj = LOC_ORDER.map((l) => storageByLoc[l]?.injection_twh).filter(
      (v): v is number => v != null && Number.isFinite(v) && v >= 0,
    );
    if (inj.length === 0) return null;
    return inj.reduce((a, b) => a + b, 0) / inj.length;
  }, [storageByLoc]);

  const injectionDeltaTwhDay = useMemo(() => {
    if (storageHistory.length < 8) return null;
    const dates = [...new Set(storageHistory.map((r) => r.report_date))].sort(
      (a, b) => b.localeCompare(a),
    );
    if (dates.length < 2) return null;
    const latestD = dates[0];
    const prevD = dates[1];
    let sumL = 0;
    let sumP = 0;
    let n = 0;
    for (const loc of LOC_ORDER) {
      const lRow = storageHistory.find(
        (r) => r.location === loc && r.report_date === latestD,
      );
      const pRow = storageHistory.find(
        (r) => r.location === loc && r.report_date === prevD,
      );
      if (
        lRow?.injection_twh != null &&
        pRow?.injection_twh != null
      ) {
        sumL += lRow.injection_twh;
        sumP += pRow.injection_twh;
        n += 1;
      }
    }
    if (n === 0) return null;
    return (sumL - sumP) / n;
  }, [storageHistory]);

  const todaysRange = useMemo(() => {
    if (todayRows.length === 0) return null;
    let hi = -Infinity;
    let lo = Infinity;
    let hiSp = 0;
    let loSp = 0;
    let sum = 0;
    for (const r of todayRows) {
      const p = r.price_gbp_mwh;
      sum += p;
      if (p > hi) {
        hi = p;
        hiSp = r.settlement_period;
      }
      if (p < lo) {
        lo = p;
        loSp = r.settlement_period;
      }
    }
    return {
      high: hi,
      low: lo,
      highSp: hiSp,
      lowSp: loSp,
      avg: sum / todayRows.length,
    };
  }, [todayRows]);

  const directionLabel = physicalPremium?.direction
    ? physicalPremium.direction.trim().toUpperCase()
    : "—";
  const scoreDisp =
    physicalPremium?.normalised_score != null
      ? physicalPremium.normalised_score.toFixed(1)
      : "—";

  const gasUpdated =
    gasRow?.price_time != null && gasRow.price_time !== ""
      ? formatInTimeZone(parseISO(gasRow.price_time), "UTC", "dd MMM yyyy HH:mm") +
        " UTC"
      : null;

  const residualGw = physicalPremium?.residual_demand_gw;
  const thermalDispGw =
    spark != null && spark < 0 && residualGw != null && residualGw > 0
      ? Math.min(residualGw, 45)
      : null;

  const darkSpark = useMemo(() => {
    if (latestN2ex == null || ttfEur == null) return null;
    return darkSpreadGbpMwh(latestN2ex, ttfEur);
  }, [latestN2ex, ttfEur]);

  const coalSrmc =
    ttfEur != null ? coalSrmcGbpMwh(ttfEur) : null;

  return (
    <div className="space-y-6">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-serif text-3xl text-ink"
        >
          Markets
        </motion.h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-mid">
          Trading intelligence for GB power, gas cost stack, spark spreads, and
          continental storage — dense, legible, Zephyr.
        </p>
      </div>

      {loadError ? (
        <p className="text-sm text-bear">{loadError}</p>
      ) : null}

      {/* Section 1 — Stat bar */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-end gap-x-8 gap-y-3 border-b-[0.5px] border-ivory-border bg-ivory px-4 py-3 sm:px-5"
      >
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-mid">
            Physical premium
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {loading ? "…" : `${scoreDisp}`}{" "}
            <span className="text-sm font-medium text-ink-mid">
              {directionLabel}
            </span>
          </p>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-mid">
            Residual demand
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {loading
              ? "…"
              : residualGw != null
                ? `${residualGw.toFixed(1)} GW`
                : "—"}
          </p>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-mid">
            Wind | Solar
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {loading
              ? "…"
              : `${physicalPremium?.wind_gw != null ? physicalPremium.wind_gw.toFixed(1) : "—"} GW | ${physicalPremium?.solar_gw != null ? physicalPremium.solar_gw.toFixed(1) : "—"} GW`}
          </p>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-mid">
            REMIT impact
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {loading
              ? "…"
              : physicalPremium?.remit_mw_lost != null
                ? `${physicalPremium.remit_mw_lost.toFixed(0)} MW offline`
                : "—"}
          </p>
        </div>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* GB Power */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex min-h-[200px] flex-col rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            GB Power · N2EX Day-ahead · APX Mid
          </p>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <p className="font-serif text-3xl tabular-nums text-ink">
              {loading
                ? "…"
                : latestN2ex == null
                  ? "—"
                  : `£${latestN2ex.toFixed(2)}/MWh`}
            </p>
            {trendPct != null ? (
              <span
                className={`text-sm tabular-nums ${
                  trendPct >= 0 ? "text-bull" : "text-bear"
                }`}
              >
                {trendPct >= 0 ? "↑" : "↓"}{" "}
                {trendPct >= 0 ? "+" : ""}
                {trendPct.toFixed(1)}% vs 6 SPs ago
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] text-ink-light">
            Settlement date {todayDateStr} UTC
          </p>
          <div className="mt-4 h-[150px] w-full min-h-[150px]">
            {gbChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart
                  data={gbChartData}
                  margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(44,42,38,0.08)"
                    vertical={false}
                  />
                  <XAxis
                    type="number"
                    dataKey="minutes"
                    domain={[0, 1410]}
                    ticks={X_TICK_MINUTES}
                    tickFormatter={(m) => {
                      const h = Math.floor(m / 60);
                      const mm = m % 60;
                      return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
                    }}
                    tick={{ fontSize: 10, fill: INK_MID }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: INK_MID }}
                    tickFormatter={(v) => `£${v}`}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                    domain={["auto", "auto"]}
                  />
                  {srmcRef != null ? (
                    <ReferenceLine
                      y={srmcRef}
                      stroke={INK_MID}
                      strokeDasharray="4 4"
                      strokeOpacity={0.85}
                    />
                  ) : null}
                  <Area
                    type="monotone"
                    dataKey="price"
                    stroke={BRAND_GREEN}
                    strokeWidth={1.5}
                    fill={BRAND_GREEN}
                    fillOpacity={0.18}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[150px] items-center text-xs text-ink-light">
                No intraday curve for this session
              </div>
            )}
          </div>
          <p className="mt-1 text-[10px] text-ink-light">
            {srmcRef != null
              ? `Dashed line: SRMC £${srmcRef.toFixed(2)}/MWh`
              : "No SRMC reference (no TTF or stored SRMC)"}
          </p>
          <div className="mt-4 border-t-[0.5px] border-ivory-border pt-3 text-[11px] text-ink-mid">
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-light">
              Today&apos;s blocks (avg £/MWh)
            </p>
            <table className="mt-2 w-full border-collapse text-left">
              <tbody className="tabular-nums">
                <tr className="border-b-[0.5px] border-ivory-border/80">
                  <td className="py-1 pr-2 text-ink">Morning peak (SP17–20)</td>
                  <td className="py-1 text-ink">
                    {morningAvg != null ? `£${morningAvg.toFixed(2)}` : "—"}
                  </td>
                </tr>
                <tr className="border-b-[0.5px] border-ivory-border/80">
                  <td className="py-1 pr-2 text-ink">Midday (SP25–30)</td>
                  <td className="py-1 text-ink">
                    {middayAvg != null ? `£${middayAvg.toFixed(2)}` : "—"}
                  </td>
                </tr>
                <tr className="border-b-[0.5px] border-ivory-border/80">
                  <td className="py-1 pr-2 text-ink">Evening peak (SP33–38)</td>
                  <td className="py-1 text-ink">
                    {eveningAvg != null ? `£${eveningAvg.toFixed(2)}` : "—"}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 pr-2 text-ink">Overnight (SP1–8)</td>
                  <td className="py-1 text-ink">
                    {overnightAvg != null ? `£${overnightAvg.toFixed(2)}` : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* TTF stack */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="flex min-h-[200px] flex-col rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            TTF gas · CCGT cost stack
          </p>
          <p className="mt-2 font-serif text-3xl tabular-nums text-ink">
            {loading || ttfEur == null
              ? "…"
              : `€${ttfEur.toFixed(2)}/MWh`}
          </p>
          <p className="mt-1 text-xs text-ink-mid">EEX NGP</p>
          <dl className="mt-4 space-y-2 border-t-[0.5px] border-ivory-border pt-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-mid">NBP equivalent</dt>
              <dd className="tabular-nums text-ink">
                {ttfEur == null ? "—" : `£${nbpGbpMwh(ttfEur).toFixed(2)}/MWh`}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-mid">Gas-to-power (50% eff.)</dt>
              <dd className="tabular-nums text-ink">
                {ttfEur == null
                  ? "—"
                  : `£${gasGbpPerMwhElectric(ttfEur).toFixed(2)}/MWh`}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-mid">Carbon adder (UKA+CPS)</dt>
              <dd className="tabular-nums text-ink">£{CARBON_ADDER.toFixed(2)}/MWh</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-mid">VOM</dt>
              <dd className="tabular-nums text-ink">£{VOM.toFixed(2)}/MWh</dd>
            </div>
            <div className="flex justify-between gap-4 border-t-[0.5px] border-ivory-border pt-2 font-medium">
              <dt className="text-ink">Full SRMC</dt>
              <dd className="tabular-nums text-ink">
                {ttfEur == null ? "—" : `£${srmcGbpMwh(ttfEur).toFixed(2)}/MWh`}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-[11px] text-ink-light">
            {gasUpdated != null ? `Updated ${gasUpdated}` : "—"}
          </p>
        </motion.div>

        {/* Spark */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex min-h-[200px] flex-col rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            Clean spark spread
          </p>
          <div className="mt-2 flex flex-wrap items-baseline gap-2">
            <p
              className={`font-serif text-3xl tabular-nums ${
                spark == null
                  ? "text-ink"
                  : spark >= 0
                    ? "text-[#1D6B4E]"
                    : "text-[#8B3A3A]"
              }`}
            >
              {loading
                ? "…"
                : spark == null
                  ? "—"
                  : `£${spark.toFixed(2)}/MWh`}
            </p>
            {spark != null ? (
              <span
                className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${
                  spark >= 0 ? "text-[#1D6B4E]" : "text-[#8B3A3A]"
                }`}
              >
                {spark >= 0 ? "In merit" : "Out of merit"}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-mid">
            {spark != null && spark < 0 && srmcRef != null
              ? `CCGT generation is currently uneconomic. Gas plant requires prices above £${srmcRef.toFixed(2)}/MWh to recover costs.`
              : spark != null && spark >= 0 && srmcRef != null
                ? `CCGT is in merit vs SRMC £${srmcRef.toFixed(2)}/MWh.`
                : "Spark spread compares power price to full gas SRMC."}
          </p>
          <p className="mt-3 text-xs text-ink-mid">
            <span className="font-medium text-ink">Dark spread equivalent: </span>
            {darkSpark == null
              ? "—"
              : `£${darkSpark.toFixed(2)}/MWh vs coal SRMC (~£${coalSrmc?.toFixed(0) ?? "—"}/MWh at 36% eff. + ${CO2_INTENSITY} tCO2/MWh × £${CO2_PRICE}/t) — coal even further out of merit.`}
          </p>
          <p className="mt-2 text-xs text-ink-mid">
            <span className="font-medium text-ink">Implied gas demand: </span>
            {thermalDispGw != null
              ? `Renewables displacing ~${thermalDispGw.toFixed(1)} GW of thermal capacity (vs residual demand).`
              : spark != null && spark >= 0
                ? "Thermal plant economically in the money."
                : "—"}
          </p>
          <p className="mt-1 text-[11px] text-ink-light">
            Implied CCGT margin vs gas + carbon + VOM
          </p>
          <div className="mt-4 h-[100px] min-h-[100px] w-full">
            {sparkHistoryData.length > 0 ? (
              <ResponsiveContainer width="100%" height={100}>
                <LineChart
                  data={sparkHistoryData}
                  margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                >
                  <XAxis dataKey="sp" hide />
                  <YAxis hide domain={["auto", "auto"]} />
                  <ReferenceLine y={0} stroke={INK_MID} strokeDasharray="3 3" />
                  <Line
                    type="monotone"
                    dataKey="sparkPos"
                    stroke={BRAND_GREEN}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="sparkNeg"
                    stroke={SPARK_NEG}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[100px] items-center text-xs text-ink-light">
                Spark history needs TTF + MID data
              </div>
            )}
          </div>
          <p className="mt-1 text-[9px] text-ink-light">
            Last 48 SPs · spark vs latest TTF-implied SRMC
          </p>
        </motion.div>

        {/* EU Storage */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="flex min-h-[200px] flex-col rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            EU storage
          </p>
          <p className="mt-2 font-serif text-3xl tabular-nums text-ink">
            {loading || storageAvg == null
              ? "…"
              : `${storageAvg.toFixed(1)}% avg`}
          </p>
          <p className="mt-1 font-mono text-[11px] text-ink-mid">
            {LOC_ORDER.map((loc) => {
              const p = storageByLoc[loc]?.full_pct;
              return `${loc} ${p == null ? "—" : `${Math.round(p)}%`}`;
            }).join(" · ")}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-ink-mid">
            April 5-year average: ~35% full (seasonal reference).
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-mid">
            {injectionDeltaTwhDay != null && injectionDeltaTwhDay > 0
              ? `Injection season underway — continental storage building at approx ${injectionDeltaTwhDay.toFixed(2)} TWh/day (day-on-day injection delta, GIE).`
              : injectionRateTwhDay != null
                ? `Latest reported injection rate ~${injectionRateTwhDay.toFixed(2)} TWh/day (cross-location avg).`
                : "Injection trend: awaiting consecutive daily reads in the feed."}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-mid">
            {storageAvg != null
              ? `At ${storageAvg.toFixed(1)}% fill, winter draw risk elevated. Supports TTF above €40/MWh floor.`
              : "Storage vs gas: connect storage fill for colour."}
          </p>
          <div className="mt-4 h-[100px] w-full">
            {storageChartData.some((d) => d.full_pct > 0) ? (
              <ResponsiveContainer width="100%" height={100}>
                <BarChart
                  layout="vertical"
                  data={storageChartData}
                  margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
                >
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={28}
                    tick={{ fill: INK_MID, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Bar
                    dataKey="full_pct"
                    fill={BRAND_GREEN}
                    fillOpacity={0.55}
                    radius={[0, 2, 2, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : null}
          </div>
        </motion.div>
      </div>

      {/* Live tape */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
      >
        <h2 className="font-serif text-lg text-ink">Live tape</h2>
        <p className="mt-1 text-[11px] text-ink-mid">
          Last 10 settlement periods · APX/N2EX MID · times from SP (UTC)
        </p>
        {todaysRange != null ? (
          <p className="mt-3 text-sm text-ink-mid">
            <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-light">
              Today&apos;s range ({todayDateStr})
            </span>
            <br />
            <span className="tabular-nums text-ink">
              High: £{todaysRange.high.toFixed(2)} (SP{todaysRange.highSp}) · Low: £
              {todaysRange.low.toFixed(2)} (SP{todaysRange.lowSp}) · Avg: £
              {todaysRange.avg.toFixed(2)}
            </span>
          </p>
        ) : null}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-[0.5px] border-ivory-border text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-light">
                <th className="pb-2 pr-4 font-medium">Time (UTC)</th>
                <th className="pb-2 pr-4 font-medium">SP</th>
                <th className="pb-2 pr-4 font-medium">Price</th>
                <th className="pb-2 font-medium">Volume</th>
              </tr>
            </thead>
            <tbody>
              {tapeRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-4 text-ink-mid">
                    {loading ? "…" : "No rows for today yet"}
                  </td>
                </tr>
              ) : (
                tapeRows.map((r, i) => {
                  const timeUtc = `${spToUtcHHMM(r.settlement_period)} UTC`;
                  const pc = priceCellClass(r.price_gbp_mwh);
                  return (
                    <tr
                      key={`${r.price_date}-${r.settlement_period}-${r.market}-${i}`}
                      className="border-b-[0.5px] border-ivory-border/70 last:border-0"
                    >
                      <td className="py-2 pr-4 tabular-nums text-ink-mid">
                        {timeUtc}
                      </td>
                      <td className="py-2 pr-4 tabular-nums text-ink">
                        {r.settlement_period}
                      </td>
                      <td
                        className={`py-2 pr-4 tabular-nums ${pc}`}
                      >
                        £{r.price_gbp_mwh.toFixed(2)}/MWh
                      </td>
                      <td className="py-2 tabular-nums text-ink-mid">
                        {formatVolumeMwh(r.volume)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </motion.section>

      {/* Interconnector panel */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="rounded-[4px] border-[0.5px] border-dashed border-ivory-border bg-ivory-dark/40 px-5 py-4"
      >
        <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-light">
          Interconnector context · static reference
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-mid">
          GB interconnector capacity: 8.4 GW total (IFA1 2 GW · IFA2 1 GW · BritNed
          1 GW · NSL 1.4 GW · NEMO 1 GW · ElecLink 1 GW · Viking 1.4 GW · EWIC 0.5
          GW). Live flow data coming soon.
        </p>
      </motion.section>
    </div>
  );
}
