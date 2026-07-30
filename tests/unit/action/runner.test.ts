import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const runner = path.resolve("action/run.sh");

function setupFakeAidoc(root: string): string {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  const fake = path.join(bin, "aidoc");
  fs.writeFileSync(
    fake,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$AIDOC_FAKE_LOG"
if [ "\${AIDOC_FAKE_EXIT:-0}" != "0" ]; then
  exit "$AIDOC_FAKE_EXIT"
fi
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then output="$2"; shift 2; else shift; fi
done
if [ -n "$output" ]; then
  mkdir -p "$(dirname "$output")"
  printf '# generated\n' > "$output"
fi
`,
  );
  fs.chmodSync(fake, 0o755);
  return bin;
}

function runRunner(overrides: NodeJS.ProcessEnv = {}): {
  status: number | null;
  log: string;
  output: string;
  changedFiles: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-action-"));
  const bin = setupFakeAidoc(root);
  const log = path.join(root, "aidoc.log");
  const githubOutput = path.join(root, "github-output");
  const changedFiles = path.join(root, "changed-files");
  const result = spawnSync("bash", [runner], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      AIDOC_FAKE_LOG: log,
      GITHUB_OUTPUT: githubOutput,
      AIDOC_CHANGED_FILES_FILE: changedFiles,
      AIDOC_INPUT_PROVIDER: "openai",
      AIDOC_INPUT_API_KEY: "fake-openai-key-for-tests",
      AIDOC_INPUT_MODEL: "test-model",
      AIDOC_INPUT_COMMANDS: "readme",
      AIDOC_INPUT_MODE: "generate",
      AIDOC_INPUT_OUTPUT_DIR: "./docs",
      AIDOC_INPUT_DRY_RUN: "false",
      AIDOC_INPUT_SINCE: "HEAD~1",
      ...overrides,
    },
  });

  const response = {
    status: result.status,
    log: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "",
    output: fs.existsSync(githubOutput)
      ? fs.readFileSync(githubOutput, "utf8")
      : "",
    changedFiles: fs.existsSync(changedFiles)
      ? fs.readFileSync(changedFiles, "utf8")
      : "",
  };
  fs.rmSync(root, { recursive: true, force: true });
  return response;
}

describe("action/run.sh", () => {
  it("propagates generation failures", () => {
    const result = runRunner({ AIDOC_FAKE_EXIT: "23" });
    expect(result.status).toBe(23);
  });

  it("fails generation when a remote provider credential is missing", () => {
    const result = runRunner({ AIDOC_INPUT_API_KEY: "" });
    expect(result.status).toBe(2);
    expect(result.log).toBe("");
  });

  it("rejects an invalid dry-run input before invoking aidoc", () => {
    const result = runRunner({ AIDOC_INPUT_DRY_RUN: "yes" });

    expect(result.status).toBe(2);
    expect(result.log).toBe("");
  });

  it("uses the real command path without --mock", () => {
    const result = runRunner();
    expect(result.status).toBe(0);
    expect(result.log).toContain(
      "readme --output ./README.md --yes --strict-output",
    );
    expect(result.log).not.toContain("--mock");
    expect(result.output).toContain("changed=true");
    expect(result.changedFiles.trim()).toBe("./README.md");
  });

  it("uses deterministic check mode without an API key", () => {
    const result = runRunner({
      AIDOC_INPUT_MODE: "check",
      AIDOC_INPUT_API_KEY: "",
    });
    expect(result.status).toBe(0);
    expect(result.log).toContain("check --target ./README.md --since HEAD~1");
    expect(result.log).not.toContain("--mock");
  });
});

describe("composite Action package", () => {
  it("publishes action.yml at the repository root used by owner/repo@ref", () => {
    expect(fs.existsSync(path.resolve("action.yml"))).toBe(true);
  });

  it("links composite outputs to the runner step", () => {
    const metadata = fs.readFileSync(path.resolve("action.yml"), "utf8");
    expect(metadata).toMatch(/\bid: aidoc\b/);
    for (const output of ["changed", "files", "summary"]) {
      expect(metadata).toContain(
        `value: \${{ steps.aidoc.outputs.${output} }}`,
      );
    }
  });

  it("stages only paths emitted by aidoc", () => {
    const metadata = fs.readFileSync(path.resolve("action.yml"), "utf8");
    expect(metadata).not.toContain("git add -A");
    expect(metadata).toContain("git diff --cached --quiet");
    expect(metadata).toContain('git add -- "$file"');
  });

  it("installs the npm version declared by the same Action ref", () => {
    const metadata = fs.readFileSync(path.resolve("action.yml"), "utf8");
    expect(metadata).toContain("require('./package.json').version");
    expect(metadata).toContain("aidoc-gen@$version");
  });
});
