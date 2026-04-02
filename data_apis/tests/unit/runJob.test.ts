import { runJob, RunJobDeps } from "../../src/application/worker/runJob";
import { JobRecord } from "../../src/domain/models/job";
import { JobConfig } from "../../src/domain/models/jobConfig";
import { RawRecord } from "../../src/domain/ports/connector";

// --- helpers ---

const JOB_ID = "job-123";

const fakeJobRecord: JobRecord = {
  job_id: JOB_ID,
  connection_id: "conn-1",
  status: "PENDING",
  config_ref: "s3://configs/conn-1/job-123.json",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const fakeConfig: JobConfig = {
  job_id: JOB_ID,
  connection_id: "conn-1",
  connector_type: "esg_csv_batch",
  source_spec: {
    s3_uris: ["s3://bucket/data.csv"],
    timezone: "UTC",
  },
  mapping_profile: "esg_v1",
  data_source: "clarity_ai",
  dataset_type: "esg_metrics",
  timezone: "UTC",
  ingestion_mode: "full_refresh",
};

const fakeRawRecords: RawRecord[] = [
  {
    raw_row: {
      permid: "111",
      company_name: "TestCo",
      metric_name: "CO2DIRECTSCOPE1",
      metric_value: "100",
      metric_year: "2022",
      metric_unit: "Tonnes",
      metric_description: "desc",
      pillar: "E",
      industry: "Tech",
      headquarter_country: "AU",
      data_type: "Score",
      disclosure: "REPORTED",
      provider_name: "TestProvider",
      nb_points_of_observations: "10",
      reported_date: "2023-01-01",
      metric_period: "FY2022",
    },
    source_file: "s3://bucket/data.csv",
    row_number: 1,
  },
];

function makeDeps(overrides: Partial<RunJobDeps> = {}): RunJobDeps {
  return {
    jobRepo: {
      create: jest.fn(),
      findById: jest.fn().mockResolvedValue(fakeJobRecord),
      claimJob: jest.fn().mockResolvedValue(true),
      updateStatus: jest.fn(),
      updateCheckpoint: jest.fn(),
    },
    configStore: {
      putConfig: jest.fn(),
      getConfig: jest.fn().mockResolvedValue(fakeConfig),
    },
    stateStore: {
      getState: jest.fn().mockResolvedValue(undefined),
      saveState: jest.fn(),
    },
    dataLakeWriter: {
      writeChunk: jest.fn().mockResolvedValue(undefined),
      finalise: jest.fn().mockResolvedValue("s3://datalake/datasets/ds-1/manifest.json"),
    },
    connectorFactory: jest.fn().mockReturnValue({
      fetchIncremental: jest.fn().mockImplementation(
        async (_spec: unknown, _state: unknown, onBatch: (b: RawRecord[]) => Promise<void>, _opts?: unknown) => {
          await onBatch(fakeRawRecords);
          return { updated_at: "2026-01-01T00:00:00Z" };
        },
      ),
    }),
    ...overrides,
  };
}

// --- tests ---

describe("runJob", () => {
  it("skips silently when job is already claimed", async () => {
    const deps = makeDeps({
      jobRepo: {
        ...makeDeps().jobRepo,
        claimJob: jest.fn().mockResolvedValue(false),
      },
    });

    await runJob(JOB_ID, deps);

    expect(deps.jobRepo.claimJob).toHaveBeenCalledWith(JOB_ID, expect.any(String));
    expect(deps.configStore.getConfig).not.toHaveBeenCalled();
  });

  it("runs full pipeline and marks job DONE", async () => {
    const deps = makeDeps();

    await runJob(JOB_ID, deps);

    // claim
    expect(deps.jobRepo.claimJob).toHaveBeenCalledWith(JOB_ID, expect.any(String));
    // load config
    expect(deps.configStore.getConfig).toHaveBeenCalledWith(fakeJobRecord.config_ref);
    // fetch data
    expect(deps.connectorFactory).toHaveBeenCalledWith("esg_csv_batch");
    // write dataset
    expect(deps.dataLakeWriter.writeChunk).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "esg_metric" }),
      ]),
      expect.any(String),
    );
    expect(deps.dataLakeWriter.finalise).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ data_source: "clarity_ai", dataset_type: "esg_metrics" }),
    );
    // mark done
    expect(deps.jobRepo.updateStatus).toHaveBeenCalledWith(JOB_ID, "DONE", {
      dataset_id: "s3://datalake/datasets/ds-1/manifest.json",
    });
  });

  it("marks job FAILED and re-throws when connector throws", async () => {
    const error = new Error("S3 access denied");
    const deps = makeDeps({
      connectorFactory: jest.fn().mockReturnValue({
        fetchIncremental: jest.fn().mockRejectedValue(error),
      } as unknown as ReturnType<RunJobDeps["connectorFactory"]>),
    });

    await expect(runJob(JOB_ID, deps)).rejects.toThrow("S3 access denied");

    expect(deps.jobRepo.updateStatus).toHaveBeenCalledWith(JOB_ID, "FAILED", {
      error: "S3 access denied",
    });
  });

  it("marks job FAILED when dataLakeWriter throws", async () => {
    const deps = makeDeps({
      dataLakeWriter: {
        writeChunk: jest.fn().mockRejectedValue(new Error("write failed")),
        finalise: jest.fn().mockResolvedValue("s3://datalake/datasets/ds-1/manifest.json"),
      },
    });

    await expect(runJob(JOB_ID, deps)).rejects.toThrow("write failed");

    expect(deps.jobRepo.updateStatus).toHaveBeenCalledWith(JOB_ID, "FAILED", {
      error: "write failed",
    });
  });

  it("does not save state for full_refresh mode", async () => {
    const deps = makeDeps();
    await runJob(JOB_ID, deps);
    expect(deps.stateStore.saveState).not.toHaveBeenCalled();
  });

  it("saves connector state for incremental mode", async () => {
    const incrementalConfig: JobConfig = {
      ...fakeConfig,
      ingestion_mode: "incremental",
    };
    const deps = makeDeps({
      configStore: {
        putConfig: jest.fn(),
        getConfig: jest.fn().mockResolvedValue(incrementalConfig),
      },
    });

    await runJob(JOB_ID, deps);

    expect(deps.stateStore.getState).toHaveBeenCalledWith("conn-1");
    expect(deps.stateStore.saveState).toHaveBeenCalledWith(
      expect.objectContaining({ connection_id: "conn-1" }),
    );
  });

  it("normalizes records with esg_metric event_type", async () => {
    const deps = makeDeps();
    await runJob(JOB_ID, deps);

    const writeChunkCall = (deps.dataLakeWriter.writeChunk as jest.Mock).mock.calls[0];
    const events = writeChunkCall[0];
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("esg_metric");
    expect(events[0].attribute.permid).toBe("111");
    expect(events[0].attribute.metric_value).toBe(100);
  });
});
