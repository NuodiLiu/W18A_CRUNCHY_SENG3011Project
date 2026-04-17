"""
Insert 2021 ABS General Community Profile (NSW Suburbs and Localities) into events table.

Source: ~/Desktop/raw_housing_data/2021_ABS_General_Community_Profile_-2275541839125683476.csv

Each suburb/locality becomes ONE event:
  event_type  : abs_census_2021
  dataset_id  : abs_2021_import
  time_object : {"timestamp": "2021-08-10T00:00:00Z", "timezone": "Australia/Sydney"}
                (2021 Australian Census night – 10 August 2021)
  attribute   : {
    suburb, sal_code, total_population, total_males, total_females,
    median_age, median_mortgage_monthly, median_rent_weekly,
    median_personal_income_weekly, median_household_income_weekly,
    median_family_income_weekly, avg_household_size, avg_persons_per_bedroom,
    owned_outright, owned_mortgage, rented_total, rented_real_estate,
    rented_housing_authority, total_occupied_dwellings,
    separate_houses, semi_detached, flats_apartments,
    employed_fulltime, employed_parttime, unemployed, labour_force_total,
    labour_force_pct, unemployment_pct,
    indigenous_population, born_australia, born_overseas,
    english_only_speakers, year_12_completions
  }

Phases:
  1. Fetch PG connection string from Lambda env vars (auto)
  2. Idempotency check — skip if already inserted
  3. Batch insert ~15 000 events
  4. Create indexes
  5. Create materialized views

Usage:
    pip3 install psycopg2-binary boto3
    python3 scripts/insert_abs_census.py
"""

import csv
import json
import os
import subprocess
import sys
import uuid

import psycopg2
import psycopg2.extras

# ── Config ────────────────────────────────────────────────────────────────────

CSV_PATH = os.path.expanduser(
    "~/Desktop/raw_housing_data/2021_ABS_General_Community_Profile_-2275541839125683476.csv"
)
LAMBDA_FUNCTION = "eia-dev-api"
AWS_REGION = "ap-southeast-2"
EVENT_TYPE = "abs_census_2021"
DATASET_ID = "abs_2021_import"
CENSUS_TIMESTAMP = "2021-08-10T00:00:00.000Z"
BATCH_SIZE = 500

# ── Helpers ───────────────────────────────────────────────────────────────────

def get_pg_connection_string() -> str:
    """Fetch PG_CONNECTION_STRING from Lambda env vars."""
    try:
        result = subprocess.run(
            [
                "aws", "lambda", "get-function-configuration",
                "--function-name", LAMBDA_FUNCTION,
                "--region", AWS_REGION,
                "--query", "Environment.Variables.PG_CONNECTION_STRING",
                "--output", "text",
            ],
            capture_output=True, text=True, check=True,
        )
        conn_str = result.stdout.strip()
        if not conn_str or conn_str == "None":
            raise ValueError("PG_CONNECTION_STRING not found in Lambda env")
        print(f"[config] PG connection retrieved from Lambda env")
        return conn_str
    except Exception as exc:
        print(f"[error] Could not get PG connection from Lambda: {exc}")
        sys.exit(1)


def to_int(val: str):
    """Convert string to int, returning None for empty/invalid values."""
    val = val.strip()
    if not val:
        return None
    try:
        return int(float(val))
    except ValueError:
        return None


def to_float(val: str):
    """Convert string to float, returning None for empty/invalid values."""
    val = val.strip()
    if not val:
        return None
    try:
        return float(val)
    except ValueError:
        return None


# ── Phase 1: Read CSV ─────────────────────────────────────────────────────────

def build_event_rows():
    """Read the ABS CSV and return a list of (event_id, event_type, dataset_id, time_object, attribute) tuples."""
    rows = []
    skipped = 0

    with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for raw in reader:
            suburb_name = raw.get("Suburbs and Localities Name", "").strip()
            sal_code_raw = raw.get("Suburbs and Localities Code", "").strip()

            # Skip rows without a valid suburb name
            if not suburb_name or not sal_code_raw:
                skipped += 1
                continue

            # Format SAL code as "SAL" + zero-padded 5-digit number
            try:
                sal_code = f"SAL{int(sal_code_raw):05d}"
            except ValueError:
                sal_code = sal_code_raw

            attribute = {
                # Location identifiers
                "suburb":                        suburb_name,
                "sal_code":                      sal_code,

                # Population totals
                "total_population":              to_int(raw.get("Total population", "")),
                "total_males":                   to_int(raw.get("Total number of males", "")),
                "total_females":                 to_int(raw.get("Total number of females", "")),

                # Demographics
                "median_age":                    to_int(raw.get("Median age", "")),
                "indigenous_population":         to_int(raw.get("People of Aboriginal and or Torres Strait Islander descent", "")),
                "born_australia":                to_int(raw.get("People born in Australia", "")),
                "born_overseas":                 to_int(raw.get("People not born in Australia", "")),
                "english_only_speakers":         to_int(raw.get("People who speak English only at home", "")),

                # Income / Housing costs
                "median_mortgage_monthly":       to_int(raw.get("Monthly median mortgage repayment", "")),
                "median_rent_weekly":            to_int(raw.get("Median weekly rent", "")),
                "median_personal_income_weekly": to_int(raw.get("Total personal median weekly income", "")),
                "median_household_income_weekly":to_int(raw.get("Total household median weekly income", "")),
                "median_family_income_weekly":   to_int(raw.get("Total family median weekly income", "")),

                # Household characteristics
                "avg_household_size":            to_float(raw.get("Average household size", "")),
                "avg_persons_per_bedroom":       to_float(raw.get("Average number of people per bedroom", "")),

                # Dwelling tenure
                "owned_outright":                to_int(raw.get("Occupied dwellings owned outright", "")),
                "owned_mortgage":                to_int(raw.get("Occupied dwellings owned with a mortgage", "")),
                "rented_total":                  to_int(raw.get("Total rented dwellings", "")),
                "rented_real_estate":            to_int(raw.get("Dwellings rented through a real estate agent", "")),
                "rented_housing_authority":      to_int(raw.get("Dwellings rented through State/Territory housing authority", "")),
                "total_occupied_dwellings":      to_int(raw.get("Total occupied private dwellings", "")),

                # Dwelling structure
                "separate_houses":               to_int(raw.get("Dwellings that are separate houses", "")),
                "semi_detached":                 to_int(raw.get("Dwellings that are semi-detached or row houses", "")),
                "flats_apartments":              to_int(raw.get("Dwellings that are flats or apartments", "")),

                # Labour force
                "employed_fulltime":             to_int(raw.get("People who worked full time", "")),
                "employed_parttime":             to_int(raw.get("People who worked part time", "")),
                "unemployed":                    to_int(raw.get("Unemployed people looking for work", "")),
                "labour_force_total":            to_int(raw.get("People aged 15 years and over in labour force", "")),
                "labour_force_pct":              to_float(raw.get("Percent of total people in labour force", "")),
                "unemployment_pct":              to_float(raw.get("Percent of unemployed people who are looking for work", "")),

                # Education
                "year_12_completions":           to_int(raw.get("People aged 15+ who completed school year 12", "")),
            }

            # Remove None values to keep attribute JSON compact
            attribute = {k: v for k, v in attribute.items() if v is not None}

            rows.append((
                str(uuid.uuid4()),
                EVENT_TYPE,
                DATASET_ID,
                json.dumps({"timestamp": CENSUS_TIMESTAMP, "timezone": "Australia/Sydney"}),
                json.dumps(attribute),
            ))

    print(f"[build] {len(rows)} event rows built (skipped: {skipped})")
    return rows


# ── Phase 2: Insert ───────────────────────────────────────────────────────────

INSERT_SQL = """
    INSERT INTO events (event_id, event_type, dataset_id, time_object, attribute)
    VALUES %s
    ON CONFLICT (event_id) DO NOTHING
"""


def insert_rows(conn, rows):
    """Bulk insert using execute_values for efficiency."""
    total = len(rows)
    inserted = 0

    with conn.cursor() as cur:
        for start in range(0, total, BATCH_SIZE):
            batch = rows[start : start + BATCH_SIZE]
            psycopg2.extras.execute_values(cur, INSERT_SQL, batch)
            inserted += len(batch)
            print(f"  inserted {inserted}/{total}...", end="\r", flush=True)
        conn.commit()

    print(f"\n[insert] {total} rows committed.")


# ── Phase 3: Indexes ──────────────────────────────────────────────────────────

INDEX_SQL = """
-- Index for event_type filter (all queries)
CREATE INDEX IF NOT EXISTS idx_events_abs_census_event_type
    ON events (event_type)
    WHERE event_type = 'abs_census_2021';

-- Index for suburb ILIKE filter
CREATE INDEX IF NOT EXISTS idx_events_abs_census_suburb
    ON events ((attribute->>'suburb'))
    WHERE event_type = 'abs_census_2021';

-- Index for SAL code exact match
CREATE INDEX IF NOT EXISTS idx_events_abs_census_sal_code
    ON events ((attribute->>'sal_code'))
    WHERE event_type = 'abs_census_2021';
"""


def create_indexes(conn):
    with conn.cursor() as cur:
        for stmt in INDEX_SQL.strip().split(";"):
            stmt = stmt.strip()
            if stmt:
                cur.execute(stmt)
        conn.commit()
    print("[index] Indexes created.")


# ── Phase 4: Materialized Views ───────────────────────────────────────────────

MV_SQL = """
-- MV: key housing + income metrics by suburb (for breakdown visualisation)
DROP MATERIALIZED VIEW IF EXISTS mv_abs_census_suburb_housing;
CREATE MATERIALIZED VIEW mv_abs_census_suburb_housing AS
SELECT
    attribute->>'suburb'                                    AS suburb,
    attribute->>'sal_code'                                  AS sal_code,
    (attribute->>'total_population')::int                   AS total_population,
    (attribute->>'median_age')::int                         AS median_age,
    (attribute->>'median_mortgage_monthly')::int            AS median_mortgage_monthly,
    (attribute->>'median_rent_weekly')::int                 AS median_rent_weekly,
    (attribute->>'median_personal_income_weekly')::int      AS median_personal_income_weekly,
    (attribute->>'median_household_income_weekly')::int     AS median_household_income_weekly,
    (attribute->>'owned_outright')::int                     AS owned_outright,
    (attribute->>'owned_mortgage')::int                     AS owned_mortgage,
    (attribute->>'rented_total')::int                       AS rented_total,
    (attribute->>'separate_houses')::int                    AS separate_houses,
    (attribute->>'flats_apartments')::int                   AS flats_apartments,
    (attribute->>'labour_force_pct')::numeric               AS labour_force_pct,
    (attribute->>'unemployment_pct')::numeric               AS unemployment_pct
FROM events
WHERE event_type = 'abs_census_2021';

CREATE UNIQUE INDEX mv_abs_census_suburb_housing_pk
    ON mv_abs_census_suburb_housing (sal_code);

CREATE INDEX mv_abs_census_suburb_housing_suburb_idx
    ON mv_abs_census_suburb_housing (suburb);
"""


def create_materialized_views(conn):
    with conn.cursor() as cur:
        cur.execute(MV_SQL)
        conn.commit()
    print("[mv] Materialized view mv_abs_census_suburb_housing created.")


# ── Idempotency Check ─────────────────────────────────────────────────────────

def already_inserted(conn) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM events WHERE event_type = %s AND dataset_id = %s",
            (EVENT_TYPE, DATASET_ID),
        )
        count = cur.fetchone()[0]
    if count > 0:
        print(f"[skip] {count} events of type '{EVENT_TYPE}' already exist — skipping insert.")
        return True
    return False


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("ABS 2021 Census Community Profile — NSW ingestion")
    print("=" * 60)

    conn_str = get_pg_connection_string()
    conn = psycopg2.connect(conn_str)

    try:
        if not already_inserted(conn):
            rows = build_event_rows()
            print(f"[insert] Inserting {len(rows)} events in batches of {BATCH_SIZE}...")
            insert_rows(conn, rows)
        else:
            print("[info] Skipping data insert (already exists).")

        print("[index] Creating indexes...")
        create_indexes(conn)

        print("[mv] Creating materialized views...")
        create_materialized_views(conn)

        print("\n[done] ABS Census ingestion complete.")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
