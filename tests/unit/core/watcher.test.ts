jest.mock("chokidar", () => ({
  __esModule: true,
  default: { watch: jest.fn() },
}));

import { debounce, isRelevantChange } from "../../../src/core/watcher";
import * as analyzer from "../../../src/core/analyzer";
import { createWatchRegenerator } from "../../../src/cli/commands/watch";
import { defaultConfig } from "../../../src/config/loader";
import type { RepositoryWriteScope } from "../../../src/security/repository-writer";

describe("debounce", () => {
  jest.useFakeTimers();

  it("coalesces rapid calls into one", () => {
    const fn = jest.fn();
    const d = debounce(fn, 300);
    d();
    d();
    d();
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("isRelevantChange", () => {
  it("includes source files", () => {
    expect(isRelevantChange("src/index.ts")).toBe(true);
    expect(isRelevantChange("src/app.py")).toBe(true);
  });
  it("excludes tests, dist, node_modules", () => {
    expect(isRelevantChange("src/foo.test.ts")).toBe(false);
    expect(isRelevantChange("dist/x.js")).toBe(false);
    expect(isRelevantChange("node_modules/y.js")).toBe(false);
  });
});

describe("watch regeneration", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Break caught: a long-running watch reuses a consumed prepared target, or
  // generates provider output before capturing the snapshot it will replace.
  it("prepares a fresh one-shot target before every provider call", async () => {
    const events: string[] = [];
    const firstTarget = {
      displayPath: "README.md",
      existingText: null,
      replaceText: jest.fn(async () => {
        events.push("replace:first");
      }),
    };
    const secondTarget = {
      displayPath: "README.md",
      existingText: "# First\n",
      replaceText: jest.fn(async () => {
        events.push("replace:second");
      }),
    };
    const prepare = jest
      .fn()
      .mockImplementationOnce(async () => {
        events.push("prepare:first");
        return firstTarget;
      })
      .mockImplementationOnce(async () => {
        events.push("prepare:second");
        return secondTarget;
      });
    const generateReadme = jest.fn(async () => {
      events.push("generate");
      return "# Generated\n";
    });
    jest.spyOn(analyzer, "analyzeCodebase").mockResolvedValue([]);
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    const regenerate = createWatchRegenerator(
      {
        config: defaultConfig,
        cwd: process.cwd(),
        generator: { generateReadme },
        isMock: true,
      },
      { prepare } as unknown as RepositoryWriteScope,
      "./README.md",
      { auto: true },
    );

    await regenerate();
    await regenerate();

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare).toHaveBeenNthCalledWith(1, "./README.md");
    expect(prepare).toHaveBeenNthCalledWith(2, "./README.md");
    expect(firstTarget.replaceText).toHaveBeenCalledTimes(1);
    expect(secondTarget.replaceText).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      "prepare:first",
      "generate",
      "replace:first",
      "prepare:second",
      "generate",
      "replace:second",
    ]);
  });
});
