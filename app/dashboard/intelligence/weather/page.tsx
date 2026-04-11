"use client";

import { WindRose } from "@/components/ui/WindRose";
import { createBrowserClient } from "@/lib/supabase/client";
import { format, parseISO } from "date-fns";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const MS_TO_GW = 17 / 8;
const BULL_GREEN = "#1D6B4E";
const INK_MID = "#6b6760";

type ForecastRow = {
  forecast_time: string;
  wind_speed_100m: number | null;
  temperature_2m: number | null;
};

type ChartPoint = ForecastRow & { idx: number };

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function WeatherPage() {
  const [rows, setRows] = useState<ForecastRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();
    const from = new Date().toISOString();

    async function load() {
      setLoadError(null);
      const { data, error } = await supabase
        .from("weather_forecasts")
        .select("forecast_time, wind_speed_100m, temperature_2m")
        .eq("location", "GB")
        .gte("forecast_time", from)
        .order("forecast_time", { ascending: true })
        .limit(168);

      if (error) {
        setLoadError(error.message);
        setRows([]);
        return;
      }
      const parsed: ForecastRow[] = (data ?? []).map((r: Record<string, unknown>) => ({
        forecast_time: String(r.forecast_time),
        wind_speed_100m: num(r.wind_speed_100m),
        temperature_2m: num(r.temperature_2m),
      }));
      setRows(parsed);
    }

    load();
  }, []);

  const chartData: ChartPoint[] = useMemo(
    () => rows.map((r, idx) => ({ ...r, idx })),
    [rows],
  );

  const midnightTicks = useMemo(() => {
    const ticks: string[] = [];
    for (const r of rows) {
      const d = parseISO(r.forecast_time);
      if (d.getUTCHours() === 0) {
        ticks.push(r.forecast_time);
      }
    }
    return ticks;
  }, [rows]);

  const summary = useMemo(() => {
    if (!rows.length) {
      return { windMin: null as number | null, windMax: null as number | null, temp: null as number | null };
    }
    const winds = rows
      .map((r) => r.wind_speed_100m)
      .filter((w): w is number => w != null && Number.isFinite(w));
    const windMin = winds.length ? Math.min(...winds) : null;
    const windMax = winds.length ? Math.max(...winds) : null;

    const now = Date.now();
    let closest = rows[0];
    let best = Infinity;
    for (const r of rows) {
      const t = parseISO(r.forecast_time).getTime();
      const d = Math.abs(t - now);
      if (d < best) {
        best = d;
        closest = r;
      }
    }
    const temp = closest?.temperature_2m ?? null;

    return { windMin, windMax, temp };
  }, [rows]);

  const windSurprise = useMemo(() => {
    if (rows.length < 2) return null;
    const winds = rows
      .map((r) => r.wind_speed_100m)
      .filter((w): w is number => w != null && Number.isFinite(w));
    if (winds.length < 2) return null;
    const avg = winds.reduce((a, b) => a + b, 0) / winds.length;

    const now = Date.now();
    let closestMs: number | null = null;
    let best = Infinity;
    for (const r of rows) {
      const w = r.wind_speed_100m;
      if (w == null || !Number.isFinite(w)) continue;
      const t = parseISO(r.forecast_time).getTime();
      const d = Math.abs(t - now);
      if (d < best) {
        best = d;
        closestMs = w;
      }
    }
    if (closestMs == null) return null;
    return (closestMs - avg) * MS_TO_GW;
  }, [rows]);

  const formatXTick = (iso: string) => {
    try {
      return format(parseISO(iso), "EEE");
    } catch {
      return "";
    }
  };

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
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">
          Ensemble wind, temperature, and precipitation drivers with error
          bands tied to your GB and NW Europe power exposures.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="relative min-h-[380px] rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 pb-4 pt-12"
        >
          <div className="absolute right-4 top-4">
            <WindRose size={96} />
          </div>
          <div className="absolute left-4 top-4 max-w-[calc(100%-7rem)]">
            <span className="font-sans text-[9px] font-medium uppercase tracking-[0.14em] text-ink-light">
              Wind forecast
            </span>
            {loadError ? (
              <p className="mt-1 text-xs text-bear">{loadError}</p>
            ) : (
              <p className="mt-1 text-sm text-ink">
                {summary.windMin != null &&
                summary.windMax != null &&
                summary.temp != null ? (
                  <>
                    7-day wind range: {summary.windMin.toFixed(1)}–
                    {summary.windMax.toFixed(1)} m/s | Current temp:{" "}
                    {summary.temp.toFixed(0)}°C
                  </>
                ) : rows.length === 0 ? (
                  <span className="text-ink-mid">No forecast rows yet.</span>
                ) : (
                  <span className="text-ink-mid">—</span>
                )}
              </p>
            )}
          </div>

          <div className="mt-20 h-[280px] w-full">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#d9d2c4" />
                  <XAxis
                    dataKey="forecast_time"
                    ticks={midnightTicks.length ? midnightTicks : undefined}
                    tickFormatter={formatXTick}
                    stroke={INK_MID}
                    tick={{ fill: INK_MID, fontSize: 10 }}
                    interval={0}
                  />
                  <YAxis
                    yAxisId="wind"
                    stroke={BULL_GREEN}
                    tick={{ fill: BULL_GREEN, fontSize: 10 }}
                    width={40}
                    label={{
                      value: "m/s",
                      angle: -90,
                      position: "insideLeft",
                      fill: BULL_GREEN,
                      fontSize: 10,
                    }}
                  />
                  <YAxis
                    yAxisId="temp"
                    orientation="right"
                    stroke={INK_MID}
                    tick={{ fill: INK_MID, fontSize: 10 }}
                    width={40}
                    label={{
                      value: "°C",
                      angle: 90,
                      position: "insideRight",
                      fill: INK_MID,
                      fontSize: 10,
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#fdfbf7",
                      border: "0.5px solid #d9d2c4",
                      borderRadius: 4,
                      fontSize: 11,
                    }}
                    labelFormatter={(iso) => {
                      try {
                        return format(parseISO(String(iso)), "EEE d MMM HH:mm");
                      } catch {
                        return String(iso);
                      }
                    }}
                  />
                  <Bar
                    yAxisId="wind"
                    dataKey="wind_speed_100m"
                    fill={BULL_GREEN}
                    name="Wind 100 m"
                    maxBarSize={6}
                  />
                  <Line
                    yAxisId="temp"
                    type="monotone"
                    dataKey="temperature_2m"
                    stroke={INK_MID}
                    strokeWidth={1.5}
                    dot={false}
                    name="Temp"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-ink-mid">
                Chart loads when hourly forecasts are available.
              </div>
            )}
          </div>
        </motion.div>
        <aside className="space-y-3">
          <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-dark px-4 py-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Wind surprise (7d)
            </p>
            <p className="mt-2 font-serif text-3xl text-ink">
              {windSurprise === null ? (
                "—"
              ) : (
                <>
                  {windSurprise >= 0 ? "+" : ""}
                  {windSurprise.toFixed(1)} GW
                </>
              )}
            </p>
            <p className="mt-1 text-xs text-ink-mid">
              Current 100 m wind vs 7-day mean (implied GW).
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
