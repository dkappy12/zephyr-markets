-- Run in Supabase SQL editor (or migration) before enabling GIE AGSI storage ingestion.
-- PostgREST upsert uses ON CONFLICT on (report_date, location).

CREATE TABLE IF NOT EXISTS public.storage_levels (
  report_date date NOT NULL,
  location text NOT NULL,
  full_pct numeric,
  working_volume_twh numeric,
  injection_twh numeric,
  withdrawal_twh numeric,
  source text NOT NULL,
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (report_date, location)
);

COMMENT ON TABLE public.storage_levels IS
  'GIE AGSI gas storage levels; upserted by python-agents/ingestion-agent/main.py';

CREATE INDEX IF NOT EXISTS storage_levels_location_fetched_at_idx
  ON public.storage_levels (location, fetched_at DESC);

ALTER TABLE public.storage_levels ENABLE ROW LEVEL SECURITY;
