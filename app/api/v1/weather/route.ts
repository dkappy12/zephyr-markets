import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api/require-api-key";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  demandBaselineGwUtcHour,
  solarGwFromRadiation,
  windGwFromMs,
} from "@/lib/weather-intelligence";

function toIsoString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export async function GET(request: Request) {
  try {
    const auth = await requireApiKey(request);
    if (auth.response) return auth.response;

    const url = new URL(request.url);
    const rawHours = url.searchParams.get("hours");
    let hours = 48;
    if (rawHours !== null && rawHours !== "") {
      const n = Number.parseInt(rawHours, 10);
      if (Number.isFinite(n)) {
        hours = Math.min(168, Math.max(1, n));
      }
    }

    const admin = createAdminClient();
    const nowIso = new Date().toISOString();
    const { data: rows, error } = await admin
      .from("weather_forecasts")
      .select(
        "forecast_time, wind_speed_10m, wind_speed_100m, temperature_2m, solar_radiation, source",
      )
      .eq("location", "GB")
      .gte("forecast_time", nowIso)
      .order("forecast_time", { ascending: true })
      .limit(hours);

    if (error) {
      throw new Error(error.message);
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { error: "No forecast data available" },
        { status: 404 },
      );
    }

    const data = rows.map((row) => {
      const r = row as Record<string, unknown>;
      const forecastTime = toIsoString(r.forecast_time);

      const w100Raw = r.wind_speed_100m;
      const w10Raw = r.wind_speed_10m;
      const w100 =
        typeof w100Raw === "number" && Number.isFinite(w100Raw)
          ? w100Raw
          : w100Raw != null
            ? Number(w100Raw)
            : NaN;
      const w10 =
        typeof w10Raw === "number" && Number.isFinite(w10Raw)
          ? w10Raw
          : w10Raw != null
            ? Number(w10Raw)
            : NaN;

      const radRaw = r.solar_radiation;
      const tempRaw = r.temperature_2m;

      const wind_implied_gw = windGwFromMs(Number.isFinite(w100) ? w100 : null);
      const solar_implied_gw = solarGwFromRadiation(
        typeof radRaw === "number" && Number.isFinite(radRaw)
          ? radRaw
          : radRaw != null
            ? Number(radRaw)
            : null,
      );

      const utcHour = new Date(forecastTime).getUTCHours();
      const demand_baseline = demandBaselineGwUtcHour(utcHour);
      const residual_demand_gw = Math.max(
        0,
        demand_baseline -
          (wind_implied_gw ?? 0) -
          (solar_implied_gw ?? 0),
      );

      const wind_speed_100m_ms = Number.isFinite(w100) ? w100 : 0;
      const wind_speed_10m_ms = Number.isFinite(w10) ? w10 : 0;
      const wind_implied_gw_out = wind_implied_gw ?? 0;
      const solar_radiation_wm2 =
        typeof radRaw === "number" && Number.isFinite(radRaw)
          ? radRaw
          : radRaw != null && Number.isFinite(Number(radRaw))
            ? Number(radRaw)
            : 0;
      const solar_implied_gw_out = solar_implied_gw ?? 0;
      const temperature_c =
        typeof tempRaw === "number" && Number.isFinite(tempRaw)
          ? tempRaw
          : tempRaw != null && Number.isFinite(Number(tempRaw))
            ? Number(tempRaw)
            : 0;

      return {
        forecast_time: forecastTime,
        wind_speed_100m_ms: Number(wind_speed_100m_ms.toFixed(2)),
        wind_speed_10m_ms: Number(wind_speed_10m_ms.toFixed(2)),
        wind_implied_gw: Number(wind_implied_gw_out.toFixed(2)),
        solar_radiation_wm2: Number(solar_radiation_wm2.toFixed(2)),
        solar_implied_gw: Number(solar_implied_gw_out.toFixed(2)),
        temperature_c: Number(temperature_c.toFixed(2)),
        residual_demand_gw: Number(residual_demand_gw.toFixed(2)),
      };
    });

    return NextResponse.json({
      data,
      meta: {
        source: "Open-Meteo ECMWF",
        hours,
        generated_at: new Date().toISOString(),
        endpoint: "/api/v1/weather",
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load weather data" },
      { status: 500 },
    );
  }
}
