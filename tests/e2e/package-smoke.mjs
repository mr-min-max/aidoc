import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import process from "node:process";
import { getConfiguredSmokeTarball } from "./smoke-tarball.mjs";

const root = mkdtempSync(join(tmpdir(), "aidoc-package-smoke-"));

try {
  let tarball = getConfiguredSmokeTarball();
  if (tarball === null) {
    const packOutput = execFileSync(
      "npm",
      ["pack", "--json", "--pack-destination", root],
      { cwd: resolve("."), encoding: "utf8" },
    );
    const [{ filename }] = JSON.parse(packOutput);
    tarball = join(root, filename);
  }

  const consumer = join(root, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "aidoc-smoke-consumer", private: true }),
  );
  execFileSync("npm", ["install", "--ignore-scripts", tarball], {
    cwd: consumer,
    stdio: "pipe",
  });

  const packageRoot = join(consumer, "node_modules", "aidoc-gen");
  const require = createRequire(import.meta.url);
  const { resolveTemplatesDir } = require(
    join(packageRoot, "dist", "core", "templates.js"),
  );
  const { Generator } = require(
    join(packageRoot, "dist", "core", "generator.js"),
  );

  const provider = {
    name: "package-smoke",
    async generate(prompt) {
      return prompt;
    },
  };
  const generator = new Generator(provider, resolveTemplatesDir());
  const rendered = await generator.generateReadme({
    projectName: "package-smoke",
    description: "packed artifact",
    modules: [],
    dependencies: [],
    badges: false,
    tableOfContents: false,
    installSection: false,
    usageExamples: false,
  });

  assert.match(rendered, /PROJECT INFO:/);
  assert.match(rendered, /package-smoke/);
  const packedPackage = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  );
  assert.equal(packedPackage.name, "aidoc-gen");
  assert.equal(packedPackage.engines.node, ">=22.12.0");
  const packedCli = join(packageRoot, "dist", "cli", "index.js");
  const cliVersion = execFileSync(process.execPath, [packedCli, "--version"], {
    cwd: consumer,
    encoding: "utf8",
  }).trim();
  assert.equal(cliVersion, packedPackage.version);
} finally {
  rmSync(root, { recursive: true, force: true });
}
