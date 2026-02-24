import { loadConfig } from "./config/index.js";
import { createApp } from "./http/app.js";

const config = loadConfig();

// Build Express app
const app = createApp();

app.listen(config.port, () => {
  console.log(`[API] listening on :${config.port}`);
});
