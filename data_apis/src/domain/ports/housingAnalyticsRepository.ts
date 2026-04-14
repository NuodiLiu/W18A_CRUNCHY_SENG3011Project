import { AggRow } from "./dataLakeReader.js";

export interface HousingAnalyticsRepository {
  getAverageHousingPrices(
    suburb?: string,
    yearsBack?: number
  ): Promise<AggRow[]>;
}