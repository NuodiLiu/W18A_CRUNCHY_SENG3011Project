"""
Insert 4 new education/facility datasets into the events table.

Files (from ~/Desktop/raw_housing_data/new_data/):
  - cleaned_centres.csv            → event_type: shopping_centre
  - cleaned_enrolments_2017_onwards.csv → event_type: school_enrolment
  - cleaned_location_facilities.csv     → event_type: transport_facility
  - distinguished_achievers_2017_2024.csv → event_type: distinguished_achiever

Steps:
  1. COPY  — this script bulk-inserts all rows (copy phase)
  2. INDEX — run the SQL block at the bottom of this file via psql
  3. ANALYZE — automatically triggered after index creation

Usage:
    pip install psycopg2-binary
    python scripts/insert_education_data.py
"""

import csv
import json
import uuid
import os
import psycopg2

PG_CONNECTION = (
    "postgres://postgres:SgfBmBe8RayGJ6X8FBTmte98"
    "@eia-dev-events-db.cpa4ki406ri8.ap-southeast-2.rds.amazonaws.com"
    ":5432/events?sslmode=require"
)
DATASET_ID = "education_import"
DATA_DIR = os.path.expanduser("~/Desktop/raw_housing_data/new_data")

INSERT_SQL = """
    INSERT INTO events (event_id, event_type, dataset_id, time_object, attribute)
    VALUES (%s, %s, %s, %s::jsonb, %s::jsonb)
    ON CONFLICT (event_id) DO NOTHING
"""


# ── 1. Shopping Centres ──────────────────────────────────────────────────────
# Columns: name, suburb, suburb_group, stores
def build_centres_rows():
    rows = []
    with open(os.path.join(DATA_DIR, "cleaned_centres.csv"), newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append((
                str(uuid.uuid4()),
                "shopping_centre",
                DATASET_ID,
                json.dumps({"timestamp": "2024-01-01T00:00:00Z", "timezone": "Australia/Sydney"}),
                json.dumps({
                    "name": row["name"],
                    "suburb": row["suburb"],
                    "suburb_group": row["suburb_group"],
                    "stores": int(row["stores"]) if row["stores"] and row["stores"] != "?" else None,
                }),
            ))
    return rows


# ── 2. School Enrolments ─────────────────────────────────────────────────────
# Columns: School Code, School Name, Census Year, Year 12
def build_enrolments_rows():
    rows = []
    with open(os.path.join(DATA_DIR, "cleaned_enrolments_2017_onwards.csv"), newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            year = row["Census Year"].strip()
            rows.append((
                str(uuid.uuid4()),
                "school_enrolment",
                DATASET_ID,
                json.dumps({"timestamp": f"{year}-01-01T00:00:00Z", "timezone": "Australia/Sydney"}),
                json.dumps({
                    "school_code": row["School Code"].strip(),
                    "school_name": row["School Name"].strip(),
                    "census_year": int(year),
                    "year_12_enrolment": float(row["Year 12"]) if row["Year 12"] else None,
                }),
            ))
    return rows


# ── 3. Transport / Location Facilities ──────────────────────────────────────
# Columns: location_name, suburb, transport_mode
def build_facilities_rows():
    rows = []
    with open(os.path.join(DATA_DIR, "cleaned_location_facilities.csv"), newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append((
                str(uuid.uuid4()),
                "transport_facility",
                DATASET_ID,
                json.dumps({"timestamp": "2024-01-01T00:00:00Z", "timezone": "Australia/Sydney"}),
                json.dumps({
                    "location_name": row["location_name"],
                    "suburb": row["suburb"],
                    "transport_mode": row["transport_mode"],
                }),
            ))
    return rows


# ── 4. Distinguished Achievers ───────────────────────────────────────────────
# Columns: first_name, last_name, school, course, year
def build_achievers_rows():
    rows = []
    with open(os.path.join(DATA_DIR, "distinguished_achievers_2017_2024.csv"), newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            year = row["year"].strip()
            rows.append((
                str(uuid.uuid4()),
                "distinguished_achiever",
                DATASET_ID,
                json.dumps({"timestamp": f"{year}-01-01T00:00:00Z", "timezone": "Australia/Sydney"}),
                json.dumps({
                    "first_name": row["first_name"],
                    "last_name": row["last_name"],
                    "school": row["school"],
                    "course": row["course"].strip(),
                    "year": int(year),
                }),
            ))
    return rows


def insert_batch(cur, rows, label, batch_size=5000):
    total = 0
    for i in range(0, len(rows), batch_size):
        cur.executemany(INSERT_SQL, rows[i:i + batch_size])
        total += len(rows[i:i + batch_size])
        print(f"  {label}: inserted {total}/{len(rows)}")
    return total


def main():
    print("Connecting to RDS…")
    conn = psycopg2.connect(PG_CONNECTION)
    cur = conn.cursor()

    # ── Step 1: COPY (delete old + re-insert for idempotency) ───────────────
    event_types = ("shopping_centre", "school_enrolment", "transport_facility", "distinguished_achiever")
    cur.execute(
        "DELETE FROM events WHERE event_type = ANY(%s) AND dataset_id = %s",
        (list(event_types), DATASET_ID),
    )
    print(f"Cleared old rows: {cur.rowcount}")

    datasets = [
        (build_centres_rows,     "shopping_centre"),
        (build_enrolments_rows,  "school_enrolment"),
        (build_facilities_rows,  "transport_facility"),
        (build_achievers_rows,   "distinguished_achiever"),
    ]

    grand_total = 0
    for builder, label in datasets:
        print(f"\nBuilding rows for {label}…")
        rows = builder()
        print(f"  → {len(rows)} rows, inserting in batches…")
        grand_total += insert_batch(cur, rows, label)

    conn.commit()
    print(f"\n✔ COPY complete — {grand_total} rows inserted total")

    # ── Step 2: INDEX (run after copy for speed) ─────────────────────────────
    print("\nCreating indexes…")
    index_sqls = [
        # shopping_centre: suburb lookup
        """CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_sc_suburb
           ON events ((attribute->>'suburb'))
           WHERE event_type = 'shopping_centre'""",
        # school_enrolment: school_code + year
        """CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_enrol_school_year
           ON events ((attribute->>'school_code'), ((attribute->>'census_year')::int))
           WHERE event_type = 'school_enrolment'""",
        # transport_facility: suburb + mode
        """CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_transport_suburb
           ON events ((attribute->>'suburb'))
           WHERE event_type = 'transport_facility'""",
        # distinguished_achiever: school + year
        """CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_achiever_school_year
           ON events ((attribute->>'school'), ((attribute->>'year')::int))
           WHERE event_type = 'distinguished_achiever'""",
    ]
    # CONCURRENTLY requires autocommit
    conn.autocommit = True
    for sql in index_sqls:
        name = sql.split("idx_")[1].split("\n")[0].strip()
        print(f"  Creating idx_{name}…")
        cur.execute(sql)
    print("✔ INDEX complete")

    # ── Step 3: ANALYZE ───────────────────────────────────────────────────────
    print("\nRunning ANALYZE…")
    cur.execute("ANALYZE events")
    print("✔ ANALYZE complete")

    cur.close()
    conn.close()
    print("\nAll done.")


if __name__ == "__main__":
    main()
