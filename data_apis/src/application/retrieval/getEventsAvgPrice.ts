import { AggRow, DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import { HousingAnalyticsRepository } from "../../domain/ports/housingAnalyticsRepository.js";

export interface GetAvgPriceDeps {
  dataLakeReader: HousingAnalyticsRepository;
}

export interface AvgPriceResult {
  suburb: string;
  average_price: number;
  count: number;
}

export async function getEventsAvgPrice(
  suburb: string | undefined,
  yearsBack: number = 2,
  deps: HousingAnalyticsRepository
): Promise<AvgPriceResult[]> {

  const rows = await deps.getAverageHousingPrices(suburb, yearsBack);

  return rows.map((r: AggRow) => ({
    suburb: r.group_key,
    average_price: r.value,
    count: r.count
  }));
}