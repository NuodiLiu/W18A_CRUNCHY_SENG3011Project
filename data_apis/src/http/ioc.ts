/**
 * IoC container for tsoa.
 * Stores runtime dependencies (AWS clients, repos, etc.) in a module-level singleton
 * and injects them into controllers that need them.
 */
import type { IocContainer } from "tsoa";
import { CollectionController, CollectionControllerDeps } from "./controllers/CollectionController.js";
import { EventsController } from "./controllers/EventsController.js";
import { PreprocessingController } from "./controllers/PreprocessingController.js";
import { HealthController } from "./controllers/HealthController.js";

export type AppDeps = CollectionControllerDeps;

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
        return new EventsController() as unknown as T;
      case PreprocessingController:
        return new PreprocessingController() as unknown as T;
      case HealthController:
        return new HealthController() as unknown as T;
      default:
        return new Controller();
    }
  },
};
