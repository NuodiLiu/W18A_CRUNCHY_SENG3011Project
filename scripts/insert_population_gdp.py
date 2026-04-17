"""
Insert Australian quarterly population and quarterly GDP data into the events table.

Sources:
  - ~/Desktop/raw_housing_data/australia_quarterly_population_2000_to_2025Q3.csv
  - ~/Desktop/raw_housing_data/australia_quarterly_gdp_2000_to_2025q4.xlsx

Population events  (event_type = aus_population):
  time_object.timestamp = quarter_end_date (ISO)
  attribute: { country, quarter, year, population }

GDP events  (event_type = aus_gdp):
  time_object.timestamp = quarter_start_date (ISO)
  attribute: { country, quarter, year, real_gdp_aud_millions, nominal_gdp_aud_millions }

Usage:
    pip3 install psycopg2-binary pandas openpyxl boto3
    python3 scripts/insert_population_gdp.py
"""

import json
import os
import subprocess
import sys
import uuid

import pandas as pd
import psycopg2
import psycopg2.extras

# ── Config ────────────────────────────────────────────────────────────────────

POPULATION_CSV = os.path.expanduser(
    "~/Desktop/raw_housing_data/australia_quarterly_population_2000_to_2025Q3.csv"
)
GDP_XLSX = os.path.expanduser(
    "~/Desktop/raw_housing_data/australia_quarterly_gdp_2000_to_2025q4.xlsx"
)
LAMBDA_FUNCTION = "eia-dev-api"
AWS_REGION = "ap-southeast-2"
DATASET_ID = "aus_macro_import"
BATCH_SIZE = 200

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
        print("[config] PG connection retrieved from Lambda env")
        return conn_str
    except Exception as exc:
        print(f"[error] Could not get PG connection from Lambda: {exc}")
        sys.exit(1)


# ── Build rows ────────────────────────────────────────────────────────────────

def build_population_rows() -> list:
    df = pd.read_csv(POPULATION_CSV)
    rows = []
    for _, row in df.iterrows():
        quarter = str(row["quarter"]).strip()
        year = quarter[:4]
        date_str = str(row["quarter_end_date"]).strip()
        population = int(row["population_persons"])
        rows.append((
            str(uuid.uuid4()),
            "aus_population",
            DATASET_ID,
            json.dumps({"timestamp": f"{date_str}T00:00:00Z", "timezone": "UTC"}),
            json.dumps({
                "country": "Australia",
                "quarter": quarter,
                "year": year,
                "population": population,
            }),
        ))
    return rows


def build_gdp_rows() -> list:
    df = pd.read_excel(GDP_XLSX)
    rows = []
    for _, row in df.iterrows():
        quarter = str(row["quarter"]).strip()
        year = quarter[:4]
        date_str = str(row["quarter_start_date"])[:10]
        real_gdp = int(row["real_gdp_chain_volume_sa_aud_millions"])
        nominal_gdp = int(row["nominal_gdp_current_price_sa_aud_millions"])
        rows.append((
            str(uuid.uuid4()),
            "aus_gdp",
            DATASET_ID,
            json.dumps({"timestamp": f"{date_str}T00:00:00Z", "timezone": "UTC"}),
            json.dumps({
                "country": "Australia",
                "quarter": quarter,
                "year": year,
                "real_gdp_aud_millions": real_gdp,
                "nominal_gdp_aud_millions": nominal_gdp,
            }),
        ))
    return rows


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    conn_str = get_pg_connection_string()
    conn = psycopg2.connect(conn_str)
    cur = conn.cursor()

    # Idempotent: clear previous data for this dataset
    cur.execute(
        "DELETE FROM events WHERE event_type IN ('aus_population', 'aus_gdp') AND dataset_id = %s",
        (DATASET_ID,),
    )
    print(f"[idempotency] Cleared {cur.rowcount} existing rows")

    pop_rows = build_population_rows()
    gdp_rows = build_gdp_rows()
    all_rows = pop_rows + gdp_rows

    insert_sql = """
        INSERT INTO events (event_id, event_type, dataset_id, time_object, attribute)
        VALUES (%s, %s, %s, %s::jsonb, %s::jsonb)
    """
    psycopg2.extras.execute_batch(cur, insert_sql, all_rows, page_size=BATCH_SIZE)
    conn.commit()

    print(f"[done] Inserted {len(all_rows)} rows "
          f"({len(pop_rows)} aus_population + {len(gdp_rows)} aus_gdp)")

    # Indexes for fast querying
    print("[index] Creating indexes...")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_events_aus_population_type ON events (event_type) WHERE event_type = 'aus_population'")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_events_aus_gdp_type ON events (event_type) WHERE event_type = 'aus_gdp'")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_events_aus_macro_quarter ON events ((attribute->>'quarter')) WHERE event_type IN ('aus_population', 'aus_gdp')")
    conn.commit()
    print("[index] Done")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()


