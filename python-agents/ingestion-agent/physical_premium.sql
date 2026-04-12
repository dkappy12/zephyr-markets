-- Run in Supabase SQL editor (or migration) before enabling physical premium snapshots.
-- Each run INSERTs a new row (history); no upsert.

CREATE TABLE IF NOT EXISTS public.physical_premium (
  id bigserial PRIMARY KEY,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  implied_price_gbp_mwh numeric,
  market_price_gbp_mwh numeric,
  premium_value numeric,
  normalised_score numeric,
  direction text,
  confidence text,
  wind_gw numeric,
  solar_gw numeric,
  residual_demand_gw numeric,
  ttf_eur_mwh numeric,
  srmc_gbp_mwh numeric,
  remit_mw_lost numeric,
  regime text,
  source text NOT NULL DEFAULT 'Zephyr Physical Model v1'
);

-- If you created physical_premium before regime existed:
-- ALTER TABLE public.physical_premium ADD COLUMN IF NOT EXISTS regime text;

COMMENT ON TABLE public.physical_premium IS
  'CCGT-anchored SRMC physical premium; inserted by python-agents/ingestion-agent/main.py';

CREATE INDEX IF NOT EXISTS physical_premium_calculated_at_idx
  ON public.physical_premium (calculated_at DESC);

ALTER TABLE public.physical_premium ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read physical_premium"
  ON public.physical_premium
  FOR SELECT
  TO anon
  USING (true);

-- Logged-in dashboard users use the authenticated role (JWT), not anon.
CREATE POLICY "Allow authenticated read physical_premium"
  ON public.physical_premium
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.physical_premium TO anon;
GRANT SELECT ON public.physical_premium TO authenticated;

-- Existing deployments: add regime column if missing.
ALTER TABLE public.physical_premium ADD COLUMN IF NOT EXISTS regime text;

-- Planned vs unplanned REMIT capacity (MW) for dashboard copy; run in Supabase if missing.
ALTER TABLE public.physical_premium ADD COLUMN IF NOT EXISTS remit_planned_mw numeric;
ALTER TABLE public.physical_premium ADD COLUMN IF NOT EXISTS remit_unplanned_mw numeric;
