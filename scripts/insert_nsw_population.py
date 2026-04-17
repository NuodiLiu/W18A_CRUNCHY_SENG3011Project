#!/usr/bin/env python3
"""
Insert 2011 and 2016 NSW suburb-level population demographic data into PostgreSQL.

Each row from the Excel files becomes an event with:
  event_type = nsw_population_2011 | nsw_population_2016
  dataset_id = nsw_population_import
  time_object.timestamp = Census night (2011-08-09 / 2016-08-09)
  attribute = { suburb, lga, category, sub_category, suburb_code, males, females, persons }

Idempotent: deletes existing nsw_population_2011 / nsw_population_2016 rows before inserting.
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

EXCEL_2016 = Path.home() / "Desktop" / "raw_housing_data" / "2016 population data.xlsx"
EXCEL_2011 = Path.home() / "Desktop" / "raw_housing_data" / "2011 population data.xlsx"

EVENT_TYPE = "nsw_population"
DATASET_ID = "nsw_population_import"
TIMESTAMP_2016 = "2016-08-09T00:00:00Z"
TIMESTAMP_2011 = "2011-08-09T00:00:00Z"


def get_pg_conn_string() -> str:
    result = subprocess.run(
        [
            "aws",
            "lambda",
            "get-function-configuration",
            "--function-name",
            "eia-dev-api",
            "--region",
            "ap-southeast-2",
            "--query",
            "Environment.Variables.PG_CONNECTION_STRING",
            "--output",
            "text",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    conn_str = result.stdout.strip()
    if not conn_str or conn_str == "None":
        raise RuntimeError("PG_CONNECTION_STRING not found in Lambda environment")
    return conn_str


def safe_int(val) -> int | None:
    try:
        if pd.isna(val):
            return None
        return int(val)
    except (ValueError, TypeError):
        return None


def build_events(df: pd.DataFrame, event_type: str, timestamp: str) -> list[dict]:
    events = []
    for _, row in df.iterrows():
        suburb = str(row.get("Suburb", "")).strip() if pd.notna(row.get("Suburb")) else None
        lga = str(row.get("Official Name Local Government Area", "")).strip() if pd.notna(row.get("Official Name Local Government Area")) else None
        category = str(row.get("Category", "")).strip() if pd.notna(row.get("Category")) else None
        sub_category = str(row.get("Sub-category", "")).strip() if pd.notna(row.get("Sub-category")) else None
        suburb_code = str(row.get("Official Code Suburb", "")).strip() if pd.notna(row.get("Official Code Suburb")) else None

        males = safe_int(row.get("Males"))
        females = safe_int(row.get("Females"))
        persons = safe_int(row.get("Persons"))

        event = {
            "event_id": str(uuid.uuid4()),
            "event_type": event_type,
            "dataset_id": DATASET_ID,
            "time_object": {"timezone": "UTC", "timestamp": timestamp},
            "attribute": {
                "suburb": suburb,
                "lga": lga,
                "category": category,
                "sub_category": sub_category,
                "suburb_code": suburb_code,
                "males": males,
                "females": females,
                "persons": persons,
            },
        }
        events.append(event)
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
    statements = [
        "CREATE INDEX IF NOT EXISTS idx_events_nsw_pop_type ON events (event_type) WHERE event_type = 'nsw_population'",
        "CREATE INDEX IF NOT EXISTS idx_events_nsw_pop_suburb ON events ((attribute->>'suburb')) WHERE event_type = 'nsw_population'",
        "CREATE INDEX IF NOT EXISTS idx_events_nsw_pop_category ON events ((attribute->>'category')) WHERE event_type = 'nsw_population'",
    ]
    for stmt in statements:
        print(f"  {stmt[:80]}...")
        cur.execute(stmt)


def main() -> None:
    print("Reading Excel files...")
    df_2016 = pd.read_excel(EXCEL_2016)
    df_2011 = pd.read_excel(EXCEL_2011)
    print(f"  2016: {len(df_2016)} rows, {df_2016['Suburb'].nunique()} suburbs")
    print(f"  2011: {len(df_2011)} rows, {df_2011['Suburb'].nunique()} suburbs")

    print("Fetching DB connection string from Lambda...")
    conn_str = get_pg_conn_string()
    print(f"  Connected to: {conn_str[:50]}...")

    conn = psycopg2.connect(conn_str)
    conn.autocommit = False

    print("Building event objects...")
    events_2016 = build_events(df_2016, EVENT_TYPE, TIMESTAMP_2016)
    events_2011 = build_events(df_2011, EVENT_TYPE, TIMESTAMP_2011)
    print(f"  2016: {len(events_2016)} events")
    print(f"  2011: {len(events_2011)} events")

    try:
        with conn.cursor() as cur:
            # Idempotent: remove existing rows first
            cur.execute("DELETE FROM events WHERE event_type = %s", (EVENT_TYPE,))
            print(f"  Deleted existing '{EVENT_TYPE}' rows")

            print("Inserting 2016 events...")
            insert_events(cur, events_2016)

            print("Inserting 2011 events...")
            insert_events(cur, events_2011)

            print("Creating indexes...")
            create_indexes(cur)

        conn.commit()
        print(f"\nDone! Inserted {len(events_2016)} (2016) + {len(events_2011)} (2011) = {len(events_2016)+len(events_2011)} total events.")

    except Exception as e:
        conn.rollback()
        print(f"ERROR: {e}", file=sys.stderr)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
