"use client";

import { createBrowserClient } from "@/lib/supabase/client";
import { parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceDot,
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

/** EU storage seasonal reference benchmarks (not live DB values). */
const REF_STORAGE_SAME_WEEK_LAST_YEAR_PCT = 28;
const REF_STORAGE_FIVE_YEAR_APRIL_AVG_PCT = 35;

const WIND_LINE = "#5c6b2e";

function utcTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function utcDateMinusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Previous calendar day in UTC for a YYYY-MM-DD string (use noon to avoid edge cases). */
function utcDateMinusOneDayFromYmd(ymd: string): string {
  const d = parseISO(`${ymd}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function utcDatePlusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
  remit_planned_mw: number | null;
  remit_unplanned_mw: number | null;
};

type GasRow = {
  price_eur_mwh: number;
  price_time: string;
  fetched_at: string | null;
};

type WeatherRow = {
  forecast_time: string;
  /** Wind at 100 m from Open-Meteo, m/s (column may be wind_speed_100m or windspeed_100m in API). */
  wind_speed_100m: number | null;
};

type StorageRow = {
  location: string;
  full_pct: number | null;
  working_volume_twh: number | null;
  injection_twh: number | null;
  report_date: string;
};

type IcFlowRow = {
  id: string;
  label: string;
  country: string;
  flowMw: number;
  capacityMw: number;
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
  if (price > 100) return "font-semibold text-[#B45309]";
  if (price > 50) return "text-[#D97706]";
  if (price < 0) return "text-[#8B3A3A]";
  return "text-ink";
}

/** `weather_forecasts` stores m/s; plot implied GW = m/s × 2.125. */
function windMsToImpliedGw(windSpeedMs: number): number {
  return windSpeedMs * 2.125;
}

function windImpliedGwForSp(
  sp: number,
  rows: WeatherRow[],
  todayYmd: string,
): number | null {
  if (rows.length === 0) return null;
  const midMin = (sp - 1) * 30 + 15;
  const t0 =
    parseISO(`${todayYmd}T00:00:00.000Z`).getTime() + midMin * 60 * 1000;
  let best: WeatherRow | null = null;
  let bestDiff = Infinity;
  for (const r of rows) {
    const w = parseNum(r.wind_speed_100m);
    if (w == null) continue;
    const ft = parseISO(r.forecast_time).getTime();
    const d = Math.abs(ft - t0);
    if (d < bestDiff) {
      bestDiff = d;
      best = r;
    }
  }
  if (best == null) return null;
  const ms = parseNum(best.wind_speed_100m);
  if (ms == null) return null;
  return windMsToImpliedGw(ms);
}

function formatRemitMw(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 0,
  }).format(n);
}

/** First numeric value found for any of the given keys (ingestion may use aliases). */
function numFromKeys(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    if (!(k in row)) continue;
    const n = parseNum(row[k]);
    if (n != null && Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * REMIT planned/unplanned from physical_premium row; keys vary by migration / agent version.
 */
function parseRemitSplitFromPremiumRow(row: Record<string, unknown>): {
  plannedMw: number | null;
  unplannedMw: number | null;
  totalMw: number | null;
} {
  const plannedMw = numFromKeys(row, [
    "remit_planned_mw",
    "remit_mw_planned_active",
    "remit_mw_planned",
  ]);
  const unplannedMw = numFromKeys(row, [
    "remit_unplanned_mw",
    "remit_mw_unplanned_active",
    "remit_mw_unplanned",
  ]);
  const totalMw =
    numFromKeys(row, ["remit_mw_lost", "remit_total_mw"]) ??
    (plannedMw != null && unplannedMw != null
      ? plannedMw + unplannedMw
      : null);
  return { plannedMw, unplannedMw, totalMw };
}

function formatVolumeMwh(v: unknown): string {
  const n = parseNum(v);
  if (n == null || n === 0) return "—";
  return `${new Intl.NumberFormat("en-GB").format(Math.round(n))} MWh`;
}

const MP_COLS_BASE =
  "price_gbp_mwh, settlement_period, price_date, market, fetched_at" as const;
const MP_COLS_WITH_VOLUME =
  "price_gbp_mwh, settlement_period, price_date, market, fetched_at, volume" as const;

function isMissingColumnError(
  err: { message?: string } | null | undefined,
  column: string,
): boolean {
  const m = (err?.message ?? "").toLowerCase();
  const c = column.toLowerCase();
  return m.includes(c) && (m.includes("does not exist") || m.includes("schema cache"));
}

/** Below this prior £/MWh, % change is omitted — % is misleading near zero; £ delta is not. */
const MIN_PRIOR_GBP_FOR_PCT = 20;

/** Latest MID vs 6th row on tape: £/MWh move always; % only when prior is a stable baseline. */
function n2exTapeMove(
  latest: number | null,
  priorRowPrice: number | null,
  enoughRows: boolean,
): { deltaGbp: number | null; pct: number | null } {
  if (latest == null || priorRowPrice == null || !enoughRows) {
    return { deltaGbp: null, pct: null };
  }
  if (!Number.isFinite(latest) || !Number.isFinite(priorRowPrice)) {
    return { deltaGbp: null, pct: null };
  }
  const deltaGbp = latest - priorRowPrice;
  const pct =
    priorRowPrice >= MIN_PRIOR_GBP_FOR_PCT
      ? (deltaGbp / priorRowPrice) * 100
      : null;
  return { deltaGbp, pct };
}

/** Values stored as TWh/d; oversized magnitudes are legacy GWh·d⁻¹ in the same column. */
function formatStorageInjectionTwhDay(twhPerDay: number): string {
  const a = Math.abs(twhPerDay);
  if (a > 8) {
    return `${twhPerDay.toFixed(0)} GWh/d`;
  }
  return `${(twhPerDay * 1000).toFixed(0)} GWh/d (${twhPerDay.toFixed(3)} TWh/d)`;
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
  const [yesterdayRows, setYesterdayRows] = useState<MidRow[]>([]);
  const [weatherRows, setWeatherRows] = useState<WeatherRow[]>([]);
  const [marketPrices7d, setMarketPrices7d] = useState<MidRow[]>([]);
  const [icFlows, setIcFlows] = useState<{
    rows: IcFlowRow[];
    settlementDate: string | null;
    settlementPeriod: number | null;
    publishTime: string | null;
  } | null>(null);
  const [icFlowsError, setIcFlowsError] = useState<string | null>(null);
  useEffect(() => {
    const supabase = createBrowserClient();
    const today = utcTodayStr();
    const sevenAgo = utcDateMinusDays(7);
    /** Cover settlement-date vs UTC midnight mismatches vs weather rows. */
    const wxRangeStart = `${utcDateMinusDays(1)}T00:00:00.000Z`;
    const wxRangeEnd = `${utcDatePlusDays(2)}T00:00:00.000Z`;

    async function load() {
      setLoadError(null);
      try {
        const volProbe = await supabase
          .from("market_prices")
          .select("volume")
          .limit(1);
        const mpCols =
          volProbe.error && isMissingColumnError(volProbe.error, "volume")
            ? MP_COLS_BASE
            : MP_COLS_WITH_VOLUME;
        /** Schema types may lag behind DB; assert so `volume` is selectable when present. */
        const mpSel = mpCols as typeof MP_COLS_WITH_VOLUME;

        const ppRes = await supabase
          .from("physical_premium")
          .select("*")
          .order("calculated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const [
          mpRes,
          todayRes,
          gasRes,
          stRes,
          stHistRes,
          tapeRes,
          wxRes,
          mp7dRes,
        ] = await Promise.all([
          supabase
            .from("market_prices")
            .select(mpSel)
            .or("market.eq.N2EX,market.eq.APX")
            .order("price_date", { ascending: false })
            .order("settlement_period", { ascending: false })
            .limit(96),
          supabase
            .from("market_prices")
            .select(mpSel)
            .or("market.eq.N2EX,market.eq.APX")
            .eq("price_date", today)
            .order("settlement_period", { ascending: true }),
          supabase
            .from("gas_prices")
            .select("price_eur_mwh, price_time, fetched_at")
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
            .select(mpSel)
            .or("market.eq.N2EX,market.eq.APX")
            .eq("price_date", today)
            .order("settlement_period", { ascending: false })
            .limit(10),
          supabase
            .from("weather_forecasts")
            .select("forecast_time, wind_speed_100m")
            .eq("location", "GB")
            .gte("forecast_time", wxRangeStart)
            .lt("forecast_time", wxRangeEnd)
            .order("forecast_time", { ascending: true }),
          supabase
            .from("market_prices")
            .select(mpSel)
            .or("market.eq.N2EX,market.eq.APX")
            .gte("price_date", sevenAgo)
            .order("price_date", { ascending: true })
            .order("settlement_period", { ascending: true })
            .limit(2500),
        ]);

        if (ppRes.error) {
          setPhysicalPremium(null);
        } else if (ppRes.data) {
          const p = ppRes.data as Record<string, unknown>;
          // eslint-disable-next-line no-console
          console.log("physical_premium columns:", Object.keys(p));
          const remit = parseRemitSplitFromPremiumRow(p);
          setPhysicalPremium({
            normalised_score: parseNum(p.normalised_score),
            direction:
              typeof p.direction === "string" ? p.direction.trim() : null,
            residual_demand_gw: parseNum(p.residual_demand_gw),
            wind_gw: parseNum(p.wind_gw),
            solar_gw: parseNum(p.solar_gw),
            remit_mw_lost: remit.totalMw,
            remit_planned_mw: remit.plannedMw,
            remit_unplanned_mw: remit.unplannedMw,
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
        let displayDateStr = today;
        if (todayParsed.length === 0 && mpRes.data?.length) {
          const all = dedupeMidBySettlement(
            mapMid(mpRes.data as Record<string, unknown>[]),
          );
          const maxDate = all[0]?.price_date;
          if (maxDate) {
            todayParsed = all.filter((r) => r.price_date === maxDate);
            displayDateStr = maxDate;
          }
        }
        setTodayDateStr(displayDateStr);
        setTodayRows(todayParsed);

        /** Compare to prior settlement calendar day (not fixed UTC “yesterday”), or SP alignment breaks. */
        const priorSettlementDay = utcDateMinusOneDayFromYmd(displayDateStr);
        const ydayRes = await supabase
          .from("market_prices")
          .select(mpSel)
          .or("market.eq.N2EX,market.eq.APX")
          .eq("price_date", priorSettlementDay)
          .order("settlement_period", { ascending: true });

        if (ydayRes.error) {
          setYesterdayRows([]);
        } else {
          setYesterdayRows(
            dedupeMidBySettlement(
              mapMid((ydayRes.data ?? []) as Record<string, unknown>[]),
            ),
          );
        }

        if (gasRes.error || !gasRes.data) {
          setGasRow(null);
        } else {
          const g = gasRes.data as Record<string, unknown>;
          const pe = parseNum(g.price_eur_mwh);
          if (pe != null) {
            setGasRow({
              price_eur_mwh: pe,
              price_time: String(g.price_time ?? ""),
              fetched_at:
                g.fetched_at != null ? String(g.fetched_at) : null,
            });
          } else {
            setGasRow(null);
          }
        }

        if (wxRes.error) {
          setWeatherRows([]);
        } else {
          setWeatherRows(
            (wxRes.data ?? []).map((r) => {
              const row = r as Record<string, unknown>;
              const ms =
                parseNum(row.wind_speed_100m) ??
                parseNum(row.windspeed_100m);
              return {
                forecast_time: String(row.forecast_time ?? ""),
                wind_speed_100m: ms,
              };
            }),
          );
        }

        if (mp7dRes.error) {
          setMarketPrices7d([]);
        } else {
          setMarketPrices7d(
            mapMid((mp7dRes.data ?? []) as Record<string, unknown>[]),
          );
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

  useEffect(() => {
    let cancelled = false;
    fetch("/api/bmrs/interconnector-flows")
      .then((r) => r.json())
      .then((j: Record<string, unknown>) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.log("[BMRS interconnector-flows raw]", j);
        if (j.ok === true && Array.isArray(j.rows)) {
          setIcFlowsError(null);
          setIcFlows({
            rows: j.rows as IcFlowRow[],
            settlementDate:
              typeof j.settlementDate === "string" ? j.settlementDate : null,
            settlementPeriod:
              typeof j.settlementPeriod === "number"
                ? j.settlementPeriod
                : null,
            publishTime:
              typeof j.publishTime === "string" ? j.publishTime : null,
          });
        } else {
          setIcFlows(null);
          setIcFlowsError(
            typeof j.error === "string" ? j.error : "Flow data unavailable",
          );
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setIcFlows(null);
          setIcFlowsError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ttfEur = gasRow?.price_eur_mwh ?? null;

  /** GB Power chart dashed line: same TTF-derived SRMC as the cost stack (no legacy £108.41 / DB SRMC). */
  const srmcRef =
    ttfEur != null && Number.isFinite(ttfEur) ? srmcGbpMwh(ttfEur) : null;

  const latestN2ex = midRows[0]?.price_gbp_mwh ?? null;
  const sixAgo = midRows[6]?.price_gbp_mwh ?? null;

  const { deltaGbp: tapeDeltaGbp, pct: tapePct } = n2exTapeMove(
    latestN2ex,
    sixAgo,
    midRows.length > 6,
  );

  const spark =
    latestN2ex != null && ttfEur != null
      ? sparkSpreadGbpMwh(latestN2ex, ttfEur)
      : null;

  const gbMergedData = useMemo(() => {
    const yMap = new Map<number, number>();
    for (const r of yesterdayRows) {
      yMap.set(r.settlement_period, r.price_gbp_mwh);
    }
    const chartData = [...todayRows]
      .sort((a, b) => a.settlement_period - b.settlement_period)
      .map((r) => {
        const sp = r.settlement_period;
        const minutes = spToMinutesFromMidnight(sp);
        const windImpliedGw = windImpliedGwForSp(sp, weatherRows, todayDateStr);
        const yPrice = yMap.has(sp) ? yMap.get(sp)! : null;
        return {
          sp,
          minutes,
          timeLabel: spToUtcHHMM(sp),
          today_price: r.price_gbp_mwh,
          yesterday_price: yPrice,
          wind_implied_gw: windImpliedGw,
        };
      });
    // eslint-disable-next-line no-console
    console.log(
      "yesterday data sample:",
      chartData.slice(0, 3).map((d) => ({
        sp: d.sp,
        today: d.today_price,
        yesterday: d.yesterday_price,
      })),
    );
    return chartData;
  }, [todayRows, yesterdayRows, weatherRows, todayDateStr]);

  const gbHighDot = useMemo(() => {
    if (gbMergedData.length === 0) return null;
    let best = gbMergedData[0];
    for (const d of gbMergedData) {
      if (d.today_price > best.today_price) best = d;
    }
    return {
      minutes: best.minutes,
      price: best.today_price,
      sp: best.sp,
    };
  }, [gbMergedData]);

  const negativePricingToday = useMemo(() => {
    const neg = todayRows
      .filter((r) => r.price_gbp_mwh < 0)
      .sort((a, b) => a.settlement_period - b.settlement_period);
    return neg;
  }, [todayRows]);

  const sparkMerit7d = useMemo(() => {
    if (ttfEur == null || marketPrices7d.length === 0) return null;
    const rows = dedupeMidBySettlement(marketPrices7d);
    let inMerit = 0;
    let outMerit = 0;
    for (const r of rows) {
      const sp = sparkSpreadGbpMwh(r.price_gbp_mwh, ttfEur);
      if (sp > 0) inMerit += 1;
      else outMerit += 1;
    }
    const total = inMerit + outMerit;
    const pctInMerit =
      total > 0 ? Math.round((inMerit / total) * 1000) / 10 : null;
    return { inMerit, outMerit, total, pctInMerit };
  }, [marketPrices7d, ttfEur]);

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

  /** vs 5-year April reference: green above ref, amber within 10% below ref, red well below. */
  const storageSeasonalBarColor = useMemo(() => {
    if (storageAvg == null) return INK_MID;
    const ref = REF_STORAGE_FIVE_YEAR_APRIL_AVG_PCT;
    if (storageAvg >= ref) return BRAND_GREEN;
    if (storageAvg >= ref * 0.9) return "#D97706";
    return "#8B3A3A";
  }, [storageAvg]);

  const injectionRateTwhDay = useMemo(() => {
    const inj = LOC_ORDER.map((l) => storageByLoc[l]?.injection_twh).filter(
      (v): v is number => v != null && Number.isFinite(v),
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
    gasRow?.fetched_at != null && gasRow.fetched_at !== ""
      ? formatInTimeZone(parseISO(gasRow.fetched_at), "UTC", "dd MMM yyyy HH:mm") +
        " UTC"
      : gasRow?.price_time != null && gasRow.price_time !== ""
        ? formatInTimeZone(parseISO(gasRow.price_time), "UTC", "dd MMM yyyy HH:mm") +
          " UTC"
        : null;

  const residualGw = physicalPremium?.residual_demand_gw;

  const darkSpark = useMemo(() => {
    if (latestN2ex == null || ttfEur == null) return null;
    return darkSpreadGbpMwh(latestN2ex, ttfEur);
  }, [latestN2ex, ttfEur]);

  const coalSrmc =
    ttfEur != null ? coalSrmcGbpMwh(ttfEur) : null;

  const remitBarDisplay = useMemo(() => {
    const pp = physicalPremium;
    const ppP = pp?.remit_planned_mw;
    const ppU = pp?.remit_unplanned_mw;
    if (ppP != null && ppU != null) {
      return `REMIT: ${formatRemitMw(ppP)} MW planned · ${formatRemitMw(ppU)} MW unplanned`;
    }
    if (pp?.remit_mw_lost != null) {
      return `REMIT: ${formatRemitMw(pp.remit_mw_lost)} MW offline`;
    }
    return null;
  }, [physicalPremium]);

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
          Live physical intelligence for GB power, European gas, and cross-border
          flows.
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
            {loading ? "…" : remitBarDisplay ?? "—"}
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
            {tapeDeltaGbp != null ? (
              <span
                className={`text-sm tabular-nums ${
                  tapeDeltaGbp >= 0 ? "text-bull" : "text-bear"
                }`}
              >
                {tapeDeltaGbp >= 0 ? "↑" : "↓"}{" "}
                {tapeDeltaGbp >= 0 ? "+" : "−"}
                £{Math.abs(tapeDeltaGbp).toFixed(2)}/MWh vs 6 rows back
                {tapePct != null
                  ? ` (${tapePct >= 0 ? "+" : ""}${tapePct.toFixed(1)}%)`
                  : ""}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] text-ink-light">
            Settlement date {todayDateStr} UTC
          </p>
          <div className="mt-4 h-[180px] w-full min-h-[180px]">
            {gbMergedData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart
                  data={gbMergedData}
                  margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
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
                    yAxisId="left"
                    tick={{ fontSize: 10, fill: INK_MID }}
                    tickFormatter={(v) => `£${v}`}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                    domain={["auto", "auto"]}
                    label={{
                      value: "£/MWh",
                      angle: -90,
                      position: "insideLeft",
                      fill: INK_MID,
                      fontSize: 10,
                    }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10, fill: INK_MID }}
                    tickFormatter={(v) =>
                      typeof v === "number" ? v.toFixed(1) : `${v}`
                    }
                    axisLine={false}
                    tickLine={false}
                    width={40}
                    domain={[0, "auto"]}
                    label={{
                      value: "GW",
                      angle: 90,
                      position: "insideRight",
                      fill: INK_MID,
                      fontSize: 10,
                    }}
                  />
                  {srmcRef != null ? (
                    <ReferenceLine
                      yAxisId="left"
                      y={srmcRef}
                      stroke={INK_MID}
                      strokeDasharray="4 4"
                      strokeOpacity={0.85}
                    />
                  ) : null}
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="today_price"
                    name="Today"
                    stroke={BRAND_GREEN}
                    strokeWidth={1.5}
                    fill={BRAND_GREEN}
                    fillOpacity={0.18}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="yesterday_price"
                    name="Yesterday"
                    stroke="#6b7280"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="wind_implied_gw"
                    name="Wind (implied GW)"
                    stroke={WIND_LINE}
                    strokeWidth={1.25}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                  {gbHighDot != null ? (
                    <ReferenceDot
                      yAxisId="left"
                      x={gbHighDot.minutes}
                      y={gbHighDot.price}
                      r={4}
                      fill={BRAND_GREEN}
                      stroke="#fff"
                      strokeWidth={1}
                      label={{
                        value: `£${gbHighDot.price.toFixed(0)} · SP${gbHighDot.sp}`,
                        position: "top",
                        fill: INK,
                        fontSize: 10,
                      }}
                    />
                  ) : null}
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[180px] items-center text-xs text-ink-light">
                No intraday curve for this session
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[10px] text-ink-mid">
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm bg-[#1D6B4E]"
                aria-hidden
              />
              <span className="text-ink">Today</span>
            </span>
            <span className="flex items-center gap-2">
              <svg width="22" height="3" viewBox="0 0 22 3" aria-hidden className="shrink-0">
                <line
                  x1="0"
                  y1="1.5"
                  x2="22"
                  y2="1.5"
                  stroke="#6b7280"
                  strokeWidth="2"
                  strokeDasharray="6 3"
                />
              </svg>
              <span className="text-ink">Yesterday</span>
            </span>
            <span className="flex items-center gap-2">
              <svg width="22" height="3" viewBox="0 0 22 3" aria-hidden className="shrink-0">
                <line
                  x1="0"
                  y1="1.5"
                  x2="22"
                  y2="1.5"
                  stroke={WIND_LINE}
                  strokeWidth="1.25"
                />
              </svg>
              <span className="text-ink">Wind (implied GW)</span>
            </span>
          </div>
          <p className="mt-1 text-[10px] text-ink-light">
            {srmcRef != null
              ? `Grey dash: SRMC £${srmcRef.toFixed(2)}/MWh · Wind: ECMWF 100 m (m/s) × 2.125 → implied GW`
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
            <p className="mt-3 text-[10px] leading-relaxed text-ink-mid">
              {negativePricingToday.length > 0 ? (
                <>
                  <span className="font-medium text-ink">
                    Negative pricing: {negativePricingToday.length} settlement period
                    {negativePricingToday.length === 1 ? "" : "s"} today
                  </span>
                  <br />
                  <span className="text-[#8B3A3A]">
                    {negativePricingToday.map((r, i) => (
                      <span key={r.settlement_period}>
                        {i > 0 ? " · " : ""}
                        SP{r.settlement_period} (£{r.price_gbp_mwh.toFixed(2)})
                      </span>
                    ))}
                  </span>
                </>
              ) : (
                <span>No negative pricing today</span>
              )}
            </p>
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
          <p className="mt-1 text-[10px] text-ink-light">
            &quot;Updated&quot; uses ingestion time from the database (
            <code className="text-[9px]">fetched_at</code>
            ), not the gas-day index hour.
          </p>
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
          <p className="mt-2 text-[11px] text-ink-mid">
            {sparkMerit7d != null && sparkMerit7d.total > 0 ? (
              <>
                Last 7 days: {sparkMerit7d.inMerit} SPs in merit ·{" "}
                {sparkMerit7d.outMerit} SPs out of merit (
                {sparkMerit7d.pctInMerit != null
                  ? `${sparkMerit7d.pctInMerit}%`
                  : "—"}
                )
              </>
            ) : (
              <span className="text-ink-light">
                7-day merit summary needs TTF + MID history
              </span>
            )}
          </p>
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
            <span className="font-medium text-ink">GB residual demand: </span>
            {residualGw != null && residualGw > 0
              ? `~${residualGw.toFixed(1)} GW after wind & solar (physical model).`
              : "—"}
            {spark != null && spark < 0 ? (
              <span className="text-ink-mid">
                {" "}
                Negative spark: day-ahead power is below CCGT variable cost at this
                TTF — not a GW displacement metric.
              </span>
            ) : spark != null && spark >= 0 ? (
              <span className="text-ink-mid"> Thermal stack in the money at these levels.</span>
            ) : null}
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
                    strokeWidth={2.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="sparkNeg"
                    stroke={SPARK_NEG}
                    strokeWidth={2.5}
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
              ? `Injection season — day-on-day injection delta ≈ ${formatStorageInjectionTwhDay(injectionDeltaTwhDay)} (GIE, EU hubs).`
              : injectionRateTwhDay != null
                ? `Latest reported injection ≈ ${formatStorageInjectionTwhDay(injectionRateTwhDay)} (cross-location avg).`
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
          <div className="mt-5 border-t-[0.5px] border-ivory-border pt-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-light">
              Seasonal comparison (EU avg % full)
            </p>
            <p className="mt-1 text-[10px] text-ink-light">
              References labelled below are illustrative 5-year-style benchmarks — not
              live database series.
            </p>
            <div className="mt-3 space-y-3">
              {[
                {
                  key: "cur",
                  label: "Current (live)",
                  pct: storageAvg,
                  barColor: storageSeasonalBarColor,
                },
                {
                  key: "swly",
                  label: "Same week last year (5yr reference)",
                  pct: REF_STORAGE_SAME_WEEK_LAST_YEAR_PCT,
                  barColor: INK_MID,
                },
                {
                  key: "apr5",
                  label: "5-year April average (reference)",
                  pct: REF_STORAGE_FIVE_YEAR_APRIL_AVG_PCT,
                  barColor: INK_MID,
                },
              ].map((row) => (
                <div key={row.key}>
                  <div className="flex justify-between text-[11px] text-ink-mid">
                    <span>{row.label}</span>
                    <span className="tabular-nums text-ink">
                      {row.pct == null ? "—" : `${row.pct.toFixed(1)}%`}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-sm bg-ivory-border/60">
                    <div
                      className="h-full rounded-sm transition-[width]"
                      style={{
                        width: `${row.pct == null ? 0 : Math.min(100, Math.max(0, row.pct))}%`,
                        backgroundColor: row.barColor,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
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

      {/* Interconnector flows (BMRS FUELINST) */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
      >
        <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-mid">
          GB interconnectors · Elexon BMRS FUELINST
        </p>
        <p className="mt-1 text-[10px] text-ink-light">
          Signed MW: positive = import to GB, negative = export from GB. Capacities
          for bar width are reference MW (not live operational limits).
        </p>
        {icFlows?.publishTime != null ? (
          <p className="mt-1 text-[10px] text-ink-light">
            Latest publish {icFlows.publishTime}
            {icFlows.settlementDate != null && icFlows.settlementPeriod != null
              ? ` · SP${icFlows.settlementPeriod} (${icFlows.settlementDate})`
              : ""}
          </p>
        ) : null}
        <div className="mt-4 space-y-4">
          {icFlowsError != null ? (
            <p className="text-sm text-bear">{icFlowsError}</p>
          ) : icFlows == null ? (
            <p className="text-sm text-ink-mid">Loading flows…</p>
          ) : (
            icFlows.rows.map((r) => {
              const imp = r.flowMw > 0;
              const exp = r.flowMw < 0;
              const arrow = imp ? "←" : exp ? "→" : "·";
              const cap = Math.max(r.capacityMw, 1);
              const barPct = Math.min(
                100,
                (Math.abs(r.flowMw) / cap) * 100,
              );
              return (
                <div key={r.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="text-ink">
                      {r.label}{" "}
                      <span className="text-ink-mid">({r.country})</span>
                    </span>
                    <span className="tabular-nums text-ink">
                      {Math.round(r.flowMw).toLocaleString("en-GB")} MW{" "}
                      <span className="text-ink-mid" title={imp ? "Importing to GB" : exp ? "Exporting from GB" : ""}>
                        {arrow}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-ivory-border/60">
                    <div
                      className="h-full rounded-sm bg-[#1D6B4E]/70"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </motion.section>
    </div>
  );
}
