import { ASTCache } from "../../../src/core/cache.js";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("ASTCache", () => {
  let cache: ASTCache;
  const fixturePath = path.resolve(__dirname, "../../fixtures/sample.ts");

  beforeEach(() => {
    cache = new ASTCache();
  });

  const mockModule = {
    filePath: fixturePath,
    language: "typescript",
    functions: [],
    classes: [],
    types: [],
    imports: [],
  };

  it("should return null for uncached files", () => {
    expect(cache.get(fixturePath)).toBeNull();
  });

  it("should cache and retrieve modules", () => {
    cache.set(fixturePath, mockModule);
    const result = cache.get(fixturePath);
    expect(result).toEqual(mockModule);
  });

  it("should return null for non-existent files", () => {
    cache.set("/nonexistent/file.ts", mockModule);
    expect(cache.get("/nonexistent/file.ts")).toBeNull();
  });

  it("should track cache statistics", () => {
    cache.set(fixturePath, mockModule);
    cache.get(fixturePath); // hit
    cache.get("/missing.ts"); // miss

    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.size).toBe(1);
  });

  it("should clear all entries", () => {
    cache.set(fixturePath, mockModule);
    cache.clear();
    expect(cache.get(fixturePath)).toBeNull();
    expect(cache.stats().size).toBe(0);
  });
});
