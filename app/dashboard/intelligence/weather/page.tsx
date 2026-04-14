"use client";

import { createBrowserClient } from "@/lib/supabase/client";
import {
  APRIL_TEMP_NORM_C,
  AMBER,
  BRAND_GREEN,
  buildHourlyPoints,
  droughtPct,
  findRampIndices,
  formatDayLabel,
  GREY_TEMP,
  GAS_MARGINAL_GW,
  groupByUtcDay,
  heatingDegreeDayContribution,
  HIGH_WIND_GW,
  HourlyForecastPoint,
  parseNum,
  RENEWABLE_DOM_GW,
  SOLAR_RAD_TO_GW,
  SRMC_REF_GBP,
  TERRACOTTA,
  WIND_DROUGHT_GW,
  WIND_MS_TO_GW,
  WARM_GOLD,
  WARM_GOLD_DARK,
} from "@/lib/weather-intelligence";
import { format, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { motion } from "framer-motion";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const sectionLabel =
  "text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid";

type WfRow = {
  forecast_time: string;
  wind_speed_10m: number | null;
  wind_speed_100m: number | null;
  temperature_2m: number | null;
  solar_radiation: number | null;
};

type PpRow = {
  calculated_at: string;
  wind_gw: number | null;
};

type SolarRow = {
  datetime_gmt: string;
  solar_mw: number | null;
};

function mapWfRaw(r: Record<string, unknown>): WfRow {
  return {
    forecast_time: String(r.forecast_time ?? ""),
    wind_speed_10m: parseNum(r.wind_speed_10m),
    wind_speed_100m: parseNum(r.wind_speed_100m),
    temperature_2m: parseNum(r.temperature_2m),
    solar_radiation: parseNum(r.solar_radiation),
  };
}

function nearestPpWind(
  targetMs: number,
  pp: PpRow[],
): number | null {
  if (pp.length === 0) return null;
  let best: PpRow | null = null;
  let bestDiff = Infinity;
  for (const row of pp) {
    const t = parseISO(row.calculated_at).getTime();
    const d = Math.abs(t - targetMs);
    if (d < bestDiff && d < 3.5 * 60 * 60 * 1000) {
      bestDiff = d;
      best = row;
    }
  }
  const w = best?.wind_gw;
  return typeof w === "number" && Number.isFinite(w) ? w : null;
}

function negativePriceWindows(
  points: HourlyForecastPoint[],
  thresholdGw = 5,
): string[] {
  const out: string[] = [];
  let runStart: HourlyForecastPoint | null = null;
  let runEnd: HourlyForecastPoint | null = null;
  let sum = 0;
  let n = 0;
  const flush = () => {
    if (!runStart) return;
    const end = runEnd ?? runStart;
    const avg = sum / n;
    const d0 = formatDayLabel(runStart.forecast_time);
    const t0 = formatInTimeZone(
      parseISO(runStart.forecast_time),
      "UTC",
      "HH:mm",
    );
    const t1 = formatInTimeZone(parseISO(end.forecast_time), "UTC", "HH:mm");
    out.push(
      `${d0} ${t0}–${t1} UTC (avg ${avg.toFixed(1)} GW)`,
    );
    runStart = null;
    runEnd = null;
    sum = 0;
    n = 0;
  };
  for (const p of points) {
    if (p.residualGw < thresholdGw) {
      if (!runStart) {
        runStart = p;
        runEnd = p;
        sum = p.residualGw;
        n = 1;
      } else {
        runEnd = p;
        sum += p.residualGw;
        n += 1;
      }
    } else {
      flush();
    }
  }
  flush();
  return out;
}

const TEMP_LINE_STROKE = "#9ca3af";

const TOOLTIP_BOX: CSSProperties = {
  background: "#F5F0E8",
  border: "1px solid #D4CCBB",
  borderRadius: 6,
  padding: "8px 12px",
  fontSize: 12,
};

type TooltipPayloadEntry = {
  dataKey?: string | number | ((obj: unknown) => unknown);
  value?: number | string;
  color?: string;
};

function formatChartTooltipTime(label: unknown): string {
  try {
    const d = new Date(String(label));
    if (Number.isNaN(d.getTime())) return String(label ?? "");
    return (
      d.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }) +
      " " +
      d.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  } catch {
    return String(label ?? "");
  }
}

function ChartTooltip({
  active,
  payload,
  label,
  series,
}: {
  active?: boolean;
  payload?: readonly TooltipPayloadEntry[];
  label?: string | number;
  series: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const allowed = new Set(Object.keys(series));
  const rows = [...payload].filter((e) => {
    const dk = e.dataKey;
    if (typeof dk === "function") return false;
    return allowed.has(String(dk ?? ""));
  });
  if (rows.length === 0) return null;
  return (
    <div style={TOOLTIP_BOX}>
      <div
        style={{
          marginBottom: 4,
          color: "#6b6b5a",
          fontWeight: 500,
        }}
      >
        {formatChartTooltipTime(label)}
      </div>
      {rows.map((entry, i) => {
        const key = String(entry.dataKey ?? "");
        const text = series[key] ?? key;
        const raw = entry.value;
        const value =
          typeof raw === "number"
            ? raw.toFixed(1)
            : raw != null
              ? String(raw)
              : "";
        return (
          <div key={i} style={{ color: entry.color, marginBottom: 2 }}>
            {text}: {value}
          </div>
        );
      })}
    </div>
  );
}

function tooltipPayload(p: { payload?: unknown } | undefined) {
  return p?.payload as readonly TooltipPayloadEntry[] | undefined;
}

function MarketImplicationBox({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-transparent rounded-[6px] border border-solid border-[#D4CCBB] border-l-[3px] border-l-[#1D6B4E] ${className}`}
      style={{ padding: "16px 20px" }}
    >
      <p className="text-[9px] font-normal uppercase tracking-[0.1em] text-[#9ca3af]">
        MARKET IMPLICATION
      </p>
      <div className="mt-2 text-[13px] leading-[1.6] text-[#3D3D2E]">
        {children}
      </div>
    </div>
  );
}

export default function WeatherPage() {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wf168, setWf168] = useState<WfRow[]>([]);
  const [wfYesterday, setWfYesterday] = useState<WfRow[]>([]);
  const [pp48, setPp48] = useState<PpRow[]>([]);
  const [ppLatest, setPpLatest] = useState<{
    wind_gw: number | null;
    solar_gw: number | null;
    residual_demand_gw: number | null;
    srmc_gbp_mwh: number | null;
    calculated_at: string | null;
  } | null>(null);
  const [solarToday, setSolarToday] = useState<SolarRow[]>([]);

  useEffect(() => {
    const supabase = createBrowserClient();
    const now = new Date();
    const nowIso = now.toISOString();
    const h48 = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const dayStart = formatInTimeZone(now, "UTC", "yyyy-MM-dd");
    const dayEnd = `${dayStart}T23:59:59.999Z`;

    async function load() {
      setLoadError(null);
      const wfSel =
        "forecast_time, wind_speed_10m, wind_speed_100m, temperature_2m, solar_radiation";

      const [
        wfRes,
        yfRes,
        pp48Res,
        pp1Res,
        solarRes,
      ] = await Promise.all([
        supabase
          .from("weather_forecasts")
          .select(wfSel)
          .eq("location", "GB")
          .gte("forecast_time", nowIso)
          .order("forecast_time", { ascending: true })
          .limit(168),
        supabase
          .from("weather_forecasts")
          .select(wfSel)
          .eq("location", "GB")
          .gte("forecast_time", h48)
          .lt("forecast_time", h24)
          .order("forecast_time", { ascending: true }),
        supabase
          .from("physical_premium")
          .select("calculated_at, wind_gw")
          .order("calculated_at", { ascending: false })
          .limit(48),
        supabase
          .from("physical_premium")
          .select(
            "wind_gw, solar_gw, residual_demand_gw, srmc_gbp_mwh, calculated_at",
          )
          .order("calculated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("solar_outturn")
          .select("datetime_gmt, solar_mw")
          .gte("datetime_gmt", `${dayStart}T00:00:00.000Z`)
          .lte("datetime_gmt", dayEnd)
          .order("datetime_gmt", { ascending: true }),
      ]);

      if (wfRes.error) setLoadError(wfRes.error.message);
      else {
        const raw168 = (wfRes.data ?? []) as Record<string, unknown>[];
        const mapped168 = raw168.map((r) => mapWfRaw(r));
        setWf168(mapped168);
      }

      if (!yfRes.error && yfRes.data) {
        setWfYesterday(
          yfRes.data.map((r) => mapWfRaw(r as Record<string, unknown>)),
        );
      } else {
        setWfYesterday([]);
      }

      if (!pp48Res.error && pp48Res.data) {
        setPp48(
          (pp48Res.data as PpRow[]).map((r) => ({
            calculated_at: String(r.calculated_at),
            wind_gw: parseNum(r.wind_gw),
          })),
        );
      } else {
        setPp48([]);
      }

      if (!pp1Res.error && pp1Res.data) {
        const p = pp1Res.data as Record<string, unknown>;
        setPpLatest({
          wind_gw: parseNum(p.wind_gw),
          solar_gw: parseNum(p.solar_gw),
          residual_demand_gw: parseNum(p.residual_demand_gw),
          srmc_gbp_mwh: parseNum(p.srmc_gbp_mwh),
          calculated_at:
            p.calculated_at != null ? String(p.calculated_at) : null,
        });
      } else {
        setPpLatest(null);
      }

      if (!solarRes.error && solarRes.data) {
        setSolarToday(
          (solarRes.data as SolarRow[]).map((r) => ({
            datetime_gmt: String(r.datetime_gmt),
            solar_mw: parseNum(r.solar_mw),
          })),
        );
      } else {
        setSolarToday([]);
      }
    }

    load().finally(() => setLoading(false));
  }, []);

  const { hourly, solarRadiationUnavailable } = useMemo(() => {
    const pos = wf168
      .map((r) => r.solar_radiation)
      .filter((x): x is number => x != null && x > 0);
    const unavailable = wf168.length > 0 && pos.length === 0;
    const rows = wf168.map((r) => ({
      forecast_time: r.forecast_time,
      w10: r.wind_speed_10m,
      w100: r.wind_speed_100m,
      temp: r.temperature_2m,
      rad: r.solar_radiation,
    }));
    return {
      hourly: buildHourlyPoints(rows, { solarRadToGw: SOLAR_RAD_TO_GW }),
      solarRadiationUnavailable: unavailable,
    };
  }, [wf168]);

  const chartWindTemp = useMemo(() => {
    return hourly.map((p) => ({
      ...p,
      windBandBase: p.windMin,
      windBandSpread: p.windSpread,
      tempC: p.tempC ?? undefined,
    }));
  }, [hourly]);

  const rampIndices = useMemo(
    () => findRampIndices(hourly.map((h) => h.windGw100)),
    [hourly],
  );

  const statCurrentWind = useMemo(() => {
    if (hourly.length === 0) return null;
    const now = new Date().getTime();
    let best = hourly[0]!;
    let bd = Infinity;
    for (const h of hourly) {
      const d = Math.abs(h.ts - now);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best.windGw100;
  }, [hourly]);

  const statWindRange = useMemo(() => {
    if (hourly.length === 0) return null;
    const gws = hourly.map((h) => h.windGw100);
    return { min: Math.min(...gws), max: Math.max(...gws) };
  }, [hourly]);

  const statDroughtPct = useMemo(() => droughtPct(hourly), [hourly]);

  const statPeakSolar = useMemo(() => {
    if (hourly.length === 0) return null;
    let best: HourlyForecastPoint | null = null;
    let maxGw = -Infinity;
    for (const h of hourly) {
      const s = h.solarGw ?? 0;
      if (s > maxGw) {
        maxGw = s;
        best = h;
      }
    }
    if (maxGw <= 0 || best == null) return "pending" as const;
    return {
      gw: best.solarGw ?? 0,
      label: formatDayLabel(best.forecast_time),
    };
  }, [hourly]);

  const statSurprise = useMemo(() => {
    if (hourly.length === 0 || ppLatest?.wind_gw == null) return null;
    const mean =
      hourly.reduce((a, h) => a + h.windGw100, 0) / hourly.length;
    const cur = ppLatest.wind_gw;
    return { delta: cur - mean, current: cur, mean };
  }, [hourly, ppLatest]);

  const yesterdayMae = useMemo(() => {
    if (wfYesterday.length === 0 || pp48.length === 0) return null;
    const ppAsc = [...pp48].sort(
      (a, b) =>
        parseISO(a.calculated_at).getTime() -
        parseISO(b.calculated_at).getTime(),
    );
    const errs: number[] = [];
    const biases: number[] = [];
    for (const r of wfYesterday) {
      const w100 = parseNum(r.wind_speed_100m);
      if (w100 == null) continue;
      const fGw = w100 * WIND_MS_TO_GW;
      const t = parseISO(r.forecast_time).getTime();
      const act = nearestPpWind(t, ppAsc);
      if (act == null) continue;
      errs.push(Math.abs(fGw - act));
      biases.push(fGw - act);
    }
    if (errs.length === 0) return null;
    const mae = errs.reduce((a, b) => a + b, 0) / errs.length;
    const bias =
      biases.reduce((a, b) => a + b, 0) / biases.length;
    return { mae, bias, n: errs.length };
  }, [wfYesterday, pp48]);

  const droughtSeverity = useMemo(() => {
    const p = statDroughtPct;
    if (p < 20) return { label: "LOW", color: "text-[#1D6B4E]" };
    if (p < 40) return { label: "MODERATE", color: "text-amber-700" };
    if (p < 60) return { label: "HIGH", color: "text-[#8B3A3A]" };
    return { label: "SEVERE", color: "text-[#6B2E2E] font-bold" };
  }, [statDroughtPct]);

  const droughtRiskColor = useMemo(() => {
    const p = statDroughtPct;
    if (p < 20) return "text-[#1D6B4E]";
    if (p < 40) return "text-amber-700";
    return "text-[#8B3A3A]";
  }, [statDroughtPct]);

  const dailyBreakdown = useMemo(() => {
    const g = groupByUtcDay(hourly);
    const keys = [...g.keys()].sort();
    return keys.map((k) => {
      const pts = g.get(k)!;
      const gws = pts.map((p) => p.windGw100);
      const avg = gws.reduce((a, b) => a + b, 0) / gws.length;
      const min = Math.min(...gws);
      const max = Math.max(...gws);
      return {
        dayKey: k,
        dayName: formatDayLabel(pts[0]!.forecast_time),
        avg,
        min,
        max,
      };
    });
  }, [hourly]);

  const lowestWind = useMemo(() => {
    if (hourly.length === 0) return null;
    let best = hourly[0]!;
    for (const h of hourly) {
      if (h.windGw100 < best.windGw100) best = h;
    }
    return {
      gw: best.windGw100,
      label: `${formatDayLabel(best.forecast_time)} ${formatInTimeZone(
        parseISO(best.forecast_time),
        "UTC",
        "HH:mm",
      )} UTC`,
    };
  }, [hourly]);

  const hoursBelowDrought = useMemo(
    () => hourly.filter((h) => h.windGw100 < WIND_DROUGHT_GW).length,
    [hourly],
  );

  const largestRamp = useMemo(() => {
    let best = 0;
    let at: HourlyForecastPoint | null = null;
    for (let i = 0; i + 2 < hourly.length; i++) {
      const d = Math.abs(
        hourly[i + 2]!.windGw100 - hourly[i]!.windGw100,
      );
      if (d > best) {
        best = d;
        at = hourly[i + 2]!;
      }
    }
    if (!at) return null;
    return {
      gw: best,
      day: formatDayLabel(at.forecast_time),
    };
  }, [hourly]);

  const residualStats = useMemo(() => {
    const pts = hourly;
    if (pts.length === 0) {
      return {
        gas: 0,
        trans: 0,
        ren: 0,
        gasPct: 0,
        transPct: 0,
        renPct: 0,
        peak: null as HourlyForecastPoint | null,
        low: null as HourlyForecastPoint | null,
      };
    }
    let gas = 0;
    let trans = 0;
    let ren = 0;
    for (const p of pts) {
      const r = p.residualGw;
      if (r > GAS_MARGINAL_GW) gas++;
      else if (r >= RENEWABLE_DOM_GW) trans++;
      else ren++;
    }
    const total = pts.length;
    let peak = pts[0]!;
    let low = pts[0]!;
    for (const p of pts) {
      if (p.residualGw > peak.residualGw) peak = p;
      if (p.residualGw < low.residualGw) low = p;
    }
    return {
      gas,
      trans,
      ren,
      gasPct: (gas / total) * 100,
      transPct: (trans / total) * 100,
      renPct: (ren / total) * 100,
      peak,
      low,
    };
  }, [hourly]);

  const negWindows = useMemo(
    () => negativePriceWindows(hourly, RENEWABLE_DOM_GW),
    [hourly],
  );

  const solarChartData = useMemo(() => {
    const todayKey = formatInTimeZone(new Date(), "UTC", "yyyy-MM-dd");
    const actualByHour = new Map<string, number>();
    for (const s of solarToday) {
      if (s.solar_mw == null) continue;
      const key = formatInTimeZone(
        parseISO(s.datetime_gmt),
        "UTC",
        "yyyy-MM-dd HH:00",
      );
      actualByHour.set(key, s.solar_mw);
    }
    return hourly.map((h) => {
      const fk = formatInTimeZone(
        parseISO(h.forecast_time),
        "UTC",
        "yyyy-MM-dd HH:00",
      );
      const day = formatInTimeZone(
        parseISO(h.forecast_time),
        "UTC",
        "yyyy-MM-dd",
      );
      const solar =
        h.solarGw != null && h.solarGw > 0.05 ? h.solarGw : null;
      let actual: number | null = null;
      if (day === todayKey) {
        actual = actualByHour.get(fk) ?? null;
      }
      return {
        forecast_time: h.forecast_time,
        solarForecast: solar,
        solarActual: actual,
        dayTick: formatDayLabel(h.forecast_time),
      };
    });
  }, [hourly, solarToday]);

  const solarPeakWeek = useMemo(() => {
    let best: HourlyForecastPoint | null = null;
    let maxGw = -Infinity;
    for (const h of hourly) {
      const s = h.solarGw ?? 0;
      if (s > maxGw) {
        maxGw = s;
        best = h;
      }
    }
    if (!best || maxGw <= 0) return null;
    return {
      gw: maxGw,
      day: formatDayLabel(best.forecast_time),
      time: formatInTimeZone(
        parseISO(best.forecast_time),
        "UTC",
        "HH:mm",
      ),
    };
  }, [hourly]);

  const solarEnergyGwh = useMemo(() => {
    let s = 0;
    for (const h of hourly) {
      const g = h.solarGw;
      if (g != null && g > 0) s += g;
    }
    return s;
  }, [hourly]);

  const solarAvgContrib = useMemo(() => {
    const withS = hourly.filter((h) => h.solarGw != null && h.solarGw! > 0);
    if (withS.length === 0) return null;
    return (
      withS.reduce((a, h) => a + (h.solarGw ?? 0), 0) / withS.length
    );
  }, [hourly]);

  const solarPeakDots = useMemo(() => {
    const g = groupByUtcDay(hourly);
    const dots: { forecast_time: string; solarGw: number }[] = [];
    for (const [, pts] of g) {
      let best = pts[0]!;
      for (const p of pts) {
        const sg = p.solarGw ?? 0;
        if (sg > (best.solarGw ?? 0)) best = p;
      }
      if ((best.solarGw ?? 0) > 0.05)
        dots.push({
          forecast_time: best.forecast_time,
          solarGw: best.solarGw!,
        });
    }
    return dots;
  }, [hourly]);

  const tempStats = useMemo(() => {
    const temps = hourly
      .map((h) => h.tempC)
      .filter((t): t is number => t != null && Number.isFinite(t));
    if (temps.length === 0) return null;
    const avg = temps.reduce((a, b) => a + b, 0) / temps.length;
    let cold = hourly[0]!;
    let warm = hourly[0]!;
    for (const h of hourly) {
      if (h.tempC == null) continue;
      if (!cold.tempC || h.tempC < cold.tempC!) cold = h;
      if (!warm.tempC || h.tempC > warm.tempC!) warm = h;
    }
    const hdd = dailyBreakdown.reduce((sum, d) => {
      return sum + heatingDegreeDayContribution(d.avg);
    }, 0);
    return {
      avg,
      vsNorm: avg - APRIL_TEMP_NORM_C,
      cold,
      warm,
      hdd,
    };
  }, [hourly, dailyBreakdown]);

  const tempGasCopy = useMemo(() => {
    const a = tempStats?.avg;
    if (a == null) return "";
    if (a < 8) {
      return "Below-normal temperatures materially support gas heating demand. Every 1°C below norm adds approximately 1-2 mcm/day to UK gas demand. Bullish for NBP prompt.";
    }
    if (a <= 10) {
      return "Near-normal temperatures. Gas heating demand broadly in line with seasonal expectations. Neutral for NBP.";
    }
    return "Above-normal temperatures reduce heating demand. Gas displacement risk from renewables amplified by weak heating load. Bearish for NBP prompt.";
  }, [tempStats]);

  const residualGradientId = "residualGradient";
  const srmcRefGbp = ppLatest?.srmc_gbp_mwh ?? SRMC_REF_GBP;

  const gradMax = useMemo(() => {
    const m = Math.max(
      25,
      GAS_MARGINAL_GW + 3,
      ...hourly.map((h) => h.residualGw),
      1,
    );
    return Math.ceil(m / 5) * 5;
  }, [hourly]);

  const midnightTicks = useMemo(() => {
    const t: string[] = [];
    for (const h of hourly) {
      const d = parseISO(h.forecast_time);
      if (d.getUTCHours() === 0) t.push(h.forecast_time);
    }
    return t;
  }, [hourly]);

  const forecastHorizonStartLabel = useMemo(() => {
    const t = wf168[0]?.forecast_time;
    if (!t) return null;
    try {
      return (
        formatInTimeZone(parseISO(t), "UTC", "dd MMM yyyy HH:mm") + " UTC"
      );
    } catch {
      return null;
    }
  }, [wf168]);

  const physicalPremiumSnapshotLabel = useMemo(() => {
    const raw = ppLatest?.calculated_at;
    if (!raw) return null;
    try {
      return (
        formatInTimeZone(parseISO(raw), "UTC", "dd MMM yyyy HH:mm") + " UTC"
      );
    } catch {
      return null;
    }
  }, [ppLatest?.calculated_at]);

  return (
    <div className="space-y-8">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-serif text-3xl text-ink"
        >
          Weather
        </motion.h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-mid">
          Ensemble wind, temperature, and solar drivers for GB power and gas
          markets
        </p>
      </div>

      {loadError ? (
        <p className="text-sm text-[#8B3A3A]">{loadError}</p>
      ) : null}

      {/* Section 1 — Stat bar */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-end gap-x-8 gap-y-3 border-b-[0.5px] border-ivory-border bg-ivory px-4 py-3 sm:px-5"
      >
        <div>
          <p className={sectionLabel}>Current wind (implied)</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {loading
              ? "…"
              : statCurrentWind != null
                ? `${statCurrentWind.toFixed(1)} GW implied`
                : "—"}
          </p>
        </div>
        <div>
          <p className={sectionLabel}>7-day wind range</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {loading || !statWindRange
              ? "…"
              : `${statWindRange.min.toFixed(1)} – ${statWindRange.max.toFixed(1)} GW`}
          </p>
        </div>
        <div>
          <p className={sectionLabel}>Wind drought risk</p>
          <p
            className={`mt-1 text-lg font-semibold tabular-nums ${droughtRiskColor}`}
          >
            {loading ? "…" : `${statDroughtPct.toFixed(0)}% drought risk`}
          </p>
        </div>
        <div>
          <p className={sectionLabel}>Peak solar</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {loading
              ? "…"
              : statPeakSolar === "pending"
                ? "Data pending"
                : statPeakSolar
                  ? `${statPeakSolar.gw.toFixed(1)} GW on ${statPeakSolar.label}`
                  : "—"}
          </p>
        </div>
      </motion.div>
      <p className="font-mono text-[10px] text-ink-light">
        Forecast: Supabase{" "}
        <code className="text-[9px]">weather_forecasts</code> (Open-Meteo)
        {forecastHorizonStartLabel != null
          ? ` · horizon from ${forecastHorizonStartLabel}`
          : ""}
        . &quot;Current wind (implied)&quot; vs{" "}
        <code className="text-[9px]">physical_premium</code> implied wind: desk
        snapshot{" "}
        {physicalPremiumSnapshotLabel ?? "pending"} (aligned with Markets
        header).
      </p>

      {/* Section 2 — Wind & temperature */}
      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4">
        <p className={sectionLabel}>7-Day Wind & Temperature Forecast</p>
        <p className="mt-1 text-[11px] italic text-ink-light">
          100m wind converted to implied GB generation · uncertainty band shows
          10m–100m spread
        </p>
        <div className="mt-4 h-[220px] w-full min-h-[220px]">
          {chartWindTemp.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart
                data={chartWindTemp}
                margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(44,42,38,0.08)"
                  vertical={false}
                />
                <XAxis
                  dataKey="forecast_time"
                  ticks={midnightTicks.length ? midnightTicks : undefined}
                  tickFormatter={(iso) => {
                    try {
                      return format(parseISO(String(iso)), "EEE");
                    } catch {
                      return "";
                    }
                  }}
                  tick={{ fontSize: 10, fill: GREY_TEMP }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="w"
                  domain={[0, 35]}
                  tick={{ fontSize: 10, fill: BRAND_GREEN }}
                  width={36}
                  label={{
                    value: "GW",
                    angle: -90,
                    position: "insideLeft",
                    fill: BRAND_GREEN,
                    fontSize: 10,
                  }}
                />
                <YAxis
                  yAxisId="t"
                  orientation="right"
                  domain={[-5, 20]}
                  tick={{ fontSize: 10, fill: GREY_TEMP }}
                  width={36}
                  label={{
                    value: "°C",
                    angle: 90,
                    position: "insideRight",
                    fill: GREY_TEMP,
                    fontSize: 10,
                  }}
                />
                <Tooltip
                  content={(props) => (
                    <ChartTooltip
                      active={props.active}
                      payload={tooltipPayload(props)}
                      label={props.label}
                      series={{
                        windGw100: "Wind GW",
                        tempC: "Temp °C",
                      }}
                    />
                  )}
                />
                <Area
                  yAxisId="w"
                  type="monotone"
                  dataKey="windBandBase"
                  stackId="band"
                  stroke="none"
                  fill="transparent"
                  isAnimationActive={false}
                />
                <Area
                  yAxisId="w"
                  type="monotone"
                  dataKey="windBandSpread"
                  stackId="band"
                  stroke="none"
                  fill={BRAND_GREEN}
                  fillOpacity={0.15}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="w"
                  type="monotone"
                  dataKey="windGw100"
                  stroke={BRAND_GREEN}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="w"
                  type="monotone"
                  dataKey="windGw10"
                  stroke={BRAND_GREEN}
                  strokeOpacity={0.35}
                  strokeDasharray="4 4"
                  dot={false}
                  strokeWidth={1}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="t"
                  type="monotone"
                  dataKey="tempC"
                  stroke={TEMP_LINE_STROKE}
                  strokeWidth={1.25}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                <ReferenceLine
                  yAxisId="w"
                  y={WIND_DROUGHT_GW}
                  stroke={TERRACOTTA}
                  strokeDasharray="4 4"
                  label={{
                    value: "Drought threshold",
                    fill: TERRACOTTA,
                    fontSize: 9,
                  }}
                />
                <ReferenceLine
                  yAxisId="w"
                  y={HIGH_WIND_GW}
                  stroke={BRAND_GREEN}
                  strokeOpacity={0.5}
                  strokeDasharray="4 4"
                  label={{
                    value: "High wind",
                    fill: BRAND_GREEN,
                    fontSize: 9,
                  }}
                />
                <ReferenceLine
                  yAxisId="t"
                  y={APRIL_TEMP_NORM_C}
                  stroke={GREY_TEMP}
                  strokeDasharray="4 4"
                  label={{
                    value: "April norm",
                    fill: GREY_TEMP,
                    fontSize: 9,
                  }}
                />
                {rampIndices.map((i) => {
                  const pt = chartWindTemp[i];
                  if (!pt) return null;
                  return (
                    <ReferenceDot
                      key={pt.forecast_time + String(i)}
                      yAxisId="w"
                      x={pt.forecast_time}
                      y={pt.windGw100}
                      r={4}
                      fill={TERRACOTTA}
                      stroke="#fff"
                      strokeWidth={1}
                      label={{
                        value: "⚡ ramp",
                        position: "top",
                        fill: TERRACOTTA,
                        fontSize: 9,
                      }}
                    />
                  );
                })}
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[220px] items-center text-sm text-ink-mid">
              {loading ? "Loading…" : "No forecast data"}
            </div>
          )}
        </div>
        <p className="mt-2 text-[10px] text-ink-mid">
          ■ Wind GW · ~ Uncertainty band (10m–100m) · — Temperature °C
        </p>
      </div>

      {/* Section 3 — Two columns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4">
          <p className={sectionLabel}>Wind Drought Risk Analysis</p>
          <p className={`mt-1 mt-2 text-xl font-semibold ${droughtSeverity.color}`}>
            {droughtSeverity.label}
          </p>
          <div className="mt-4 space-y-3">
            {dailyBreakdown.map((d) => (
              <div key={d.dayKey} className="flex flex-wrap items-center gap-2">
                <span className="w-10 text-sm font-medium text-ink">
                  {d.dayName}
                </span>
                <span className="text-xs tabular-nums text-ink-mid">
                  avg {d.avg.toFixed(1)} GW · {d.min.toFixed(1)}–
                  {d.max.toFixed(1)}
                </span>
                <div className="h-2 min-w-[80px] flex-1 overflow-hidden rounded-sm bg-ivory-border/60">
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: `${Math.min(100, (d.avg / 35) * 100)}%`,
                      backgroundColor:
                        d.avg > HIGH_WIND_GW
                          ? BRAND_GREEN
                          : d.avg >= WIND_DROUGHT_GW
                            ? AMBER
                            : TERRACOTTA,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-1 text-[11px] text-ink-mid">
            {lowestWind ? (
              <p>
                Lowest wind period: {lowestWind.label} at{" "}
                {lowestWind.gw.toFixed(1)} GW
              </p>
            ) : null}
            <p>
              Duration below {WIND_DROUGHT_GW} GW threshold: {hoursBelowDrought} hours total
            </p>
            {largestRamp ? (
              <p>
                Largest single ramp: ±{largestRamp.gw.toFixed(1)} GW over 3 hours
                on {largestRamp.day}
              </p>
            ) : null}
            <MarketImplicationBox className="mt-2">
              Wind drought periods create gas-marginal conditions. CCGT SRMC at
              £{srmcRefGbp.toFixed(2)}/MWh provides the price ceiling.
            </MarketImplicationBox>
          </div>
        </div>

        <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4">
          <p className={sectionLabel}>Wind Surprise & Forecast Accuracy</p>
          {statSurprise ? (
            <>
              <p
                className={`mt-2 font-serif text-3xl tabular-nums ${
                  statSurprise.delta >= 0
                    ? "text-[#1D6B4E]"
                    : "text-[#8B3A3A]"
                }`}
              >
                {statSurprise.delta >= 0 ? "+" : ""}
                {statSurprise.delta.toFixed(1)} GW vs forecast mean
              </p>
              <p className="mt-1 text-xs text-ink-mid">
                Current: {statSurprise.current.toFixed(1)} GW · 7-day mean:{" "}
                {statSurprise.mean.toFixed(1)} GW
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-mid">—</p>
          )}
          <div className="mt-6 border-t-[0.5px] border-ivory-border pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-light">
              Yesterday forecast accuracy
            </p>
            {yesterdayMae ? (
              <>
                <p className="mt-2 text-sm text-ink">
                  Yesterday forecast MAE: ±{yesterdayMae.mae.toFixed(1)} GW
                </p>
                <p className="mt-1 text-sm text-ink">
                  Forecast bias:{" "}
                  {yesterdayMae.bias >= 0 ? "+" : ""}
                  {yesterdayMae.bias.toFixed(1)} GW (
                  {yesterdayMae.bias >= 0
                    ? "model overestimating"
                    : "underestimating"}
                  )
                </p>
                <p
                  className={`mt-2 text-sm ${
                    yesterdayMae.mae < 2
                      ? "text-[#1D6B4E]"
                      : yesterdayMae.mae <= 4
                        ? "text-amber-700"
                        : "text-[#8B3A3A]"
                  }`}
                >
                  {yesterdayMae.mae < 2
                    ? "Good accuracy"
                    : yesterdayMae.mae <= 4
                      ? "Moderate accuracy"
                      : "Poor accuracy — treat forecasts with caution"}
                </p>
              </>
            ) : (
              <p className="mt-2 text-xs italic text-ink-light">
                Forecast accuracy comparison requires 24h of matched data. Check
                back tomorrow for yesterday&apos;s accuracy metrics.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Section 4 — Solar */}
      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4">
        <p className={sectionLabel}>7-Day Solar Generation Forecast</p>
        <p className="mt-1 text-[11px] italic text-ink-light">
          Derived from solar radiation forecast (W/m²) · peak generation typically
          10:00–15:00 UTC
        </p>
        <p className="mt-1 text-[10px] leading-snug text-ink-light">
          Orange area: forecast from radiation model · darker line: GB solar
          outturn (<code className="text-[9px]">solar_outturn</code>, MW→GW)
          where time-aligned.
        </p>
        <div className="mt-4 h-[160px] min-h-[160px]">
          {loading ? (
            <div className="flex h-[160px] items-center text-sm text-ink-mid">
              Loading…
            </div>
          ) : solarRadiationUnavailable ? (
            <div className="flex h-[160px] items-center justify-center px-4 text-center text-sm text-ink-mid">
              Solar radiation data not yet available from forecast provider
            </div>
          ) : solarChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <ComposedChart
                data={solarChartData}
                margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(44,42,38,0.08)"
                  vertical={false}
                />
                <XAxis
                  dataKey="forecast_time"
                  ticks={midnightTicks.length ? midnightTicks : undefined}
                  tickFormatter={(iso) => {
                    try {
                      return format(parseISO(String(iso)), "EEE");
                    } catch {
                      return "";
                    }
                  }}
                  tick={{ fontSize: 10, fill: GREY_TEMP }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 12]}
                  tick={{ fontSize: 10, fill: WARM_GOLD }}
                  width={36}
                  label={{
                    value: "GW",
                    angle: -90,
                    position: "insideLeft",
                    fill: WARM_GOLD,
                    fontSize: 10,
                  }}
                />
                <Tooltip
                  content={(props) => (
                    <ChartTooltip
                      active={props.active}
                      payload={tooltipPayload(props)}
                      label={props.label}
                      series={{
                        solarForecast: "Solar GW",
                        solarActual: "Actual solar (MW)",
                      }}
                    />
                  )}
                />
                <Area
                  type="monotone"
                  dataKey="solarForecast"
                  stroke={WARM_GOLD}
                  fill={WARM_GOLD}
                  fillOpacity={0.3}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="solarActual"
                  stroke={WARM_GOLD_DARK}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                <ReferenceLine
                  y={5}
                  stroke={TERRACOTTA}
                  strokeDasharray="4 4"
                  label={{
                    value: "Significant output threshold",
                    fill: TERRACOTTA,
                    fontSize: 9,
                  }}
                />
                {solarPeakDots.map((d) => (
                  <ReferenceDot
                    key={d.forecast_time}
                    x={d.forecast_time}
                    y={d.solarGw}
                    r={3}
                    fill={WARM_GOLD}
                    stroke="#fff"
                    strokeWidth={1}
                    label={{
                      value: `${d.solarGw.toFixed(1)}`,
                      position: "top",
                      fill: WARM_GOLD,
                      fontSize: 9,
                    }}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[160px] items-center text-sm text-ink-mid">
              No solar forecast
            </div>
          )}
        </div>
        <div className="mt-2 space-y-1 text-[11px] text-ink-mid">
          {solarPeakWeek ? (
            <p>
              Peak solar this week: {solarPeakWeek.gw.toFixed(1)} GW on{" "}
              {solarPeakWeek.day} at {solarPeakWeek.time} UTC
            </p>
          ) : null}
          <p>
            Total solar energy this week: approximately{" "}
            {solarEnergyGwh.toFixed(0)} GWh (estimated)
          </p>
          {solarAvgContrib != null ? (
            <p>
              Solar contribution to residual demand reduction: avg{" "}
              {solarAvgContrib.toFixed(1)} GW
            </p>
          ) : null}
        </div>
      </div>

      {/* Section 5 — Residual demand */}
      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4">
        <p className={sectionLabel}>Implied Residual Demand Forecast</p>
        <p className="mt-1 text-[11px] italic text-ink-light">
          Demand baseline minus forecast wind and solar — indicates gas and
          dispatchable generation required
        </p>
        <p className="mt-1 text-[10px] leading-snug text-ink-light">
          Series is model output from{" "}
          <code className="text-[9px]">physical_premium</code> (residual demand),
          not N2EX tape — same story as Overview implied stack vs exchange.
        </p>
        <div className="mt-4 h-[200px] min-h-[200px]">
          {hourly.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart
                data={hourly}
                margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
              >
                <defs>
                  <linearGradient
                    id={residualGradientId}
                    x1="0"
                    y1="1"
                    x2="0"
                    y2="0"
                  >
                    <stop
                      offset="0%"
                      stopColor={TERRACOTTA}
                      stopOpacity={0.85}
                    />
                    <stop
                      offset={`${(RENEWABLE_DOM_GW / gradMax) * 100}%`}
                      stopColor={TERRACOTTA}
                      stopOpacity={0.85}
                    />
                    <stop
                      offset={`${(GAS_MARGINAL_GW / gradMax) * 100}%`}
                      stopColor={AMBER}
                      stopOpacity={0.75}
                    />
                    <stop
                      offset="100%"
                      stopColor={BRAND_GREEN}
                      stopOpacity={0.35}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(44,42,38,0.08)"
                  vertical={false}
                />
                <XAxis
                  dataKey="forecast_time"
                  ticks={midnightTicks.length ? midnightTicks : undefined}
                  tickFormatter={(iso) => {
                    try {
                      return format(parseISO(String(iso)), "EEE");
                    } catch {
                      return "";
                    }
                  }}
                  tick={{ fontSize: 10, fill: GREY_TEMP }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, gradMax]}
                  tick={{ fontSize: 10, fill: BRAND_GREEN }}
                  width={40}
                  label={{
                    value: "GW",
                    angle: -90,
                    position: "insideLeft",
                    fill: BRAND_GREEN,
                    fontSize: 10,
                  }}
                />
                <Tooltip
                  content={(props) => (
                    <ChartTooltip
                      active={props.active}
                      payload={tooltipPayload(props)}
                      label={props.label}
                      series={{
                        residualGw: "Residual demand GW",
                      }}
                    />
                  )}
                />
                <Area
                  type="monotone"
                  dataKey="residualGw"
                  stroke={BRAND_GREEN}
                  strokeWidth={1}
                  fill={`url(#${residualGradientId})`}
                  fillOpacity={0.9}
                  isAnimationActive={false}
                />
                <ReferenceLine
                  y={GAS_MARGINAL_GW}
                  stroke={BRAND_GREEN}
                  strokeDasharray="4 4"
                  strokeOpacity={0.8}
                  label={{
                    value: "Gas marginal",
                    fill: BRAND_GREEN,
                    fontSize: 9,
                  }}
                />
                <ReferenceLine
                  y={RENEWABLE_DOM_GW}
                  stroke={TERRACOTTA}
                  strokeDasharray="4 4"
                  label={{
                    value: "Renewable dominant",
                    fill: TERRACOTTA,
                    fontSize: 9,
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[200px] items-center text-sm text-ink-mid">
              No data
            </div>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-[11px] text-ink-mid md:grid-cols-4">
          <p>
            Gas-marginal hours: {residualStats.gas} (
            {residualStats.gasPct.toFixed(0)}%)
          </p>
          <p>
            Transitional hours: {residualStats.trans} (
            {residualStats.transPct.toFixed(0)}%)
          </p>
          <p>
            Renewable-dominated hours: {residualStats.ren} (
            {residualStats.renPct.toFixed(0)}%)
          </p>
          <p>
            {residualStats.peak ? (
              <>
                Peak residual: {residualStats.peak.residualGw.toFixed(1)} GW{" "}
                {formatDayLabel(residualStats.peak.forecast_time)}{" "}
                {formatInTimeZone(
                  parseISO(residualStats.peak.forecast_time),
                  "UTC",
                  "HH:mm",
                )}
              </>
            ) : (
              "Peak residual: —"
            )}
          </p>
        </div>
        <p className="mt-2 text-[11px] text-ink-mid">
          {residualStats.low ? (
            <>
              Minimum residual: {residualStats.low.residualGw.toFixed(1)} GW{" "}
              {formatDayLabel(residualStats.low.forecast_time)}{" "}
              {formatInTimeZone(
                parseISO(residualStats.low.forecast_time),
                "UTC",
                "HH:mm",
              )}
            </>
          ) : (
            "Minimum residual: —"
          )}
        </p>
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-light">
            Negative pricing risk periods
          </p>
          {negWindows.length ? (
            <ul className="mt-1 list-inside list-disc text-[11px] text-ink-mid">
              {negWindows.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[11px] text-ink-mid">
              No periods with residual &lt; {RENEWABLE_DOM_GW} GW in forecast.
            </p>
          )}
        </div>
      </div>

      {/* Section 6 — Temperature & gas */}
      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4">
        <p className={sectionLabel}>Temperature Forecast & Gas Demand Implication</p>
        <div className="mt-4 h-[150px] min-h-[150px]">
          {hourly.some((h) => h.tempC != null) ? (
            <ResponsiveContainer width="100%" height={150}>
              <LineChart
                data={hourly}
                margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(44,42,38,0.08)"
                  vertical={false}
                />
                <XAxis
                  dataKey="forecast_time"
                  ticks={midnightTicks.length ? midnightTicks : undefined}
                  tickFormatter={(iso) => {
                    try {
                      return format(parseISO(String(iso)), "EEE");
                    } catch {
                      return "";
                    }
                  }}
                  tick={{ fontSize: 10, fill: GREY_TEMP }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={[-5, 20]}
                  tick={{ fontSize: 10, fill: GREY_TEMP }}
                  width={36}
                  label={{
                    value: "°C",
                    angle: -90,
                    position: "insideLeft",
                    fill: GREY_TEMP,
                    fontSize: 10,
                  }}
                />
                <Tooltip
                  content={(props) => (
                    <ChartTooltip
                      active={props.active}
                      payload={tooltipPayload(props)}
                      label={props.label}
                      series={{
                        tempC: "Temperature °C",
                      }}
                    />
                  )}
                />
                <ReferenceArea
                  y1={-5}
                  y2={APRIL_TEMP_NORM_C}
                  fill="#3b82f6"
                  fillOpacity={0.08}
                />
                <ReferenceArea
                  y1={APRIL_TEMP_NORM_C}
                  y2={20}
                  fill="#f59e0b"
                  fillOpacity={0.08}
                />
                <ReferenceLine
                  y={APRIL_TEMP_NORM_C}
                  stroke={GREY_TEMP}
                  strokeDasharray="4 4"
                  label={{
                    value: "April norm",
                    fill: GREY_TEMP,
                    fontSize: 9,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="tempC"
                  stroke={TEMP_LINE_STROKE}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[150px] items-center text-sm text-ink-mid">
              No temperature data
            </div>
          )}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-1 text-[11px] text-ink-mid">
            {tempStats ? (
              <>
                <p>
                  7-day average: {tempStats.avg.toFixed(1)}°C (
                  {tempStats.vsNorm >= 0 ? "+" : ""}
                  {tempStats.vsNorm.toFixed(1)}° vs April norm)
                </p>
                <p>
                  Coldest: {tempStats.cold.tempC?.toFixed(1)}°C on{" "}
                  {formatDayLabel(tempStats.cold.forecast_time)}{" "}
                  {formatInTimeZone(
                    parseISO(tempStats.cold.forecast_time),
                    "UTC",
                    "HH:mm",
                  )}
                </p>
                <p>
                  Warmest: {tempStats.warm.tempC?.toFixed(1)}°C on{" "}
                  {formatDayLabel(tempStats.warm.forecast_time)}{" "}
                  {formatInTimeZone(
                    parseISO(tempStats.warm.forecast_time),
                    "UTC",
                    "HH:mm",
                  )}
                </p>
                <p>
                  Heating degree days (next 7): {tempStats.hdd.toFixed(1)} HDD
                </p>
              </>
            ) : (
              <p>—</p>
            )}
          </div>
          {tempGasCopy ? (
            <MarketImplicationBox>{tempGasCopy}</MarketImplicationBox>
          ) : null}
        </div>
      </div>
    </div>
  );
}
