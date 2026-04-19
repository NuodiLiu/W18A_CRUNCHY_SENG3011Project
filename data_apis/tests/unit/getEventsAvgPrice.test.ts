import { getEventsAvgPrice } from "../../src/application/retrieval/getEventsAvgPrice";
import { HousingAnalyticsRepository } from "../../src/domain/ports/housingAnalyticsRepository";

function makeDeps(rows: any[]) {
  return {
    getAverageHousingPrices: jest.fn().mockResolvedValue(rows),
  } as unknown as HousingAnalyticsRepository;
}

describe("getEventsAvgPrice", () => {
  const mockRows = [
    { group_key: "Sydney", value: 1200000, count: 10 },
    { group_key: "Parramatta", value: 900000, count: 5 },
  ];

  it("maps AggRow -> AvgPriceResult correctly", async () => {
    const deps = makeDeps(mockRows);

    const result = await getEventsAvgPrice("Sydney", 2, deps);

    expect(deps.getAverageHousingPrices).toHaveBeenCalledWith("Sydney", 2);

    expect(result).toEqual([
      { suburb: "Sydney", average_price: 1200000, count: 10 },
      { suburb: "Parramatta", average_price: 900000, count: 5 },
    ]);
  });

  it("passes undefined suburb correctly", async () => {
    const deps = makeDeps(mockRows);

    await getEventsAvgPrice(undefined, 3, deps);

    expect(deps.getAverageHousingPrices).toHaveBeenCalledWith(undefined, 3);
  });

  it("returns empty array when no rows", async () => {
    const deps = makeDeps([]);

    const result = await getEventsAvgPrice("Sydney", 2, deps);

    expect(result).toEqual([]);
  });
});