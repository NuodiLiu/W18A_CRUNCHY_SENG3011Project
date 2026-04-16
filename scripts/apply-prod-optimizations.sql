-- Visualization API optimization: expression indexes + materialized views
-- Run against production DB:
--   PGPASSWORD='...' psql "host=eia-dev-events-db.cpa4ki406ri8.ap-southeast-2.rds.amazonaws.com port=5432 dbname=events user=postgres sslmode=require" -f scripts/apply-prod-optimizations.sql

-- ── 1. Expression indexes (CONCURRENTLY = no table lock) ────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_purchase_price
  ON events (((attribute->>'purchase_price')::numeric))
  WHERE event_type = 'housing_sale';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_timestamp
  ON events (((time_object->>'timestamp')::timestamp));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_suburb_price
  ON events ((attribute->>'suburb'), ((attribute->>'purchase_price')::numeric))
  WHERE event_type = 'housing_sale';

-- ── 2. Materialized views ───────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_housing_suburb_stats AS
SELECT
  attribute->>'suburb' AS suburb,
  COUNT(*)::bigint AS cnt,
  SUM((attribute->>'purchase_price')::numeric) AS sum_price,
  AVG((attribute->>'purchase_price')::numeric) AS avg_price,
  MIN((attribute->>'purchase_price')::numeric) AS min_price,
  MAX((attribute->>'purchase_price')::numeric) AS max_price,
  SUM((attribute->>'area')::numeric) AS sum_area,
  AVG((attribute->>'area')::numeric) AS avg_area,
  MIN((attribute->>'area')::numeric) AS min_area,
  MAX((attribute->>'area')::numeric) AS max_area
FROM events
WHERE event_type = 'housing_sale'
GROUP BY attribute->>'suburb';

CREATE UNIQUE INDEX IF NOT EXISTS mv_housing_suburb_stats_pk
  ON mv_housing_suburb_stats (suburb);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_housing_yearly_stats AS
SELECT
  EXTRACT(YEAR FROM (time_object->>'timestamp')::timestamp)::int AS year,
  COUNT(*)::bigint AS cnt,
  SUM((attribute->>'purchase_price')::numeric) AS sum_price,
  AVG((attribute->>'purchase_price')::numeric) AS avg_price,
  MIN((attribute->>'purchase_price')::numeric) AS min_price,
  MAX((attribute->>'purchase_price')::numeric) AS max_price,
  SUM((attribute->>'area')::numeric) AS sum_area,
  AVG((attribute->>'area')::numeric) AS avg_area,
  MIN((attribute->>'area')::numeric) AS min_area,
  MAX((attribute->>'area')::numeric) AS max_area
FROM events
WHERE event_type = 'housing_sale'
GROUP BY year;

CREATE UNIQUE INDEX IF NOT EXISTS mv_housing_yearly_stats_pk
  ON mv_housing_yearly_stats (year);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_housing_yearly_suburb AS
SELECT
  EXTRACT(YEAR FROM (time_object->>'timestamp')::timestamp)::int AS year,
  attribute->>'suburb' AS suburb,
  COUNT(*)::bigint AS cnt,
  SUM((attribute->>'purchase_price')::numeric) AS sum_price,
  AVG((attribute->>'purchase_price')::numeric) AS avg_price,
  MIN((attribute->>'purchase_price')::numeric) AS min_price,
  MAX((attribute->>'purchase_price')::numeric) AS max_price,
  SUM((attribute->>'area')::numeric) AS sum_area,
  AVG((attribute->>'area')::numeric) AS avg_area,
  MIN((attribute->>'area')::numeric) AS min_area,
  MAX((attribute->>'area')::numeric) AS max_area
FROM events
WHERE event_type = 'housing_sale'
GROUP BY year, attribute->>'suburb';

CREATE UNIQUE INDEX IF NOT EXISTS mv_housing_yearly_suburb_pk
  ON mv_housing_yearly_suburb (year, suburb);

-- ── Done ────────────────────────────────────────────────────────
\echo '✔ All indexes and materialized views created.'
