import * as fs from "fs";
import * as path from "path";

interface PackageMetadata {
  version?: unknown;
}

export function readPackageVersion(moduleDir = __dirname): string {
  const packagePath = path.resolve(moduleDir, "../../package.json");
  const metadata = JSON.parse(
    fs.readFileSync(packagePath, "utf8"),
  ) as PackageMetadata;

  if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    throw new Error(`Invalid package version in ${packagePath}`);
  }

  return metadata.version;
}
