-- Run in Supabase SQL editor before enabling daily FX ingestion.
-- One row per day and currency pair (EUR/GBP for now).

CREATE TABLE IF NOT EXISTS public.fx_rates (
  rate_date date NOT NULL,
  base text NOT NULL,
  quote text NOT NULL,
  rate numeric NOT NULL,
  source text NOT NULL DEFAULT 'Frankfurter ECB',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_date, base, quote)
);

COMMENT ON TABLE public.fx_rates IS
  'Daily FX history for deterministic historical conversions (ingested by python-agents/ingestion-agent/main.py).';

CREATE INDEX IF NOT EXISTS fx_rates_pair_date_idx
  ON public.fx_rates (base, quote, rate_date DESC);

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read fx_rates"
  ON public.fx_rates
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow authenticated read fx_rates"
  ON public.fx_rates
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.fx_rates TO anon;
GRANT SELECT ON public.fx_rates TO authenticated;
