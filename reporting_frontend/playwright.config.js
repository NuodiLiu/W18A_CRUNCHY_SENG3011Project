import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  reporter: [["list"], ["junit", { outputFile: "reports/e2e/junit.xml" }], ["html", { outputFolder: "reports/e2e/html", open: "never" }]],
  use: {
    baseURL: "http://localhost:5500",
    headless: true,
  },
  webServer: {
    command: "npx serve . -l 5500 --no-clipboard",
    port: 5500,
    reuseExistingServer: true,
  },
});
