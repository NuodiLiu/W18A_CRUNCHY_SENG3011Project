import "reflect-metadata";
import { Controller, Get, Route, Tags, SuccessResponse } from "tsoa";

interface HealthResponse {
  status: string;
  version: string;
  timestamp: string;
}

@Route("")
@Tags("Health")
export class HealthController extends Controller {
  /**
   * Returns service health status, version, and current server timestamp.
   * Intended for load balancers, CI pipelines, and third-party monitoring.
   */
  @Get("health")
  @SuccessResponse(200, "Service is healthy")
  public async getHealth(): Promise<HealthResponse> {
    return {
      status: "ok",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    };
  }
}
