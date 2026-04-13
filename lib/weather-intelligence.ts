import { format, parseISO } from "date-fns";

/** m/s → implied GB wind GW */
export const WIND_MS_TO_GW = 2.125;

/** W/m² solar_radiation → implied solar GW (GB scaling; ~300–600 W/m² April peak) */
export const SOLAR_RAD_TO_GW = 0.0167;

export const APRIL_TEMP_NORM_C = 9.0;
export const WIND_DROUGHT_GW = 10;
export const HIGH_WIND_GW = 20;
export const GAS_MARGINAL_GW = 22;
export const RENEWABLE_DOM_GW = 10;
export const SRMC_REF_GBP = 107.87;
export const RAMP_THRESHOLD_GW = 5;

export const BRAND_GREEN = "#1D6B4E";
export const WARM_GOLD = "#B45309";
export const WARM_GOLD_DARK = "#92400E";
export const TERRACOTTA = "#8B3A3A";
export const AMBER = "#D97706";
export const GREY_TEMP = "#6b7280";

export function parseNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** UTC hour 0–23 → demand baseline GW */
export function demandBaselineGwUtcHour(hour: number): number {
  if (hour >= 0 && hour < 6) return 28;
  if (hour >= 6 && hour < 9) return 34;
  if (hour >= 9 && hour < 17) return 36;
  if (hour >= 17 && hour < 21) return 38;
  return 32;
}

export function windGwFromMs(ms: number | null): number | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return ms * WIND_MS_TO_GW;
}

export function solarGwFromRadiation(
  wPerM2: number | null | undefined,
  radToGw: number = SOLAR_RAD_TO_GW,
): number | null {
  const r = parseNum(wPerM2);
  if (r == null) return null;
  return r * radToGw;
}

export type HourlyForecastPoint = {
  forecast_time: string;
  windGw100: number;
  windGw10: number;
  windMin: number;
  windMax: number;
  windSpread: number;
  tempC: number | null;
  solarGw: number | null;
  residualGw: number;
  ts: number;
};

export function buildHourlyPoints(
  rows: Array<{
    forecast_time: string;
    w10: number | null;
    w100: number | null;
    temp: number | null;
    rad: number | null;
  }>,
  options?: { solarRadToGw?: number },
): HourlyForecastPoint[] {
  const solarFactor = options?.solarRadToGw ?? SOLAR_RAD_TO_GW;
  const out: HourlyForecastPoint[] = [];
  for (const r of rows) {
    const w100 = windGwFromMs(r.w100);
    let w10 = windGwFromMs(r.w10);
    if (w100 == null) continue;
    if (w10 == null) w10 = w100;
    const windMin = Math.min(w10, w100);
    const windMax = Math.max(w10, w100);
    const windSpread = windMax - windMin;
    const t = parseISO(r.forecast_time);
    const h = t.getUTCHours();
    const base = demandBaselineGwUtcHour(h);
    const solar = solarGwFromRadiation(r.rad, solarFactor) ?? 0;
    const residual = Math.max(0, base - w100 - solar);
    out.push({
      forecast_time: r.forecast_time,
      windGw100: w100,
      windGw10: w10,
      windMin,
      windMax,
      windSpread,
      tempC: r.temp,
      solarGw: solar > 0 ? solar : null,
      residualGw: residual,
      ts: t.getTime(),
    });
  }
  return out;
}

/** End index of a 3-hour window (hourly steps i → i+2) with |ΔGW| > threshold */
export function findRampIndices(windGw100: number[]): number[] {
  const idx: number[] = [];
  for (let i = 0; i + 2 < windGw100.length; i++) {
    const d = Math.abs(windGw100[i + 2]! - windGw100[i]!);
    if (d > RAMP_THRESHOLD_GW) idx.push(i + 2);
  }
  return idx;
}

export function droughtPct(points: { windGw100: number }[]): number {
  if (points.length === 0) return 0;
  const low = points.filter((p) => p.windGw100 < WIND_DROUGHT_GW).length;
  return (low / points.length) * 100;
}

export function groupByUtcDay(
  points: HourlyForecastPoint[],
): Map<string, HourlyForecastPoint[]> {
  const m = new Map<string, HourlyForecastPoint[]>();
  for (const p of points) {
    const dayKey = format(parseISO(p.forecast_time), "yyyy-MM-dd");
    const list = m.get(dayKey) ?? [];
    list.push(p);
    m.set(dayKey, list);
  }
  return m;
}

export function formatDayLabel(iso: string): string {
  try {
    return format(parseISO(iso), "EEE");
  } catch {
    return "";
  }
}

/** HDD contribution for one day: max(0, 15.5 - daily_avg_c) */
export function heatingDegreeDayContribution(avgTempC: number): number {
  return Math.max(0, 15.5 - avgTempC);
}
