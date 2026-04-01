import type { Config } from "jest";

const shared = {
  preset: "ts-jest",
  testEnvironment: "node",
  testEnvironmentOptions: {
    env: { LOG_LEVEL: "silent" },
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.test.json", diagnostics: { ignoreCodes: [151002] } }],
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
  reporters: [
    "default",
    [
      "jest-junit",
      {
        outputDirectory: process.env.JEST_JUNIT_OUTPUT_DIR ?? "reports",
        outputName: "junit.xml",
        classNameTemplate: "{classname}",
        titleTemplate: "{title}",
        ancestorSeparator: " › ",
        addFileAttribute: "true",
      },
    ],
    [
      "jest-html-reporter",
      {
        outputPath: process.env.JEST_HTML_REPORTER_OUTPUT_PATH ?? "reports/report.html",
        pageTitle: "Test Report",
        includeFailureMsg: true,
        includeConsoleLog: true,
        sort: "status",
      },
    ],
  ],
  projects: [
    {
      ...shared,
      displayName: "unit",
      roots: ["<rootDir>/tests/unit"],
      setupFiles: ["<rootDir>/tests/setup-silent-logs.ts"],
    },
    {
      ...shared,
      displayName: "integration",
      roots: ["<rootDir>/tests/integration"],
      setupFiles: ["<rootDir>/tests/setup-silent-logs.ts", "dotenv/config"],
    },
  ],
};

export default config;
