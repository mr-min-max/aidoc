import * as path from "path";
import packageJson from "../../../package.json";
import { readPackageVersion } from "../../../src/core/package-meta";

describe("readPackageVersion", () => {
  it("matches the installed root package metadata", () => {
    const moduleDir = path.resolve("src/core");
    expect(readPackageVersion(moduleDir)).toBe(packageJson.version);
  });
});
