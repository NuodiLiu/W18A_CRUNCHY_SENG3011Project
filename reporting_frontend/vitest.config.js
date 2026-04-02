import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/contract/**/*.test.js"],
    reporters: ["default", "junit"],
    outputFile: {
      junit: "reports/contract/junit.xml",
    },
  },
});
