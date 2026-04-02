import { deleteEvent } from "../../src/application/retrieval/deleteEvent";
import { DataLakeReader } from "../../src/domain/ports/dataLakeReader";

function makeDataLakeReader(deleteResult: boolean): DataLakeReader {
  return {
    queryEvents: jest.fn(),
    findEventById: jest.fn(),
    deleteEvent: jest.fn().mockResolvedValue(deleteResult),
    getDistinctEventTypes: jest.fn(),
    getGroupProjection: jest.fn(),
    readDataset: jest.fn(),
      aggregateByDimension: jest.fn().mockResolvedValue([]),
      aggregateByTimePeriod: jest.fn().mockResolvedValue([]),
  };
}

describe("deleteEvent", () => {
  it("returns true when event is successfully deleted", async () => {
    const reader = makeDataLakeReader(true);
    const result = await deleteEvent("evt-123", { dataLakeReader: reader });

    expect(result).toBe(true);
    expect(reader.deleteEvent).toHaveBeenCalledWith("evt-123");
    expect(reader.deleteEvent).toHaveBeenCalledTimes(1);
  });

  it("returns false when event does not exist", async () => {
    const reader = makeDataLakeReader(false);
    const result = await deleteEvent("evt-nonexistent", { dataLakeReader: reader });

    expect(result).toBe(false);
    expect(reader.deleteEvent).toHaveBeenCalledWith("evt-nonexistent");
    expect(reader.deleteEvent).toHaveBeenCalledTimes(1);
  });

  it("propagates errors from the data lake reader", async () => {
    const reader: DataLakeReader = {
      queryEvents: jest.fn(),
      findEventById: jest.fn(),
      deleteEvent: jest.fn().mockRejectedValue(new Error("Database connection failed")),
      getDistinctEventTypes: jest.fn(),
      getGroupProjection: jest.fn(),
      readDataset: jest.fn(),
      aggregateByDimension: jest.fn().mockResolvedValue([]),
      aggregateByTimePeriod: jest.fn().mockResolvedValue([]),
    };

    await expect(
      deleteEvent("evt-123", { dataLakeReader: reader })
    ).rejects.toThrow("Database connection failed");

    expect(reader.deleteEvent).toHaveBeenCalledWith("evt-123");
    expect(reader.deleteEvent).toHaveBeenCalledTimes(1);
  });
});