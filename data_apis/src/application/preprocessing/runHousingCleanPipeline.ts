import { EventRecord } from "../../domain/models/event.js";
import { HousingSaleAttribute } from "../../domain/models/event.js";
import { QualityReport } from "../../http/types/preprocessing.types.js";

const VALID_AREA_TYPES = new Set(["M", "H"]);

export interface HousingCleanParams {
  price_min?: number;
  dedup_by_dealing?: boolean;
  normalize_suburb?: boolean;
  nullify_zero_area?: boolean;
  fix_area_type?: boolean;
  trim_whitespace?: boolean;
}

function resolveParams(raw?: Record<string, unknown>): Required<HousingCleanParams> {
  return {
    price_min: typeof raw?.price_min === "number" ? raw.price_min : 1,
    dedup_by_dealing: typeof raw?.dedup_by_dealing === "boolean" ? raw.dedup_by_dealing : true,
    normalize_suburb: typeof raw?.normalize_suburb === "boolean" ? raw.normalize_suburb : true,
    nullify_zero_area: typeof raw?.nullify_zero_area === "boolean" ? raw.nullify_zero_area : true,
    fix_area_type: typeof raw?.fix_area_type === "boolean" ? raw.fix_area_type : true,
    trim_whitespace: typeof raw?.trim_whitespace === "boolean" ? raw.trim_whitespace : true,
  };
}

export function createEmptyReport(): QualityReport {
  return {
    input_count: 0,
    output_count: 0,
    removed: { zero_price: 0, duplicates: 0, invalid_date: 0 },
    standardized: { suburb_uppercased: 0, area_nullified: 0, area_type_fixed: 0, whitespace_trimmed: 0 },
  };
}

// processes a batch of housing events, accumulates into shared report
export function runHousingCleanBatch(
  events: EventRecord[],
  params: Required<HousingCleanParams>,
  report: QualityReport,
  seenDealings: Set<number>,
): EventRecord[] {
  const cleaned: EventRecord[] = [];

  for (const event of events) {
    report.input_count++;
    const attr = event.attribute as unknown as HousingSaleAttribute;

    // skip records with missing contract_date
    if (!attr.contract_date || attr.contract_date.trim() === "") {
      report.removed.invalid_date++;
      continue;
    }

    // skip zero or below-threshold price (sample has 24.6% zero-price transfers)
    if (attr.purchase_price <= params.price_min) {
      report.removed.zero_price++;
      continue;
    }

    // drop duplicate dealing_number across batches
    if (params.dedup_by_dealing && attr.dealing_number != null) {
      if (seenDealings.has(attr.dealing_number)) {
        report.removed.duplicates++;
        continue;
      }
      seenDealings.add(attr.dealing_number);
    }

    let suburb = attr.suburb;
    let area = attr.area;
    let areaType = attr.area_type;
    let streetName = attr.street_name;
    let legalDesc = attr.legal_description;

    // uppercase suburb names
    if (params.normalize_suburb && suburb && suburb !== suburb.toUpperCase()) {
      suburb = suburb.toUpperCase();
      report.standardized.suburb_uppercased++;
    }

    // convert zero area to null
    if (params.nullify_zero_area && area === 0) {
      area = null;
      report.standardized.area_nullified++;
    }

    // fix corrupted area_type (sample has values like "847.3", "24.14" from csv parse shift)
    if (params.fix_area_type && areaType && !VALID_AREA_TYPES.has(areaType)) {
      areaType = "";
      report.standardized.area_type_fixed++;
    }

    // trim leading/trailing whitespace on string fields
    if (params.trim_whitespace) {
      const origStreet = streetName;
      const origLegal = legalDesc;
      streetName = streetName?.trim() ?? "";
      legalDesc = legalDesc?.trim() ?? "";
      suburb = suburb?.trim() ?? "";
      if (streetName !== origStreet || legalDesc !== origLegal) {
        report.standardized.whitespace_trimmed++;
      }
    }

    cleaned.push({
      ...event,
      attribute: {
        ...attr,
        suburb,
        area,
        area_type: areaType,
        street_name: streetName,
        legal_description: legalDesc,
      },
    });
    report.output_count++;
  }

  return cleaned;
}

// convenience wrapper for single-batch processing
export function runHousingCleanPipeline(
  events: EventRecord[],
  rawParams?: Record<string, unknown>,
): { cleaned: EventRecord[]; report: QualityReport } {
  const params = resolveParams(rawParams);
  const report = createEmptyReport();
  const seenDealings = new Set<number>();
  const cleaned = runHousingCleanBatch(events, params, report, seenDealings);
  return { cleaned, report };
}

export { resolveParams };
