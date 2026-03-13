import type { Config } from "jest";

const shared = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { diagnostics: { ignoreCodes: [151002] } }],
  },
  moduleNameMapper: {
    "^@config/(.*)$": "<rootDir>/src/config/$1",
    "^@http/(.*)$": "<rootDir>/src/http/$1",
    "^@application/(.*)$": "<rootDir>/src/application/$1",
    "^@domain/(.*)$": "<rootDir>/src/domain/$1",
    "^@infra/(.*)$": "<rootDir>/src/infra/$1",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/main.ts",
    "!src/worker.ts",
  ],
  coverageDirectory: "coverage",
} satisfies Partial<Config>;

const config: Config = {
  testTimeout: 30_000,
  projects: [
    {
      ...shared,
      displayName: "unit",
      roots: ["<rootDir>/tests/unit"],
      // No setupFiles — unit tests must run with a clean environment
    },
    {
      ...shared,
      displayName: "integration",
      roots: ["<rootDir>/tests/integration"],
      setupFiles: ["dotenv/config"], // loads .env for LocalStack endpoints
    },
  ],
};

export default config;
