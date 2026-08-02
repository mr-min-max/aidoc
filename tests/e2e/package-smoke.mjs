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
import { runImpactDemo } from "../../scripts/demo-impact.mjs";

const rawSentinel = "AIDOC_RAW_SOURCE_MUST_NOT_LEAK";

function credentialFreeEnv() {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  delete env.AIDOC_OLLAMA_HOST;
  return env;
}

function commitFixture(repository, hooks, message) {
  const git = (...args) =>
    execFileSync(
      "git",
      ["-c", "commit.gpgSign=false", "-c", `core.hooksPath=${hooks}`, ...args],
      {
        cwd: repository,
        encoding: "utf8",
        env: {
          ...credentialFreeEnv(),
          GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
          GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  git("add", ".");
  git("commit", "-m", message);
  return git("rev-parse", "HEAD");
}

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

  const fixture = join(root, "impact-fixture");
  const gitTemplate = join(root, "empty-git-template");
  const hooks = join(gitTemplate, "hooks");
  mkdirSync(join(fixture, "src"), { recursive: true });
  mkdirSync(hooks, { recursive: true });
  execFileSync(
    "git",
    ["init", "--quiet", "--initial-branch=main", `--template=${gitTemplate}`],
    { cwd: fixture, env: credentialFreeEnv(), stdio: "pipe" },
  );
  execFileSync("git", ["config", "user.name", "aidoc smoke"], {
    cwd: fixture,
  });
  execFileSync("git", ["config", "user.email", "aidoc@example.invalid"], {
    cwd: fixture,
  });
  writeFileSync(
    join(fixture, "README.md"),
    "# API\n\nSee [`formatName`](src/index.ts).\n",
  );
  writeFileSync(
    join(fixture, "src", "index.ts"),
    [
      "export function formatName(name: string): string {",
      `  return \`Hello \${name} ${rawSentinel}\`;`,
      "}",
      "export function doubled(value: number): number {",
      "  return value * 2;",
      "}",
      "",
    ].join("\n"),
  );
  const base = commitFixture(fixture, hooks, "fixture: base");
  writeFileSync(
    join(fixture, "src", "index.ts"),
    [
      "export function formatName(name: string, excited = false): string {",
      `  return \`Hello \${name} ${rawSentinel}\`;`,
      "}",
      "export function doubled(value: number): number {",
      "  return value * 3;",
      "}",
      "",
    ].join("\n"),
  );
  const head = commitFixture(fixture, hooks, "fixture: head");
  const planOutput = execFileSync(
    process.execPath,
    [packedCli, "plan", "--base", base, "--head", head, "--json"],
    {
      cwd: fixture,
      encoding: "utf8",
      env: credentialFreeEnv(),
    },
  );
  const planResult = JSON.parse(planOutput);
  assert.equal(planResult.ok, true);
  assert.equal(
    planResult.plan.changes.filter(
      (change) => change.category === "contract-changed",
    ).length,
    1,
  );
  assert.equal(
    planResult.plan.changes.filter(
      (change) => change.category === "implementation-changed",
    ).length,
    1,
  );
  assert.equal(planOutput.includes(rawSentinel), false);

  const demo = await runImpactDemo({ cliPath: packedCli, quiet: true });
  assert.match(demo.human, /^Documentation impact: 2 public API changes/u);
  assert.match(demo.human, /Context: \d+ \/ 12000 bytes/u);
  assert.match(demo.human, /Next: aidoc update/u);
  assert.equal(
    demo.plan.changes.filter((change) => change.category === "contract-changed")
      .length,
    1,
  );
  assert.equal(
    demo.plan.changes.filter(
      (change) => change.category === "implementation-changed",
    ).length,
    1,
  );
  assert.equal(JSON.stringify(demo.plan).includes(rawSentinel), false);
} finally {
  rmSync(root, { recursive: true, force: true });
}
