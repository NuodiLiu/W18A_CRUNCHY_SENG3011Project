/**
 * Port: Config store — read/write job config JSON to/from S3.
 */

import { JobConfig } from "../models/jobConfig.js";

export interface ConfigStore {
  /** Write job config and return the S3 URI (config_ref). */
  putConfig(connectionId: string, jobId: string, config: JobConfig): Promise<string>;

  /** Read job config by S3 URI. */
  getConfig(configRef: string): Promise<JobConfig>;
}
