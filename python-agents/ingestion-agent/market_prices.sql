-- Run in Supabase SQL editor (or migration) before enabling N2EX MID ingestion.
-- PostgREST upsert uses ON CONFLICT on (price_date, settlement_period, market).

CREATE TABLE IF NOT EXISTS public.market_prices (
  price_date date NOT NULL,
  settlement_period integer NOT NULL,
  price_gbp_mwh numeric NOT NULL,
  market text NOT NULL DEFAULT 'N2EX',
  source text NOT NULL DEFAULT 'Elexon BMRS MID',
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (price_date, settlement_period, market)
);

COMMENT ON TABLE public.market_prices IS
  'Elexon BMRS MID (N2EX); upserted by python-agents/ingestion-agent/main.py';

CREATE INDEX IF NOT EXISTS market_prices_market_price_date_idx
  ON public.market_prices (market, price_date DESC);

ALTER TABLE public.market_prices ENABLE ROW LEVEL SECURITY;

-- Read-only for anonymous clients (adjust if you use only authenticated JWT).
CREATE POLICY "Allow anon read market_prices"
  ON public.market_prices
  FOR SELECT
  TO anon
  USING (true);

GRANT SELECT ON public.market_prices TO anon;
