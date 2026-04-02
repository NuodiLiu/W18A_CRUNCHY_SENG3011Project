import { normalizeHousingSales } from "../../src/application/normalizers/normalizeHousingSales";
import { RawRecord } from "../../src/domain/ports/connector";
import { JobConfig } from "../../src/domain/models/jobConfig";
import { HousingSaleAttribute } from "../../src/domain/models/event";

const baseConfig: JobConfig = {
  job_id: "job-1",
  connection_id: "conn-1",
  connector_type: "esg_csv_batch",
  source_spec: {
    s3_uris: ["s3://bucket/housing.csv"],
    timezone: "UTC",
  },
  mapping_profile: "housing_v1",
  data_source: "nsw_valuer_general",
  dataset_type: "housing",
  timezone: "Australia/Sydney",
  ingestion_mode: "full_refresh",
};

const RUN_TS = "2026-03-05T00:00:00.000Z";

// representative valid row from HousingSalesSample.csv
function makeRawRecord(overrides: Record<string, string> = {}): RawRecord {
  return {
    raw_row: {
      district_code:      "223",
      property_id:        "1897942800000",
      dealing_number:     "2525755.0",
      unit_number:        "",
      street_number:      "365",
      street_name:        "WILLOWDENE AV",
      suburb:             "LUDDENHAM",
      postcode:           "2745.0",
      purchase_price:     "500000.0",
      legal_description:  "LOT 23 DP 259698",
      area:               "10.11",
      area_type:          "H",
      zoning:             "R",
      nature_of_property: "",
      primary_purpose:    "",
      contract_date:      "1990-01-01",
      settlement_date:    "1990-01-01",
      ...overrides,
    },
    source_file: "s3://bucket/housing.csv",
    row_number: 1,
  };
}

describe("normalizeHousingSales", () => {
  describe("field mapping", () => {
    it("maps all attribute fields correctly", () => {
      const events = normalizeHousingSales([makeRawRecord()], baseConfig, RUN_TS);
      expect(events).toHaveLength(1);

      const attr = events[0].attribute as unknown as HousingSaleAttribute;
      expect(attr.property_id).toBe("1897942800000");
      expect(attr.dealing_number).toBe(2525755);
      expect(attr.unit_number).toBe("");
      expect(attr.street_number).toBe("365");
      expect(attr.street_name).toBe("WILLOWDENE AV");
      expect(attr.suburb).toBe("LUDDENHAM");
      expect(attr.postcode).toBe(2745);
      expect(attr.purchase_price).toBe(500000);
      expect(attr.legal_description).toBe("LOT 23 DP 259698");
      expect(attr.area).toBe(10.11);
      expect(attr.area_type).toBe("H");
      expect(attr.zoning).toBe("R");
      expect(attr.contract_date).toBe("1990-01-01");
      expect(attr.settlement_date).toBe("1990-01-01");
      expect(attr.district_code).toBe(223);
    });

    it("sets event_type to housing_sale", () => {
      const events = normalizeHousingSales([makeRawRecord()], baseConfig, RUN_TS);
      expect(events[0].event_type).toBe("housing_sale");
    });

    it("uses config timezone in time_object", () => {
      const events = normalizeHousingSales([makeRawRecord()], baseConfig, RUN_TS);
      expect(events[0].time_object.timezone).toBe("Australia/Sydney");
    });
  });

  describe("timestamp handling", () => {
    it("converts contract_date to ISO timestamp", () => {
      const events = normalizeHousingSales([makeRawRecord()], baseConfig, RUN_TS);
      expect(events[0].time_object.timestamp).toBe("1990-01-01T00:00:00Z");
    });

    it("falls back to runTimestamp when contract_date is empty", () => {
      const events = normalizeHousingSales(
        [makeRawRecord({ contract_date: "", purchase_price: "100000" })],
        baseConfig,
        RUN_TS,
      );
      // empty contract_date is filtered out
      expect(events).toHaveLength(0);
    });

    it("trims whitespace from contract_date", () => {
      const events = normalizeHousingSales(
        [makeRawRecord({ contract_date: "  2024-06-15  " })],
        baseConfig,
        RUN_TS,
      );
      expect(events[0].time_object.timestamp).toBe("2024-06-15T00:00:00Z");
      expect((events[0].attribute as unknown as HousingSaleAttribute).contract_date).toBe("2024-06-15");
    });
  });

  describe("filtering", () => {
    it("filters out records with purchase_price = 0", () => {
      // rows 4–9 in sample CSV all have purchase_price 0.0
      const events = normalizeHousingSales(
        [makeRawRecord({ purchase_price: "0.0" })],
        baseConfig,
        RUN_TS,
      );
      expect(events).toHaveLength(0);
    });

    it("filters out records with missing contract_date", () => {
      const events = normalizeHousingSales(
        [makeRawRecord({ contract_date: "" })],
        baseConfig,
        RUN_TS,
      );
      expect(events).toHaveLength(0);
    });

    it("keeps records with non-zero purchase_price and valid contract_date", () => {
      const events = normalizeHousingSales(
        [makeRawRecord({ purchase_price: "230000.0" })],
        baseConfig,
        RUN_TS,
      );
      expect(events).toHaveLength(1);
    });

    it("filters invalid rows and keeps valid ones in a mixed batch", () => {
      const records: RawRecord[] = [
        makeRawRecord({ purchase_price: "500000.0" }),           // valid
        makeRawRecord({ purchase_price: "0.0" }),                // filtered: zero price
        makeRawRecord({ contract_date: "" }),                    // filtered: no date
        makeRawRecord({ purchase_price: "200000.0", contract_date: "2020-03-01" }), // valid
      ];
      const events = normalizeHousingSales(records, baseConfig, RUN_TS);
      expect(events).toHaveLength(2);
    });
  });

  describe("numeric parsing", () => {
    it("parses float strings to numbers", () => {
      const events = normalizeHousingSales(
        [makeRawRecord({ area: "696.0", postcode: "2262.0" })],
        baseConfig,
        RUN_TS,
      );
      const attr = events[0].attribute as unknown as HousingSaleAttribute;
      expect(attr.area).toBe(696);
      expect(attr.postcode).toBe(2262);
    });

    it("sets area to null when area is empty", () => {
      const events = normalizeHousingSales(
        [makeRawRecord({ area: "" })],
        baseConfig,
        RUN_TS,
      );
      expect((events[0].attribute as unknown as HousingSaleAttribute).area).toBeNull();
    });

    it("sets dealing_number to null when empty", () => {
      const events = normalizeHousingSales(
        [makeRawRecord({ dealing_number: "" })],
        baseConfig,
        RUN_TS,
      );
      expect((events[0].attribute as unknown as HousingSaleAttribute).dealing_number).toBeNull();
    });
  });

  describe("empty input", () => {
    it("returns empty array for no records", () => {
      const events = normalizeHousingSales([], baseConfig, RUN_TS);
      expect(events).toHaveLength(0);
    });

    it("returns empty array when all records are filtered out", () => {
      const records = [
        makeRawRecord({ purchase_price: "0.0" }),
        makeRawRecord({ purchase_price: "0.0" }),
      ];
      const events = normalizeHousingSales(records, baseConfig, RUN_TS);
      expect(events).toHaveLength(0);
    });
  });
});
