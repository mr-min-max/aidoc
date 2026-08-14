import { cosmiconfigSync } from "cosmiconfig";

export interface PlanningConfig {
  include: string[];
  exclude: string[];
  outputDir: string;
  maxContextBytes: number;
}

const DEFAULT_INCLUDE = [
  "**/*.ts",
  "**/*.tsx",
  "**/*.js",
  "**/*.jsx",
  "**/*.py",
];
const DEFAULT_EXCLUDE = [
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
];
const DEFAULT_OUTPUT_DIR = "./docs";
const DEFAULT_CONTEXT_BYTES = 12000;

/** Returns a fresh planning configuration with the repository scan defaults. */
export function defaultPlanningConfig(): PlanningConfig {
  return {
    include: [...DEFAULT_INCLUDE],
    exclude: [...DEFAULT_EXCLUDE],
    outputDir: DEFAULT_OUTPUT_DIR,
    maxContextBytes: DEFAULT_CONTEXT_BYTES,
  };
}

/** Validates the bounded provider-context byte budget used by planning. */
export function parseContextBudget(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1024 ||
    value > 1048576
  ) {
    throw new Error("PLAN_INVALID_CONTEXT_BUDGET");
  }
  return value;
}

function safeOwnValue(config: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(config, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

/** Parses planning fields defensively and fills omitted fields from defaults. */
export function parsePlanningConfig(value: unknown): PlanningConfig {
  const result = defaultPlanningConfig();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid planning config");
  }

  const include = safeOwnValue(value, "include");
  const exclude = safeOwnValue(value, "exclude");
  const outputDir = safeOwnValue(value, "outputDir");
  const budget = safeOwnValue(value, "maxContextBytes");

  if (include !== undefined) {
    if (
      !Array.isArray(include) ||
      !include.every((item) => typeof item === "string")
    ) {
      throw new Error("invalid planning config");
    }
    result.include = [...include];
  }
  if (exclude !== undefined) {
    if (
      !Array.isArray(exclude) ||
      !exclude.every((item) => typeof item === "string")
    ) {
      throw new Error("invalid planning config");
    }
    result.exclude = [...exclude];
  }
  if (outputDir !== undefined) {
    if (typeof outputDir !== "string" || outputDir.length === 0) {
      throw new Error("invalid planning config");
    }
    result.outputDir = outputDir;
  }
  if (budget !== undefined) result.maxContextBytes = parseContextBudget(budget);
  return result;
}

/** Loads ordinary CLI planning configuration and applies an optional budget override. */
export function loadPlanningConfig(
  cwd: string,
  overrideMaxContextBytes?: unknown,
): PlanningConfig {
  const override =
    overrideMaxContextBytes === undefined
      ? undefined
      : parseContextBudget(overrideMaxContextBytes);
  let config = defaultPlanningConfig();
  try {
    const result = cosmiconfigSync("aidoc").search(cwd);
    if (result && !result.isEmpty) {
      config = parsePlanningConfig(result.config);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "PLAN_INVALID_CONTEXT_BUDGET"
    ) {
      throw error;
    }
    config = defaultPlanningConfig();
  }
  if (override !== undefined) config.maxContextBytes = override;
  return config;
}
