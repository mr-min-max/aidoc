/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  extensionsToTreatAsEsm: [".ts"],
  // Source uses `.js` specifiers (required by NodeNext) that resolve to `.ts`
  // files during tests. Strip the extension so Jest finds the TypeScript source.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        diagnostics: false,
      },
    ],
  },
  collectCoverageFrom: ["src/**/*.ts", "!src/cli/index.ts", "!src/**/types.ts"],
  coverageThreshold: {
    global: { branches: 50, functions: 60, lines: 60, statements: 60 },
  },
};
