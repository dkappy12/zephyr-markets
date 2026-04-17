-- Daily EUA (€/t, £/t) and derived UKA (£/t) for SRMC and dashboards.
CREATE TABLE IF NOT EXISTS public.carbon_prices (
  price_date date NOT NULL,
  hub text NOT NULL,
  price_gbp_per_t numeric,
  price_eur_per_t numeric,
  source text,
  fetched_at timestamptz,
  PRIMARY KEY (price_date, hub)
);

INSERT INTO ops.pipeline_health (
  feed_id,
  feed_name,
  category,
  expected_cadence_seconds,
  threshold_stale_seconds,
  threshold_critical_seconds
)
VALUES (
  'carbon_eua_uka',
  'Carbon EUA/UKA',
  'market',
  3600,
  7200,
  86400
)
ON CONFLICT (feed_id) DO NOTHING;
