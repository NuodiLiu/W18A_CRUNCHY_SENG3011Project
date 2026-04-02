import { RawRecord } from "../../domain/ports/connector.js";
import { EventRecord } from "../../domain/models/event.js";
import { JobConfig } from "../../domain/models/jobConfig.js";
import { v4 as uuidv4 } from "uuid";

function parseNum(val: string | undefined): number | null {
  if (!val || val.trim() === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

// skips records with no valid contract_date or zero purchase_price
function isValid(row: Record<string, string>): boolean {
  return !!row.contract_date && row.contract_date.trim() !== "" && parseNum(row.purchase_price) !== 0;
}

export const normalizeHousingSales = function normalizeHousingSales(
  records: RawRecord[],
  config: JobConfig,
  runTimestamp: string,
): EventRecord[] {
  const results: EventRecord[] = [];

  for (const r of records) {
    const row = r.raw_row;

    if (!isValid(row)) continue;

    // use contract_date as the canonical event timestamp
    const rawDate = row.contract_date.trim();
    const timestamp = rawDate ? `${rawDate}T00:00:00Z` : runTimestamp;

    results.push({
      event_id: uuidv4(),
      time_object: {
        timestamp,
        timezone: config.timezone,
      },
      event_type: "housing_sale",
      attribute: {
        property_id:        row.property_id ?? "",
        dealing_number:     parseNum(row.dealing_number),
        unit_number:        row.unit_number ?? "",
        street_number:      row.street_number ?? "",
        street_name:        row.street_name ?? "",
        suburb:             row.suburb ?? "",
        postcode:           parseNum(row.postcode),
        purchase_price:     parseNum(row.purchase_price) ?? 0,
        legal_description:  row.legal_description ?? "",
        area:               parseNum(row.area),
        area_type:          row.area_type ?? "",
        contract_date:      rawDate,
        settlement_date:    row.settlement_date?.trim() ?? "",
        district_code:      parseNum(row.district_code) ?? 0,
        zoning:             row.zoning ?? "",
        nature_of_property: row.nature_of_property ?? "",
        primary_purpose:    row.primary_purpose ?? "",
      },
    });
  }

  return results;
}
