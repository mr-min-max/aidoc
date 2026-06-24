import { scanFiles } from "../../../src/core/scanner";
import * as path from "path";

describe("scanFiles", () => {
  const fixturesDir = path.resolve(__dirname, "../../fixtures");

  it("should find TypeScript files", async () => {
    const files = await scanFiles(fixturesDir, ["**/*.ts"], []);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.some((f) => f.endsWith("sample.ts"))).toBe(true);
  });

  it("should respect exclude patterns", async () => {
    const files = await scanFiles(fixturesDir, ["**/*.ts"], ["**/sample.ts"]);
    expect(files.some((f) => f.endsWith("sample.ts"))).toBe(false);
  });

  it("should return absolute paths", async () => {
    const files = await scanFiles(fixturesDir, ["**/*.ts"], []);
    files.forEach((f) => expect(path.isAbsolute(f)).toBe(true));
  });
});
