import type { IocContainer } from "tsoa";
import { CollectionController, CollectionControllerDeps } from "./controllers/CollectionController.js";
import { EventsController, EventsControllerDeps } from "./controllers/EventsController.js";
import { VisualisationController } from "./controllers/VisualisationController.js";
import { PreprocessingController, PreprocessingControllerDeps } from "./controllers/PreprocessingController.js";
import { HealthController } from "./controllers/HealthController.js";
import { FileUploadService } from "../domain/ports/fileUploadService.js";
import { DataLakeReader } from "@domain/ports/dataLakeReader.js";

export type AppDeps = CollectionControllerDeps &
  EventsControllerDeps & PreprocessingControllerDeps &
  { dataLakeReader: DataLakeReader };
export type { FileUploadService };

let _deps: AppDeps;

/** Called once from createApp() before Express starts handling requests. */
export function initDeps(deps: AppDeps): void {
  _deps = deps;
}

export const iocContainer: IocContainer = {
  get<T>(Controller: new (...args: unknown[]) => T): T {
    switch (Controller as unknown) {
      case CollectionController:
        return new CollectionController(_deps) as unknown as T;
      case EventsController:
        return new EventsController(_deps) as unknown as T;
      case VisualisationController:
        return new VisualisationController(_deps) as unknown as T;
      case PreprocessingController:
        return new PreprocessingController(_deps) as unknown as T;
      case HealthController:
        return new HealthController() as unknown as T;
      default:
        return new Controller();
    }
  },
};