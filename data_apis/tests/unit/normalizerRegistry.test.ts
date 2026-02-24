import { getNormalizer } from "../../src/application/normalizers/index";
import { normalizeEsgMetrics } from "../../src/application/normalizers/normalizeEsgMetrics";
import { UnprocessableError } from "../../src/domain/errors";

describe("getNormalizer registry", () => {
  it("returns normalizeEsgMetrics for 'esg_csv_batch'", () => {
    const fn = getNormalizer("esg_csv_batch");
    expect(fn).toBe(normalizeEsgMetrics);
  });

  it("throws UnprocessableError for unknown connector type", () => {
    expect(() => getNormalizer("xml_connector")).toThrow(UnprocessableError);
  });

  it("error message includes the unknown type", () => {
    expect(() => getNormalizer("pdf_reader")).toThrow(/pdf_reader/);
  });

  it("returned function is callable", () => {
    const fn = getNormalizer("esg_csv_batch");
    expect(typeof fn).toBe("function");
  });
});
