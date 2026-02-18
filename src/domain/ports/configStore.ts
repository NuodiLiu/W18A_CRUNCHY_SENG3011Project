import { JobConfig } from "../models/jobConfig.js";

export interface ConfigStore {
  putConfig(connectionId: string, jobId: string, config: JobConfig): Promise<string>;
  getConfig(configRef: string): Promise<JobConfig>;
}
