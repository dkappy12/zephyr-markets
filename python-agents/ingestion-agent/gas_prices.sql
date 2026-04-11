-- Run in Supabase SQL editor (or migration) before enabling EEX TTF NGP ingestion.
-- PostgREST upsert uses ON CONFLICT on (price_time, hub).

CREATE TABLE IF NOT EXISTS public.gas_prices (
  price_time timestamptz NOT NULL,
  hub text NOT NULL,
  price_eur_mwh numeric NOT NULL,
  source text NOT NULL DEFAULT 'EEX NGP',
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (price_time, hub)
);

COMMENT ON TABLE public.gas_prices IS
  'EEX NGP gas hub prices; upserted by python-agents/ingestion-agent/main.py';

CREATE INDEX IF NOT EXISTS gas_prices_hub_price_time_idx
  ON public.gas_prices (hub, price_time DESC);

ALTER TABLE public.gas_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read gas_prices"
  ON public.gas_prices
  FOR SELECT
  TO anon
  USING (true);

GRANT SELECT ON public.gas_prices TO anon;
