import { getJobStatus, GetJobStatusDeps } from "../../src/application/ingestion/getJobStatus";
import { JobRecord } from "../../src/domain/models/job";

const fakeJob: JobRecord = {
  job_id: "j-1",
  connection_id: "c-1",
  status: "DONE",
  config_ref: "s3://config/c-1/j-1.json",
  dataset_id: "s3://datalake/ds-1/manifest.json",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

function makeDeps(job: JobRecord | undefined): GetJobStatusDeps {
  return {
    jobRepo: {
      create: jest.fn(),
      findById: jest.fn().mockResolvedValue(job),
      claimJob: jest.fn(),
      updateStatus: jest.fn(),
      updateCheckpoint: jest.fn(),
    },
  };
}

describe("getJobStatus", () => {
  it("returns mapped result when job exists", async () => {
    const deps = makeDeps(fakeJob);
    const result = await getJobStatus("j-1", deps);

    expect(result).toEqual({
      job_id: "j-1",
      connection_id: "c-1",
      status: "DONE",
      config_ref: "s3://config/c-1/j-1.json",
      dataset_id: "s3://datalake/ds-1/manifest.json",
      error: undefined,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    });
  });

  it("returns undefined when job does not exist", async () => {
    const deps = makeDeps(undefined);
    const result = await getJobStatus("nonexistent", deps);
    expect(result).toBeUndefined();
  });

  it("calls jobRepo.findById with the correct jobId", async () => {
    const deps = makeDeps(fakeJob);
    await getJobStatus("j-1", deps);
    expect(deps.jobRepo.findById).toHaveBeenCalledWith("j-1");
  });

  it("includes error field when job has error", async () => {
    const failedJob: JobRecord = {
      ...fakeJob,
      status: "FAILED",
      error: "S3 access denied",
      dataset_id: undefined,
    };
    const deps = makeDeps(failedJob);
    const result = await getJobStatus("j-1", deps);

    expect(result).toBeDefined();
    expect(result!.status).toBe("FAILED");
    expect(result!.error).toBe("S3 access denied");
    expect(result!.dataset_id).toBeUndefined();
  });

  it("maps PENDING job correctly (no dataset_id or error)", async () => {
    const pendingJob: JobRecord = {
      ...fakeJob,
      status: "PENDING",
      dataset_id: undefined,
      error: undefined,
    };
    const deps = makeDeps(pendingJob);
    const result = await getJobStatus("j-1", deps);

    expect(result!.status).toBe("PENDING");
    expect(result!.dataset_id).toBeUndefined();
    expect(result!.error).toBeUndefined();
  });
});
