#!/usr/bin/env python3
"""
Insert NSW Weather Trends monthly data into PostgreSQL.

Data lake mapping
─────────────────
Source file : ~/Desktop/raw_housing_data/nsw_weather_trends.csv
Columns     : avg_temp, avg_rainfall, date (YYYY-MM), lga, suburb

event_type  = nsw_weather          ← unique; no collision with existing types
dataset_id  = nsw_weather_import
time_object = { timezone: "UTC",
                timestamp: "<YYYY-MM-01>T00:00:00Z" }   ← first day of month
attribute   = { suburb, lga, avg_temp, avg_rainfall, month }

Existing event_types for reference:
  housing_sale, nsw_crime, distinguished_achiever, abs_census_2021,
  school_enrolment, nsw_population, transport_facility, shopping_centre,
  aus_gdp, gdp, population, aus_population

Indexes created (partial, WHERE event_type = 'nsw_weather'):
  idx_events_nsw_weather_type     – fast full-table scan by type
  idx_events_nsw_weather_suburb   – filter/group by suburb
  idx_events_nsw_weather_lga      – filter/group by LGA
  idx_events_nsw_weather_ts       – time-range queries via time_object timestamp

Materialised view created:
  mv_weather_suburb_yearly_avg    – yearly avg temp & rainfall per suburb

Idempotent: deletes existing nsw_weather rows before inserting.
"""

import json
import subprocess
import sys
import uuid
from pathlib import Path

import pandas as pd
import psycopg2
import psycopg2.extras

# ── Config ────────────────────────────────────────────────────────────────────

CSV_PATH   = Path.home() / "Desktop" / "raw_housing_data" / "nsw_weather_trends.csv"
EVENT_TYPE = "nsw_weather"
DATASET_ID = "nsw_weather_import"


def get_pg_conn_string() -> str:
    result = subprocess.run(
        [
            "aws", "lambda", "get-function-configuration",
            "--function-name", "eia-dev-api",
            "--region", "ap-southeast-2",
            "--query", "Environment.Variables.PG_CONNECTION_STRING",
            "--output", "text",
        ],
        capture_output=True, text=True, check=True,
    )
    conn_str = result.stdout.strip()
    if not conn_str or conn_str == "None":
        raise RuntimeError("PG_CONNECTION_STRING not found in Lambda environment")
    return conn_str


def build_events(df: pd.DataFrame) -> list[dict]:
    """
    Map each CSV row to an event dict.
    date column is YYYY-MM  →  timestamp = YYYY-MM-01T00:00:00Z
    """
    events = []
    for _, row in df.iterrows():
        month_str = str(row["date"]).strip()           # e.g. "2021-04"
        timestamp = f"{month_str}-01T00:00:00Z"

        events.append({
            "event_id":   str(uuid.uuid4()),
            "event_type": EVENT_TYPE,
            "dataset_id": DATASET_ID,
            "time_object": {"timezone": "UTC", "timestamp": timestamp},
            "attribute": {
                "suburb":       str(row["suburb"]).strip(),
                "lga":          str(row["lga"]).strip(),
                "avg_temp":     float(row["avg_temp"]),
                "avg_rainfall": float(row["avg_rainfall"]),
                "month":        month_str,
            },
        })
    return events


def insert_events(cur, events: list[dict]) -> None:
    psycopg2.extras.execute_values(
        cur,
        """
        INSERT INTO events (event_id, event_type, dataset_id, time_object, attribute)
        VALUES %s
        """,
        [
            (
                e["event_id"],
                e["event_type"],
                e["dataset_id"],
                json.dumps(e["time_object"]),
                json.dumps(e["attribute"]),
            )
            for e in events
        ],
        page_size=500,
    )


def create_indexes(cur) -> None:
    stmts = [
        # Fast lookup by event type
        "CREATE INDEX IF NOT EXISTS idx_events_nsw_weather_type "
        "ON events (event_type) WHERE event_type = 'nsw_weather'",

        # Filter / group by suburb
        "CREATE INDEX IF NOT EXISTS idx_events_nsw_weather_suburb "
        "ON events ((attribute->>'suburb')) WHERE event_type = 'nsw_weather'",

        # Filter / group by LGA
        "CREATE INDEX IF NOT EXISTS idx_events_nsw_weather_lga "
        "ON events ((attribute->>'lga')) WHERE event_type = 'nsw_weather'",

        # Time-range queries using time_object->>'timestamp'
        "CREATE INDEX IF NOT EXISTS idx_events_nsw_weather_ts "
        "ON events ((time_object->>'timestamp')) WHERE event_type = 'nsw_weather'",
    ]
    for stmt in stmts:
        print(f"  INDEX: {stmt[50:100]}...")
        cur.execute(stmt)


def create_mvs(cur) -> None:
    # Drop old version if the schema changed
    cur.execute("DROP MATERIALIZED VIEW IF EXISTS mv_weather_suburb_yearly_avg")

    cur.execute("""
        CREATE MATERIALIZED VIEW mv_weather_suburb_yearly_avg AS
        SELECT
            attribute->>'suburb'                            AS suburb,
            attribute->>'lga'                               AS lga,
            LEFT(time_object->>'timestamp', 4)              AS year,
            ROUND(AVG((attribute->>'avg_temp'    )::float)::numeric, 2) AS avg_temp,
            ROUND(AVG((attribute->>'avg_rainfall')::float)::numeric, 2) AS avg_rainfall,
            COUNT(*)                                        AS month_count
        FROM events
        WHERE event_type = 'nsw_weather'
        GROUP BY suburb, lga, year
        ORDER BY suburb, year
    """)
    print("  MV: mv_weather_suburb_yearly_avg created")

    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_mv_weather_suburb
        ON mv_weather_suburb_yearly_avg (suburb)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_mv_weather_lga
        ON mv_weather_suburb_yearly_avg (lga)
    """)
    print("  MV indexes created")


def main() -> None:
    print("Reading CSV...")
    df = pd.read_csv(CSV_PATH)
    print(f"  {len(df)} rows  |  {df['suburb'].nunique()} suburbs  "
          f"|  date range {df['date'].min()} → {df['date'].max()}")

    print("Fetching DB connection string from Lambda...")
    conn_str = get_pg_conn_string()
    print(f"  {conn_str[:55]}...")

    conn = psycopg2.connect(conn_str)
    conn.autocommit = False

    try:
        print("Building events...")
        events = build_events(df)
        print(f"  {len(events)} events ready")

        with conn.cursor() as cur:
            cur.execute("DELETE FROM events WHERE event_type = %s", (EVENT_TYPE,))
            print(f"  Deleted {cur.rowcount} existing '{EVENT_TYPE}' rows")

            print("Inserting events...")
            insert_events(cur, events)
            print(f"  Inserted {len(events)} events")

            print("Creating indexes...")
            create_indexes(cur)

            print("Creating materialised views...")
            create_mvs(cur)

        conn.commit()
        print(f"\nDone!  {len(events)} nsw_weather events committed.")

    except Exception as exc:
        conn.rollback()
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
