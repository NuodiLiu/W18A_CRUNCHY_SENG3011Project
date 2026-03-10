import { getNormalizer } from "../../src/application/normalizers/index";
import { normalizeEsgMetrics } from "../../src/application/normalizers/normalizeEsgMetrics";
import { normalizeHousingSales } from "../../src/application/normalizers/normalizeHousingSales";
import { UnprocessableError } from "../../src/domain/errors";

describe("getNormalizer registry", () => {
  it("returns normalizeEsgMetrics for 'esg_v1'", () => {
    const fn = getNormalizer("esg_v1");
    expect(fn).toBe(normalizeEsgMetrics);
  });

  it("returns normalizeHousingSales for 'housing_v1'", () => {
    const fn = getNormalizer("housing_v1");
    expect(fn).toBe(normalizeHousingSales);
  });

  it("throws UnprocessableError for unknown mapping profile", () => {
    expect(() => getNormalizer("xml_connector")).toThrow(UnprocessableError);
  });

  it("error message includes the unknown profile", () => {
    expect(() => getNormalizer("pdf_reader")).toThrow(/pdf_reader/);
  });

  it("returned function is callable", () => {
    const fn = getNormalizer("esg_v1");
    expect(typeof fn).toBe("function");
  });
});
