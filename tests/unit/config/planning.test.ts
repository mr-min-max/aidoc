import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  loadPlanningConfig,
  parseContextBudget,
} from "../../../src/config/planning";
import { ConfigSchema } from "../../../src/config/schema";

describe("planning configuration", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "aidoc-planning-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("selects safe fields from a config without evaluating provider getters", async () => {
    await fs.writeFile(
      path.join(root, ".aidocrc.cjs"),
      `module.exports = { include: ["src/**"], exclude: ["src/vendor/**"], outputDir: "./api", maxContextBytes: 1024,
        get provider() { throw new Error("credential sentinel"); },
        get apiKey() { throw new Error("credential sentinel"); },
        get model() { throw new Error("credential sentinel"); },
        get trustPolicy() { throw new Error("credential sentinel"); },
        get ollamaHost() { throw new Error("credential sentinel"); },
        get templates() { throw new Error("credential sentinel"); } };`,
    );

    expect(loadPlanningConfig(root)).toEqual({
      include: ["src/**"],
      exclude: ["src/vendor/**"],
      outputDir: "./api",
      maxContextBytes: 1024,
    });
  });

  it("uses safe defaults and ignores provider environment variables", () => {
    const config = loadPlanningConfig(root);
    expect(config).toEqual({
      include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/.git/**",
        "**/coverage/**",
        "**/tests/**",
        "**/*.test.*",
        "**/*.spec.*",
        "**/package-lock.json",
        "**/yarn.lock",
      ],
      outputDir: "./docs",
      maxContextBytes: 12000,
    });
  });

  it.each([1024, 12000, 1048576])(
    "accepts exact context budget %s",
    (value) => {
      expect(parseContextBudget(value)).toBe(value);
      expect(loadPlanningConfig(root, value).maxContextBytes).toBe(value);
    },
  );

  it.each([1023, 1048577, 1.5, "1e4", "", "nope", null, undefined, true])(
    "rejects invalid context budget %p with a stable error",
    (value) => {
      expect(() => parseContextBudget(value)).toThrow(
        "PLAN_INVALID_CONTEXT_BUDGET",
      );
    },
  );

  it("falls back atomically when safe fields are malformed", async () => {
    await fs.writeFile(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({
        include: "src/**",
        outputDir: 42,
        maxContextBytes: 1024,
      }),
    );
    expect(loadPlanningConfig(root)).toEqual(
      loadPlanningConfig(path.join(root, "missing")),
    );
  });

  it("rejects an invalid budget in a discovered config", async () => {
    await fs.writeFile(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({ include: ["src/**"], maxContextBytes: 1023 }),
    );
    expect(() => loadPlanningConfig(root)).toThrow(
      "PLAN_INVALID_CONTEXT_BUDGET",
    );
  });

  it("keeps the full schema budget validation provider-independent", () => {
    expect(ConfigSchema.parse({}).maxContextBytes).toBe(12000);
    expect(() => ConfigSchema.parse({ maxContextBytes: 1023 })).toThrow();
  });
});
