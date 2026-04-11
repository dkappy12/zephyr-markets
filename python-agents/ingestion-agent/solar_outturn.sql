-- Run in Supabase SQL editor (or migration) before enabling PV_Live solar ingestion.
-- PostgREST upsert uses ON CONFLICT on (datetime_gmt).

CREATE TABLE IF NOT EXISTS public.solar_outturn (
  datetime_gmt timestamptz NOT NULL,
  solar_mw numeric NOT NULL,
  source text NOT NULL DEFAULT 'Sheffield Solar PV_Live',
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (datetime_gmt)
);

COMMENT ON TABLE public.solar_outturn IS
  'Sheffield Solar PV_Live GB outturn; upserted by python-agents/ingestion-agent/main.py';

CREATE INDEX IF NOT EXISTS solar_outturn_datetime_gmt_idx
  ON public.solar_outturn (datetime_gmt DESC);

ALTER TABLE public.solar_outturn ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read solar_outturn"
  ON public.solar_outturn
  FOR SELECT
  TO anon
  USING (true);

GRANT SELECT ON public.solar_outturn TO anon;
