import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const runner = path.resolve("action/run.sh");
const fakeOpenAiKey = ["fake", "openai", "key", "for", "tests"].join("-");
const fakeValidationCredential = ["sk", "proj", "V".repeat(32)].join("-");

function setupFakeAidoc(root: string): string {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  const fake = path.join(bin, "aidoc");
  fs.writeFileSync(
    fake,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$AIDOC_FAKE_LOG"
printf 'trust-policy=%s\norigin=%s\n' "\${AIDOC_TRUST_POLICY:-}" "\${AIDOC_ORIGIN:-}" >> "$AIDOC_FAKE_LOG"
if [ "$1" = "review" ]; then
  format="text"
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--format" ]; then format="$2"; shift 2; else shift; fi
  done
  review_exit="\${AIDOC_FAKE_EXIT:-0}"
  case "$format" in
    json)
      review_exit="\${AIDOC_FAKE_REVIEW_JSON_EXIT:-\${AIDOC_FAKE_EXIT:-0}}"
      if [ "\${AIDOC_FAKE_REVIEW_ZERO:-false}" = "true" ]; then
        printf '%s\n' '{"schemaVersion":"aidoc.review.v1","base":{"type":"git","label":"base","commit":"base"},"head":{"type":"working-tree","label":"working tree"},"summary":{"publicApiChanges":0,"breaking":0,"staleDocuments":0,"coChangedDocuments":0,"unmappedSymbols":0,"suppressed":0},"changes":[],"documents":[],"unmapped":[],"suppressed":[],"verdict":"clean"}'
      else
        printf '%s\n' '{"schemaVersion":"aidoc.review.v1","base":{"type":"git","label":"base","commit":"base"},"head":{"type":"working-tree","label":"working tree"},"summary":{"publicApiChanges":1,"breaking":0,"staleDocuments":1,"coChangedDocuments":0,"unmappedSymbols":0,"suppressed":0},"changes":[{"id":"x","qualifiedName":"createUser","kind":"function","category":"contract-changed","risk":"review-required","path":"src/user.ts","before":"createUser(email: string): string","after":"createUser(email: string, role: string): string"}],"documents":[{"path":"README.md","status":"stale","sections":[{"section":"API","slug":"api","symbols":["createUser"]}]}],"unmapped":[],"suppressed":[],"verdict":"stale"}'
      fi
      ;;
    markdown)
      review_exit="\${AIDOC_FAKE_REVIEW_MARKDOWN_EXIT:-\${AIDOC_FAKE_EXIT:-0}}"
      printf '%s\n' '<!-- aidoc-review -->' '### AiDoc: documentation impact' '**1 public API change**'
      ;;
    *)
      review_exit="\${AIDOC_FAKE_REVIEW_TEXT_EXIT:-\${AIDOC_FAKE_EXIT:-0}}"
      printf '%s\n' 'AiDoc: documentation impact (stale)' 'createUser: parameters'
      ;;
  esac
  exit "$review_exit"
fi
if [ "$1" = "check" ]; then
  if [ "\${AIDOC_FAKE_CHECK_RESULT:-clean}" = "stale" ]; then
    printf '%s\n' '{"status":"stale","target":"README.md","targetChanged":false,"referencedSymbols":["createUser"],"sections":[{"section":"API","slug":"api","symbols":["createUser"]}],"unmappedSymbols":[],"sourceFiles":["src/user.ts"],"message":"README.md is stale for changed public symbols"}'
  else
    printf '%s\n' '{"status":"clean","target":"README.md","targetChanged":false,"referencedSymbols":[],"sections":[],"unmappedSymbols":[],"sourceFiles":[],"message":"No changed public symbol is mentioned in README.md"}'
  fi
  exit "\${AIDOC_FAKE_EXIT:-0}"
fi
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

function setupFakeGh(root: string): string {
  const bin = path.join(root, "gh-bin");
  fs.mkdirSync(bin);
  const fake = path.join(bin, "gh");
  fs.writeFileSync(
    fake,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$AIDOC_GH_LOG"
if [ "\${AIDOC_GH_MODE:-}" = "forbidden" ] && { [[ "$*" == *"-X POST"* ]] || [[ "$*" == *"-X PATCH"* ]] || [[ "$*" == *"-X DELETE"* ]] || [[ "$1" = "label" ]]; }; then
  printf '%s\n' '403 Forbidden' >&2
  exit 1
fi
if [ "\${AIDOC_GH_MODE:-}" = "failure" ]; then
  printf '%s\n' '500 Server Error' >&2
  exit 1
fi
if [ "\${AIDOC_GH_MODE:-}" = "comment-post" ] && [[ "$*" == *"-X POST"* ]] && [[ "$*" == *"/comments"* ]]; then
  printf '%s\n' '500 Server Error' >&2
  exit 1
fi
if [ "\${AIDOC_GH_MODE:-}" = "comment-patch" ] && [[ "$*" == *"-X PATCH"* ]] && [[ "$*" == *"/comments/"* ]]; then
  printf '%s\n' '500 Server Error' >&2
  exit 1
fi
if [ "\${AIDOC_GH_MODE:-}" = "label-create" ] && [ "$1" = "label" ]; then
  printf '%s\n' '500 Server Error' >&2
  exit 1
fi
if [ "\${AIDOC_GH_MODE:-}" = "label-add" ] && [[ "$*" == *"-X POST"* ]] && [[ "$*" == *"/labels"* ]]; then
  printf '%s\n' '500 Server Error' >&2
  exit 1
fi
if [ "\${AIDOC_GH_MODE:-}" = "label-delete" ] && [[ "$*" == *"-X DELETE"* ]] && [[ "$*" == *"/labels/"* ]]; then
  printf '%s\n' '500 Server Error' >&2
  exit 1
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then
  printf '%s\n' 'github-actions[bot]'
elif [ "$1" = "api" ] && [[ "$*" == *"/comments"* ]] && [[ "$*" != *"/comments/"* ]]; then
  printf '%s\n' "\${AIDOC_GH_COMMENTS:-[]}"
fi
`,
  );
  fs.chmodSync(fake, 0o755);
  return bin;
}

interface RunnerResult {
  status: number | null;
  log: string;
  ghLog: string;
  stderr: string;
  stdout: string;
  output: string;
  changedFiles: string;
  summary: string;
  report: string;
}

function runRunner(overrides: NodeJS.ProcessEnv = {}): RunnerResult {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-action-"));
  const bin = setupFakeAidoc(root);
  const ghBin = setupFakeGh(root);
  const log = path.join(root, "aidoc.log");
  const ghLog = path.join(root, "gh.log");
  const githubOutput = path.join(root, "github-output");
  const changedFiles = path.join(root, "changed-files");
  const summary = path.join(root, "summary");
  const temp = path.join(root, "temp");
  fs.mkdirSync(temp);
  if (overrides.AIDOC_INPUT_MODE === "review") {
    spawnSync("git", ["init", "-q", "--initial-branch", "main"], { cwd: root });
    spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
    spawnSync("git", ["config", "user.name", "test"], { cwd: root });
    fs.writeFileSync(path.join(root, "README.md"), "# test\n");
    spawnSync("git", ["add", "README.md"], { cwd: root });
    spawnSync("git", ["commit", "-qm", "fixture"], { cwd: root });
    fs.writeFileSync(path.join(root, "README.md"), "# changed\n");
    spawnSync("git", ["commit", "-qam", "second"], { cwd: root });
  }
  const inheritedEnvironment = { ...process.env };
  delete inheritedEnvironment.AIDOC_INPUT_TRUST_POLICY;
  const result = spawnSync("bash", [runner], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...inheritedEnvironment,
      PATH: `${bin}${path.delimiter}${ghBin}${path.delimiter}${process.env.PATH}`,
      AIDOC_FAKE_LOG: log,
      AIDOC_GH_LOG: ghLog,
      GITHUB_OUTPUT: githubOutput,
      GITHUB_STEP_SUMMARY: summary,
      RUNNER_TEMP: temp,
      AIDOC_CHANGED_FILES_FILE: changedFiles,
      AIDOC_INPUT_PROVIDER: "openai",
      AIDOC_INPUT_API_KEY: fakeOpenAiKey,
      AIDOC_INPUT_MODEL: "test-model",
      AIDOC_INPUT_COMMANDS: "readme",
      AIDOC_INPUT_MODE: "generate",
      AIDOC_INPUT_OUTPUT_DIR: "./docs",
      AIDOC_INPUT_DRY_RUN: "false",
      AIDOC_INPUT_SINCE: "HEAD~1",
      ...overrides,
    },
  });
  const output = fs.existsSync(githubOutput)
    ? fs.readFileSync(githubOutput, "utf8")
    : "";
  const reportPathMatch = output.match(/^report=(.+)$/m);
  const report = reportPathMatch && fs.existsSync(reportPathMatch[1])
    ? fs.readFileSync(reportPathMatch[1], "utf8")
    : "";
  const response: RunnerResult = {
    status: result.status,
    log: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "",
    ghLog: fs.existsSync(ghLog) ? fs.readFileSync(ghLog, "utf8") : "",
    stderr: result.stderr,
    stdout: result.stdout,
    output,
    changedFiles: fs.existsSync(changedFiles)
      ? fs.readFileSync(changedFiles, "utf8")
      : "",
    summary: fs.existsSync(summary) ? fs.readFileSync(summary, "utf8") : "",
    report,
  };
  fs.rmSync(root, { recursive: true, force: true });
  return response;
}

describe("action/run.sh", () => {
  it("propagates generation failures", () => {
    expect(runRunner({ AIDOC_FAKE_EXIT: "1" }).status).toBe(1);
  });

  it("propagates a strict policy rejection from the aidoc CLI", () => {
    expect(runRunner({ AIDOC_FAKE_EXIT: "2" }).status).toBe(2);
  });

  it("propagates an external-output rejection without claiming changed files", () => {
    const externalRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "aidoc-action-external-"),
    );
    const sentinel = path.join(externalRoot, "sentinel.txt");
    const outputDirectory = path.join(externalRoot, "generated");
    const sentinelContents = "external sentinel\n";
    fs.writeFileSync(sentinel, sentinelContents);
    try {
      const result = runRunner({
        AIDOC_INPUT_COMMANDS: "api",
        AIDOC_INPUT_OUTPUT_DIR: outputDirectory,
        AIDOC_FAKE_EXIT: "2",
      });
      expect(result.status).toBe(2);
      expect(result.log).toContain(`api --output ${outputDirectory}/API.md`);
      expect(result.changedFiles.trim()).toBe("");
      expect(result.output).not.toContain("changed=true");
      expect(fs.readFileSync(sentinel, "utf8")).toBe(sentinelContents);
    } finally {
      fs.rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it("fails generation when a remote provider credential is missing", () => {
    const result = runRunner({ AIDOC_INPUT_API_KEY: "" });
    expect(result.status).toBe(2);
    expect(result.log).toBe("");
  });
  it("does not echo unrelated hostile inputs when a remote credential is missing", () => {
    const result = runRunner({
      AIDOC_INPUT_API_KEY: "",
      AIDOC_INPUT_COMMANDS: fakeValidationCredential,
    });
    expect(result.status).toBe(2);
    expect(result.log).toBe("");
    expect(result.stderr).not.toContain(fakeValidationCredential);
  });

  it("rejects invalid legacy inputs before invoking aidoc", () => {
    for (const overrides of [
      { AIDOC_INPUT_DRY_RUN: "yes" },
      { AIDOC_INPUT_TRUST_POLICY: "unsafe" },
    ]) {
      const result = runRunner(overrides);
      expect(result.status).toBe(2);
      expect(result.log).toBe("");
    }
  });

  it.each([
    ["trust-policy", { AIDOC_INPUT_TRUST_POLICY: fakeValidationCredential }],
    ["mode", { AIDOC_INPUT_MODE: fakeValidationCredential }],
    ["dry-run", { AIDOC_INPUT_DRY_RUN: fakeValidationCredential }],
    ["provider", { AIDOC_INPUT_PROVIDER: fakeValidationCredential }],
    ["command", { AIDOC_INPUT_COMMANDS: fakeValidationCredential }],
  ])("does not echo an invalid %s input before aidoc starts", (_branch, overrides) => {
    const result = runRunner(overrides);
    expect(result.status).toBe(2);
    expect(result.log).toBe("");
    expect(result.stderr).not.toContain(fakeValidationCredential);
  });

  it("uses the real command path without --mock", () => {
    const result = runRunner();
    expect(result.status).toBe(0);
    expect(result.log).toContain("readme --output ./README.md --yes --strict-output");
    expect(result.log).toContain("trust-policy=strict\norigin=action");
    expect(result.log).not.toContain("--mock");
    expect(result.output).toContain("changed=true");
    expect(result.changedFiles.trim()).toBe("./README.md");
    expect([result.log, result.output, result.changedFiles].join("\n")).not.toContain(fakeOpenAiKey);
  });

  it("uses deterministic check mode without an API key and reports its message", () => {
    const result = runRunner({ AIDOC_INPUT_MODE: "check", AIDOC_INPUT_API_KEY: "" });
    expect(result.status).toBe(0);
    expect(result.log).toContain("check --target ./README.md --since HEAD~1 --json");
    expect(result.output).toContain("No changed public symbol is mentioned in README.md");
  });

  it("runs review without PR context, writes outputs, and never invokes gh", () => {
    const result = runRunner({
      AIDOC_INPUT_MODE: "review",
      AIDOC_INPUT_PROVIDER: "ignored-provider",
      AIDOC_INPUT_API_KEY: "ignored-key",
      AIDOC_INPUT_COMMANDS: "ignored-command",
      AIDOC_INPUT_OUTPUT_DIR: "/ignored/output",
      AIDOC_INPUT_FAIL_ON: "none",
    });
    expect(result.status).toBe(0);
    expect(result.log).toContain("review --format json --fail-on none --base HEAD~1");
    expect(result.output).toContain("verdict=stale");
    expect(result.output).toContain("public-api-changes=1");
    expect(result.output).toContain("stale-documents=1");
    expect(result.output).toContain("breaking=0");
    expect(result.output).toContain("report=");
    expect(result.report).toContain('"schemaVersion":"aidoc.review.v1"');
    expect(result.ghLog).toBe("");
    expect(result.stdout).toContain("AiDoc: documentation impact (stale)");
  });
  it("reports a stale check message before propagating the failure", () => {
    const result = runRunner({
      AIDOC_INPUT_MODE: "check",
      AIDOC_INPUT_API_KEY: "",
      AIDOC_FAKE_CHECK_RESULT: "stale",
      AIDOC_FAKE_EXIT: "1",
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("summary<<AIDOC_SUMMARY_EOF\nREADME.md is stale for changed public symbols\n");
  });

  it("updates a marked token-owned comment with PATCH", () => {
    const result = runRunner({
      AIDOC_INPUT_MODE: "review",
      AIDOC_PR_BASE_SHA: "HEAD",
      AIDOC_PR_HEAD_SHA: "HEAD",
      AIDOC_REPOSITORY: "owner/repo",
      AIDOC_PR_NUMBER: "7",
      AIDOC_INPUT_GITHUB_TOKEN: "token",
      AIDOC_GH_COMMENTS: '[{"id":42,"body":"<!-- aidoc-review -->\\nold","user":{"login":"github-actions[bot]"}}]',
    });
    expect(result.status).toBe(0);
    expect(result.ghLog).toContain("api repos/owner/repo/issues/7/comments --paginate");
    expect(result.ghLog).toContain("api user --jq .login");
    expect(result.ghLog).toContain("api -X PATCH repos/owner/repo/issues/7/comments/42 --input");
    expect(result.ghLog).not.toContain("api -X POST repos/owner/repo/issues/7/comments --input");
  });

  it("posts a marked comment when no token-owned comment exists", () => {
    const result = runRunner({
      AIDOC_INPUT_MODE: "review",
      AIDOC_PR_BASE_SHA: "HEAD",
      AIDOC_PR_HEAD_SHA: "HEAD",
      AIDOC_REPOSITORY: "owner/repo",
      AIDOC_PR_NUMBER: "7",
      AIDOC_INPUT_GITHUB_TOKEN: "token",
      AIDOC_GH_COMMENTS: "[]",
    });
    expect(result.status).toBe(0);
    expect(result.ghLog).toContain("api -X POST repos/owner/repo/issues/7/comments --input");
  });

  it("deletes the token-owned comment when the report has zero public API changes", () => {
    const result = runRunner({
      AIDOC_INPUT_MODE: "review",
      AIDOC_PR_BASE_SHA: "HEAD",
      AIDOC_PR_HEAD_SHA: "HEAD",
      AIDOC_REPOSITORY: "owner/repo",
      AIDOC_PR_NUMBER: "7",
      AIDOC_INPUT_GITHUB_TOKEN: "token",
      AIDOC_GH_COMMENTS: '[{"id":42,"body":"<!-- aidoc-review -->\\nold","user":{"login":"github-actions[bot]"}}]',
      AIDOC_FAKE_REVIEW_ZERO: "true",
    });
    expect(result.status).toBe(0);
    expect(result.ghLog).toContain("api -X DELETE repos/owner/repo/issues/7/comments/42");
    expect(result.ghLog).not.toContain("api -X PATCH repos/owner/repo/issues/7/comments/42");
  });

  it("uses the locked label colors and descriptions", () => {
    const result = runRunner({
      AIDOC_INPUT_MODE: "review",
      AIDOC_PR_BASE_SHA: "HEAD",
      AIDOC_PR_HEAD_SHA: "HEAD",
      AIDOC_REPOSITORY: "owner/repo",
      AIDOC_PR_NUMBER: "7",
      AIDOC_INPUT_GITHUB_TOKEN: "token",
      AIDOC_INPUT_COMMENT: "false",
    });
    expect(result.ghLog).toContain("label create docs-stale --color e4e669 --description Documentation sections mentioning changed public symbols are stale --force");
    expect(result.ghLog).toContain("label create breaking-change --color d73a4a --description Potentially breaking public API changes detected --force");
  });

  it("writes the Markdown report to the step summary and keeps a read-only token non-fatal", () => {
    const result = runRunner({
      AIDOC_INPUT_MODE: "review",
      AIDOC_PR_BASE_SHA: "HEAD",
      AIDOC_PR_HEAD_SHA: "HEAD",
      AIDOC_REPOSITORY: "owner/repo",
      AIDOC_PR_NUMBER: "7",
      AIDOC_INPUT_GITHUB_TOKEN: "token",
      AIDOC_GH_MODE: "forbidden",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::notice::AiDoc could not post a comment (read-only token); see the job summary");
    expect(result.summary).toContain("<!-- aidoc-review -->");
  });

  it("tolerates 404 when removing absent labels", () => {
    const result = runRunner({
      AIDOC_INPUT_MODE: "review",
      AIDOC_PR_BASE_SHA: "HEAD",
      AIDOC_PR_HEAD_SHA: "HEAD",
      AIDOC_REPOSITORY: "owner/repo",
      AIDOC_PR_NUMBER: "7",
      AIDOC_INPUT_GITHUB_TOKEN: "token",
      AIDOC_FAKE_REVIEW_ZERO: "true",
      AIDOC_GH_MODE: "not-found",
      AIDOC_INPUT_COMMENT: "false",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("read-only token");
  });
  it.each([
    ["comment POST", { AIDOC_GH_MODE: "comment-post", AIDOC_GH_COMMENTS: "[]" }],
    ["comment PATCH", { AIDOC_GH_MODE: "comment-patch", AIDOC_GH_COMMENTS: '[{"id":42,"body":"<!-- aidoc-review -->\\nold","user":{"login":"github-actions[bot]"}}]' }],
    ["label create", { AIDOC_GH_MODE: "label-create", AIDOC_INPUT_COMMENT: "false" }],
    ["label add", { AIDOC_GH_MODE: "label-add", AIDOC_INPUT_COMMENT: "false" }],
    ["label delete", { AIDOC_GH_MODE: "label-delete", AIDOC_INPUT_COMMENT: "false", AIDOC_FAKE_REVIEW_ZERO: "true" }],
  ])("fails on an unrelated GitHub API operation error (%s)", (_label, overrides) => {
    const result = runRunner({
      AIDOC_INPUT_MODE: "review",
      AIDOC_PR_BASE_SHA: "HEAD",
      AIDOC_PR_HEAD_SHA: "HEAD",
      AIDOC_REPOSITORY: "owner/repo",
      AIDOC_PR_NUMBER: "7",
      AIDOC_INPUT_GITHUB_TOKEN: "token",
      ...overrides,
    });
    expect(result.status).toBe(1);
  });

  it("fails when the presentation review command has an operational error", () => {
    const result = runRunner({
      AIDOC_INPUT_MODE: "review",
      AIDOC_FAKE_REVIEW_TEXT_EXIT: "2",
    });
    expect(result.status).toBe(2);
  });

  it("preserves an expected presentation fail-on status", () => {
    const result = runRunner({
      AIDOC_INPUT_MODE: "review",
      AIDOC_FAKE_REVIEW_TEXT_EXIT: "1",
    });
    expect(result.status).toBe(0);
  });
});

describe("composite Action package", () => {
  it("publishes action.yml at the repository root used by owner/repo@ref", () => {
    expect(fs.existsSync(path.resolve("action.yml"))).toBe(true);
  });

  it("links composite outputs to the runner step", () => {
    const metadata = fs.readFileSync(path.resolve("action.yml"), "utf8");
    expect(metadata).toMatch(/\bid: aidoc\b/);
    for (const output of ["changed", "files", "summary", "verdict", "public-api-changes", "stale-documents", "breaking", "report"]) {
      expect(metadata).toContain(`value: \${{ steps.aidoc.outputs.${output} }}`);
    }
  });

  it("stages only paths emitted by aidoc", () => {
    const metadata = fs.readFileSync(path.resolve("action.yml"), "utf8");
    expect(metadata).not.toContain("git add -A");
    expect(metadata).toContain("git diff --cached --quiet");
    expect(metadata).toContain('git add -- "$file"');
  });

  it("supports review defaults and local source installation", () => {
    const metadata = fs.readFileSync(path.resolve("action.yml"), "utf8");
    expect(metadata).toContain('default: "review"');
    expect(metadata).toContain('default: "none"');
    expect(metadata).toContain('default: "true"');
    expect(metadata).toContain('default: "npm"');
    expect(metadata).toContain("npm ci");
    expect(metadata).toContain("npm run build");
    expect(metadata).toContain("npm link");
  });

  it("installs the npm version declared by the same Action ref", () => {
    const metadata = fs.readFileSync(path.resolve("action.yml"), "utf8");
    expect(metadata).toContain("require('./package.json').version");
    expect(metadata).toContain("@mr-min-max/aidoc-gen@$version");
  });
});
