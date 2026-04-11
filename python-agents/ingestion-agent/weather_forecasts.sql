-- Run in Supabase SQL editor (or migration) before enabling weather ingestion.
-- PostgREST upsert uses ON CONFLICT on (forecast_time, location).

CREATE TABLE IF NOT EXISTS public.weather_forecasts (
  forecast_time timestamptz NOT NULL,
  location text NOT NULL,
  wind_speed_10m numeric,
  wind_speed_100m numeric,
  temperature_2m numeric,
  solar_radiation numeric,
  source text NOT NULL,
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (forecast_time, location)
);

COMMENT ON TABLE public.weather_forecasts IS
  'Open-Meteo ECMWF hourly fields; upserted by python-agents/ingestion-agent/main.py';

CREATE INDEX IF NOT EXISTS weather_forecasts_location_fetched_at_idx
  ON public.weather_forecasts (location, fetched_at DESC);

ALTER TABLE public.weather_forecasts ENABLE ROW LEVEL SECURITY;

-- Adjust policies for your app: service role bypasses RLS; anon typically read-only.
-- Example read for authenticated users (optional):
-- CREATE POLICY "Allow read weather_forecasts"
--   ON public.weather_forecasts FOR SELECT TO authenticated USING (true);
