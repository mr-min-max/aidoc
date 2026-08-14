import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import process from "node:process";

const TARBALL_ENV = "AIDOC_TEST_TARBALL";

/** Returns a validated prebuilt tarball, or null for the local pack fallback. */
export function getConfiguredSmokeTarball(env = process.env) {
  if (!Object.prototype.hasOwnProperty.call(env, TARBALL_ENV)) {
    return null;
  }

  const tarball = env[TARBALL_ENV];
  if (typeof tarball !== "string" || !isAbsolute(tarball)) {
    throw new Error(`${TARBALL_ENV} must be an absolute path`);
  }
  if (!tarball.endsWith(".tgz")) {
    throw new Error(`${TARBALL_ENV} must point to a .tgz file`);
  }
  if (!existsSync(tarball) || !statSync(tarball).isFile()) {
    throw new Error(`${TARBALL_ENV} must point to an existing file`);
  }

  return tarball;
}

/** Verifies that the packed artifact contains the provider-free MCP runtime. */
export function assertPackedMcpArtifacts(packageRoot) {
  const requiredFiles = [
    "dist/mcp/server.js",
    "dist/mcp/repository-scope.js",
    "dist/mcp/scoped-config.js",
    "dist/mcp/scoped-freshness.js",
    "dist/mcp/preparation-token.js",
    "dist/mcp/update-workflow.js",
    "dist/core/update-preparation.js",
    "dist/templates/update.hbs",
  ];
  for (const relativePath of requiredFiles) {
    const absolutePath = join(packageRoot, relativePath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      throw new Error(`Packed MCP artifact is missing: ${relativePath}`);
    }
  }
}
