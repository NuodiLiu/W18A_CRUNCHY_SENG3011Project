import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  moduleNameMapper: {
    "^@config/(.*)$": "<rootDir>/src/config/$1",
    "^@http/(.*)$": "<rootDir>/src/http/$1",
    "^@application/(.*)$": "<rootDir>/src/application/$1",
    "^@domain/(.*)$": "<rootDir>/src/domain/$1",
    "^@infra/(.*)$": "<rootDir>/src/infra/$1",
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/main.ts",
    "!src/worker.ts",
  ],
  coverageDirectory: "coverage",
  testTimeout: 30_000,
};

export default config;
