import { jest } from "@jest/globals";
import { debounce, isRelevantChange } from "../../../src/core/watcher.js";

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
