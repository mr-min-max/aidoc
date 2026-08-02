import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const RAW_SENTINEL = "AIDOC_DEMO_RAW_SOURCE_MUST_NOT_LEAK";
const MAX_BUFFER = 4 * 1024 * 1024;

function credentialFreeEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.OPENAI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  delete env.AIDOC_OLLAMA_HOST;
  return env;
}

async function run(command, args, options) {
  const { stdout } = await execFile(command, args, {
    ...options,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  return stdout.trim();
}

async function commit(repository, hooks, message) {
  const gitEnv = credentialFreeEnv({
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  });
  const git = (args) =>
    run(
      "git",
      ["-c", "commit.gpgSign=false", "-c", `core.hooksPath=${hooks}`, ...args],
      { cwd: repository, env: gitEnv },
    );
  await git(["add", "."]);
  await git(["commit", "--quiet", "-m", message]);
  return git(["rev-parse", "HEAD"]);
}

function validateDemo(human, result) {
  assert.equal(result?.ok, true, "demo planning must succeed");
  assert.equal(typeof result.plan, "object", "demo must return a plan");
  assert.match(human, /^Documentation impact: 2 public API changes/u);
  assert.match(human, /Context: \d+ \/ 12000 bytes/u);
  assert.match(human, /Next: aidoc update/u);
  assert.equal(
    result.plan.changes.filter(
      (change) => change.category === "contract-changed",
    ).length,
    1,
    "demo must contain one contract change",
  );
  assert.equal(
    result.plan.changes.filter(
      (change) => change.category === "implementation-changed",
    ).length,
    1,
    "demo must contain one implementation change",
  );
  assert.equal(
    JSON.stringify(result).includes(RAW_SENTINEL),
    false,
    "demo plan must not expose raw source",
  );
}

export async function runImpactDemo({ cliPath, quiet = false }) {
  const resolvedCli = resolve(cliPath);
  const root = await mkdtemp(join(tmpdir(), "aidoc-impact-demo-"));
  const repository = join(root, "repository");
  const template = join(root, "git-template");
  const hooks = join(template, "hooks");

  try {
    await mkdir(join(repository, "src"), { recursive: true });
    await mkdir(hooks, { recursive: true });
    await run(
      "git",
      ["init", "--quiet", "--initial-branch=main", `--template=${template}`],
      { cwd: repository, env: credentialFreeEnv() },
    );
    await run("git", ["config", "user.name", "aidoc demo"], {
      cwd: repository,
      env: credentialFreeEnv(),
    });
    await run("git", ["config", "user.email", "aidoc@example.invalid"], {
      cwd: repository,
      env: credentialFreeEnv(),
    });

    await writeFile(
      join(repository, "README.md"),
      "# Demo API\n\nSee [`formatName`](src/index.ts).\n",
    );
    await writeFile(
      join(repository, "src", "index.ts"),
      [
        "export function formatName(name: string): string {",
        `  return \`Hello \${name} ${RAW_SENTINEL}\`;`,
        "}",
        "export function doubled(value: number): number {",
        "  return value * 2;",
        "}",
        "",
      ].join("\n"),
    );
    const base = await commit(repository, hooks, "demo: base");

    await writeFile(
      join(repository, "src", "index.ts"),
      [
        "export function formatName(name: string, excited = false): string {",
        `  return \`Hello \${name} ${RAW_SENTINEL}\`;`,
        "}",
        "export function doubled(value: number): number {",
        "  return value * 3;",
        "}",
        "",
      ].join("\n"),
    );
    const head = await commit(repository, hooks, "demo: head");
    const commonArgs = ["plan", "--base", base, "--head", head];
    const env = credentialFreeEnv();
    const human = await run(process.execPath, [resolvedCli, ...commonArgs], {
      cwd: repository,
      env,
    });
    const json = await run(
      process.execPath,
      [resolvedCli, ...commonArgs, "--json"],
      { cwd: repository, env },
    );
    const result = JSON.parse(json);
    validateDemo(human, result);

    if (!quiet) {
      process.stdout.write(`${human}\n\n${json}\n`);
    }
    return { human, plan: result.plan };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const quiet = process.argv.slice(2).includes("--verify");
  runImpactDemo({
    cliPath: join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "dist",
      "cli",
      "index.js",
    ),
    quiet,
  }).catch((error) => {
    process.stderr.write(
      `Impact demo failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
}
