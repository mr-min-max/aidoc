#!/usr/bin/env node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACKAGE_VERSION = JSON.parse(
  await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
).version;
const DEFAULT_PACKAGE_SPEC = `staledocs@${PACKAGE_VERSION}`;
const PACKAGE_PATTERN =
  /^staledocs@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)$/u;
const EXPECTED_LABELS = Object.freeze([
  "DOCS-UPDATED",
  "DOCS-STALE",
  "UNDOCUMENTED",
  "INTERNAL",
  "NO-PUBLIC-CHANGE",
]);
const MAX_TARGETS = 100;
const TRUST_POLICY = "strict";
const NPM_CACHE = "/tmp/aidoc-npm-cache-p6";
const COMMAND_TIMEOUT_MS = 240_000;
const MAX_OUTPUT_BYTES = 1_048_576;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const REVIEW_SCHEMA_VERSION = "aidoc.review.v1";
const PLAN_SCHEMA_VERSION = "aidoc.impact-plan.v1";
const REMOVED_ENVIRONMENT_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "DASHSCOPE_API_KEY",
  "AIDOC_COMPAT_API_KEY",
  "AIDOC_PROVIDER",
  "AIDOC_MODEL",
  "AIDOC_PROVIDER_BASE_URL",
  "AIDOC_ALLOW_LOCAL_HTTP",
  "AIDOC_QWEN_REGION",
  "AIDOC_QWEN_WORKSPACE_ID",
  "AIDOC_OLLAMA_HOST",
  "STALEDOCS_COMPAT_API_KEY",
  "STALEDOCS_PROVIDER",
  "STALEDOCS_MODEL",
  "STALEDOCS_PROVIDER_BASE_URL",
  "STALEDOCS_ALLOW_LOCAL_HTTP",
  "STALEDOCS_QWEN_REGION",
  "STALEDOCS_QWEN_WORKSPACE_ID",
  "STALEDOCS_OLLAMA_HOST",
  "STALEDOCS_ORIGIN",
  "STALEDOCS_BASE_REF",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
];

class WriteDetectedError extends Error {
  constructor() {
    super("WRITE DETECTED; evaluation stopped.");
    this.name = "WriteDetectedError";
  }
}

class TargetFailure extends Error {
  constructor(category, message) {
    super(message);
    this.name = "TargetFailure";
    this.category = category;
  }
}

function usage() {
  return [
    "Usage: node scripts/evaluate-external.mjs <manifest.json> --out <markdown-file>",
    "  --package <spec>             Exact published package (default: " +
      DEFAULT_PACKAGE_SPEC +
      ")",
    "  --evidence <directory>       Private evidence outside the public worktree",
    "  --compare <old-evidence-root> Compare the same immutable targets with old evidence",
    "  --help                       Show this help",
  ].join("\n");
}

function fail(message) {
  throw new Error(`${message}\n\n${usage()}`);
}

export function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  if (argv.length < 3 || argv[0].startsWith("--"))
    fail("Expected a manifest path and --out path.");
  const options = { manifestPath: argv[0], packageSpec: DEFAULT_PACKAGE_SPEC };
  const names = new Map([
    ["--out", "outputPath"],
    ["--package", "packageSpec"],
    ["--evidence", "evidencePath"],
    ["--compare", "comparePath"],
  ]);
  const seen = new Set();
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !names.has(name) ||
      seen.has(name) ||
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      fail("Expected unique options followed by values.");
    }
    seen.add(name);
    options[names.get(name)] = value;
  }
  if (options.outputPath === undefined)
    fail("Expected --out followed by an output path.");
  if (!PACKAGE_PATTERN.test(options.packageSpec))
    fail("Package must be staledocs at an exact version.");
  return options;
}

export function validateManifest(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("Manifest must be a JSON object.");
  }
  assertExactKeys(value, ["version", "targets"], "manifest");
  if (value.version !== 1) fail("Manifest version must be 1.");
  if (
    !Array.isArray(value.targets) ||
    value.targets.length === 0 ||
    value.targets.length > MAX_TARGETS
  ) {
    fail(`Manifest targets must contain between 1 and ${MAX_TARGETS} entries.`);
  }

  const identities = new Set();
  const comparisons = new Set();
  return value.targets
    .map((target, index) => {
      if (
        typeof target !== "object" ||
        target === null ||
        Array.isArray(target)
      ) {
        fail(`Target ${index + 1} must be an object.`);
      }
      assertExactKeys(
        target,
        ["repo", "language", "base", "head", "pr", "expected"],
        `target ${index + 1}`,
      );
      const hasPr = Object.hasOwn(target, "pr");
      const hasBase = Object.hasOwn(target, "base");
      const hasHead = Object.hasOwn(target, "head");
      if (hasBase !== hasHead) {
        fail(`Target ${index + 1} must provide both base and head.`);
      }
      if (!hasPr && !hasBase) {
        fail(`Target ${index + 1} must provide pr or base and head.`);
      }

      const { repo, language, base, head, pr } = target;
      if (typeof repo !== "string" || !REPOSITORY_PATTERN.test(repo)) {
        fail(`Target ${index + 1} has an invalid repo.`);
      }
      if (!["typescript", "javascript", "python"].includes(language)) {
        fail(`Target ${index + 1} has an invalid language.`);
      }
      if (hasPr && (!Number.isInteger(pr) || pr <= 0)) {
        fail(`Target ${index + 1} has an invalid PR number.`);
      }
      const identity = hasPr
        ? `${repo.toLowerCase()}:${pr}`
        : repo.toLowerCase();
      if (identities.has(identity))
        fail(`Target ${index + 1} duplicates a repository and PR.`);
      identities.add(identity);
      const expected = Object.hasOwn(target, "expected")
        ? validateExpected(target.expected)
        : undefined;
      if (hasBase) {
        if (typeof base !== "string" || !SHA_PATTERN.test(base)) {
          fail(`Target ${index + 1} has an invalid base SHA.`);
        }
        if (typeof head !== "string" || !SHA_PATTERN.test(head)) {
          fail(`Target ${index + 1} has an invalid head SHA.`);
        }
        if (base === head)
          fail(`Target ${index + 1} must compare different SHAs.`);
        const comparison = `${base}:${head}`;
        if (comparisons.has(comparison))
          fail(`Target ${index + 1} duplicates a comparison.`);
        comparisons.add(comparison);
      }
      return Object.freeze({
        repo,
        language,
        ...(hasPr ? { pr } : {}),
        ...(hasBase ? { base, head } : {}),
        ...(expected === undefined ? {} : { expected }),
      });
    })
    .sort(compareTargets);
}

function safeExpectedText(value, max) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    !/(?:^|\s)(?:\/[A-Za-z]|[A-Za-z]:[\\/])|\/Users\/|\/home\//u.test(value)
  );
}

function safeDocumentPath(value) {
  return (
    safeExpectedText(value, 256) &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes(":") &&
    !value
      .split("/")
      .some(
        (segment) =>
          segment === ".." ||
          segment === "." ||
          segment === ".git" ||
          segment === "",
      ) &&
    value.toLowerCase().endsWith(".md")
  );
}

function validateExpected(value) {
  if (!isObject(value)) fail("Expected must be an object.");
  assertExactKeys(value, ["label", "symbol", "document", "reason"], "expected");
  if (
    !EXPECTED_LABELS.includes(value.label) ||
    !safeExpectedText(value.reason, 512)
  )
    fail("Expected requires a valid label and bounded reason.");
  if (Object.hasOwn(value, "symbol") && !safeExpectedText(value.symbol, 128))
    fail("Expected symbol is invalid.");
  if (Object.hasOwn(value, "document") && !safeDocumentPath(value.document))
    fail("Expected document is invalid.");
  return Object.freeze({
    label: value.label,
    ...(Object.hasOwn(value, "symbol") ? { symbol: value.symbol } : {}),
    ...(Object.hasOwn(value, "document") ? { document: value.document } : {}),
    reason: value.reason,
  });
}

function compareTargets(left, right) {
  const a = left.repo.toLowerCase();
  const b = right.repo.toLowerCase();
  return (a < b ? -1 : a > b ? 1 : 0) || (left.pr ?? 0) - (right.pr ?? 0);
}

function assertExactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${label} has unknown field: ${key}.`);
  }
}

function safeSlug(repo) {
  return repo.replaceAll("/", "-");
}

function publicLanguage(language) {
  if (language === "typescript") return "TS";
  if (language === "javascript") return "JS";
  return "Python";
}

function makeChildEnvironment() {
  const env = { ...process.env };
  for (const name of REMOVED_ENVIRONMENT_NAMES) delete env[name];
  env.STALEDOCS_TRUST_POLICY = TRUST_POLICY;
  env.npm_config_cache = NPM_CACHE;
  env.NPM_CONFIG_CACHE = NPM_CACHE;
  return env;
}

function runProcess(command, args, options = {}) {
  const started = performance.now();
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? makeChildEnvironment();
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    let outputLimitExceeded = false;
    let timer;
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        command,
        args,
        cwd,
        stdout,
        stderr,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut,
        outputLimitExceeded,
        elapsedMs: performance.now() - started,
      });
    };
    const capture = (stream, chunk) => {
      const remaining = Math.max(0, MAX_OUTPUT_BYTES - outputBytes);
      if (remaining > 0) {
        const captured = chunk.subarray(0, remaining).toString();
        if (stream === child.stdout) stdout += captured;
        else stderr += captured;
      }
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        outputLimitExceeded = true;
        child.stdout.pause();
        child.stderr.pause();
        child.kill("SIGTERM");
      }
    };
    child.stdout.on("data", (chunk) => capture(child.stdout, chunk));
    child.stderr.on("data", (chunk) => capture(child.stderr, chunk));
    child.on("error", (error) => {
      if (!outputLimitExceeded) {
        const remaining = Math.max(
          0,
          MAX_OUTPUT_BYTES - Buffer.byteLength(stderr),
        );
        stderr += `${error.name}: ${error.message}`.slice(0, remaining);
      }
      finish({ exitCode: null, signal: null });
    });
    child.on("close", (exitCode, signal) => finish({ exitCode, signal }));
    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, timeoutMs);
  });
}

async function runGit(args, cwd, options = {}) {
  return runProcess("git", args, { cwd, ...options });
}

function commandRecord(result, includeCwd = true) {
  return {
    command: [result.command, ...result.args].join(" "),
    argv: [result.command, ...result.args],
    ...(includeCwd ? { cwd: result.cwd } : {}),
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    outputLimitExceeded: result.outputLimitExceeded,
    elapsedMs: result.elapsedMs,
    stdoutBytes: Buffer.byteLength(result.stdout),
    stderrBytes: Buffer.byteLength(result.stderr),
  };
}

function processFailureCategory(result) {
  if (result.outputLimitExceeded) return "output-limit";
  if (result.timedOut) return "timeout";
  return "operational";
}

function requireSuccessfulProcess(result, message) {
  if (result.outputLimitExceeded || result.timedOut || result.exitCode !== 0) {
    throw new TargetFailure(processFailureCategory(result), message);
  }
}

function sanitizeText(value, max = 80) {
  return String(value)
    .replaceAll("\u2014", "-")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max)
    .trim();
}

function escapeTable(value, max = 80) {
  const text = sanitizeText(value, Math.max(max, MAX_OUTPUT_BYTES))
    .replace(
      /(?:ghp_|github_pat_|sk[-_](?:proj[-_])?)[A-Za-z0-9_-]{20,}/gu,
      "[redacted]",
    )
    .replace(
      /(?:^|[\s(`])(?:\/[A-Za-z][^\s`)]*|[A-Za-z]:[\\/][^\s`)]*)/gu,
      " [path]",
    );
  return sanitizeText(text, max).replaceAll("|", "\\|");
}

function boundedNames(reviewJson) {
  return reviewJson.changes
    .slice(0, 3)
    .map((change) => escapeTable(change.qualifiedName, 64));
}

function boundedStaleDetails(reviewJson) {
  return reviewJson.documents
    .filter((document) => document.status === "stale")
    .slice(0, 2)
    .flatMap((document) =>
      document.sections
        .slice(0, 2)
        .map(
          (section) =>
            `${escapeTable(document.path, 48)} > ${escapeTable(section.section, 48)}`,
        ),
    )
    .slice(0, 3);
}

async function writeCommandEvidence(dir, name, result, parseJson = false) {
  await fs.writeFile(path.join(dir, `${name}.stdout`), result.stdout, "utf8");
  await fs.writeFile(path.join(dir, `${name}.stderr`), result.stderr, "utf8");
  await fs.writeFile(
    path.join(dir, `${name}.metadata.json`),
    `${JSON.stringify(commandRecord(result), null, 2)}\n`,
    "utf8",
  );
  if (!parseJson || result.stdout.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    await fs.writeFile(
      path.join(dir, `${name}.json`),
      `${JSON.stringify(parsed, null, 2)}\n`,
      "utf8",
    );
    return parsed;
  } catch {
    return null;
  }
}

async function cleanStatus(cloneDir) {
  const status = await runGit(
    ["status", "--porcelain=v1", "--untracked-files=all"],
    cloneDir,
  );
  const unstaged = await runGit(
    ["diff", "--no-ext-diff", "--exit-code"],
    cloneDir,
  );
  const staged = await runGit(
    ["diff", "--cached", "--no-ext-diff", "--exit-code"],
    cloneDir,
  );
  const results = [status, unstaged, staged];
  const boundedFailure = results.find(
    (result) => result.outputLimitExceeded || result.timedOut,
  );
  if (boundedFailure !== undefined) {
    throw new TargetFailure(
      processFailureCategory(boundedFailure),
      "repository status check failed",
    );
  }
  if (
    status.exitCode !== 0 ||
    ![0, 1].includes(unstaged.exitCode) ||
    ![0, 1].includes(staged.exitCode)
  ) {
    throw new TargetFailure("operational", "repository status check failed");
  }
  return {
    status: status.stdout,
    statusExitCode: status.exitCode,
    unstagedExitCode: unstaged.exitCode,
    stagedExitCode: staged.exitCode,
    clean:
      status.stdout.length === 0 &&
      unstaged.exitCode === 0 &&
      staged.exitCode === 0,
  };
}

async function assertCleanOrStop(cloneDir, evidenceDir, phase) {
  const proof = await cleanStatus(cloneDir);
  await fs.writeFile(
    path.join(evidenceDir, `${phase}-status.json`),
    `${JSON.stringify(proof, null, 2)}\n`,
    "utf8",
  );
  if (!proof.clean) throw new WriteDetectedError();
  return proof;
}

async function cloneTarget(target, cloneDir) {
  const clone = await runProcess(
    "git",
    [
      "clone",
      "--filter=blob:none",
      "--no-checkout",
      `https://github.com/${target.repo}.git`,
      cloneDir,
    ],
    { env: makeChildEnvironment(), timeoutMs: COMMAND_TIMEOUT_MS },
  );
  requireSuccessfulProcess(clone, "clone failed");
  const fetchRefs = [target.base, target.head];
  if (target.pr !== undefined) fetchRefs.push(`refs/pull/${target.pr}/head`);
  const fetch = await runGit(
    ["fetch", "--quiet", "--no-tags", "origin", ...fetchRefs],
    cloneDir,
  );
  requireSuccessfulProcess(fetch, "fetch failed");
  const checkout = await runGit(
    ["checkout", "--detach", "--quiet", target.head],
    cloneDir,
  );
  requireSuccessfulProcess(checkout, "checkout failed");
  const head = await runGit(["rev-parse", "HEAD"], cloneDir);
  const base = await runGit(["rev-parse", `${target.base}^{commit}`], cloneDir);
  requireSuccessfulProcess(head, "head verification failed");
  requireSuccessfulProcess(base, "base verification failed");
  if (
    head.stdout.trim() !== target.head ||
    base.stdout.trim() !== target.base
  ) {
    throw new TargetFailure(
      "operational",
      "checked-out comparison did not match the resolved SHAs",
    );
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function matchesSnapshot(value, commit) {
  return (
    isObject(value) &&
    value.type === "git" &&
    typeof value.label === "string" &&
    value.commit === commit
  );
}

function validateReviewEnvelope(reviewJson, target) {
  if (
    !isObject(reviewJson) ||
    reviewJson.schemaVersion !== REVIEW_SCHEMA_VERSION
  )
    return false;
  if (
    !matchesSnapshot(reviewJson.base, target.base) ||
    !matchesSnapshot(reviewJson.head, target.head)
  )
    return false;
  if (!isObject(reviewJson.summary)) return false;
  const summaryKeys = [
    "publicApiChanges",
    "breaking",
    "staleDocuments",
    "coChangedDocuments",
    "unmappedSymbols",
    "suppressed",
  ];
  if (
    !summaryKeys.every((key) => isNonNegativeInteger(reviewJson.summary[key]))
  )
    return false;
  if (
    reviewJson.summary.internalChanges !== undefined &&
    !isNonNegativeInteger(reviewJson.summary.internalChanges)
  )
    return false;
  if (
    !Array.isArray(reviewJson.changes) ||
    !reviewJson.changes.every(
      (change) => isObject(change) && typeof change.qualifiedName === "string",
    )
  )
    return false;
  if (
    !Array.isArray(reviewJson.documents) ||
    !reviewJson.documents.every(
      (document) =>
        isObject(document) &&
        typeof document.path === "string" &&
        ["stale", "co-changed"].includes(document.status) &&
        Array.isArray(document.sections) &&
        document.sections.every(
          (section) => isObject(section) && typeof section.section === "string",
        ),
    )
  )
    return false;
  return (
    Array.isArray(reviewJson.unmapped) &&
    reviewJson.unmapped.every((name) => typeof name === "string") &&
    Array.isArray(reviewJson.suppressed) &&
    ["clean", "stale", "breaking"].includes(reviewJson.verdict)
  );
}

function validatePlanEnvelope(planJson, target) {
  if (!isObject(planJson) || planJson.ok !== true || !isObject(planJson.plan))
    return false;
  const plan = planJson.plan;
  return (
    plan.schemaVersion === PLAN_SCHEMA_VERSION &&
    matchesSnapshot(plan.base, target.base) &&
    matchesSnapshot(plan.head, target.head) &&
    isObject(plan.summary) &&
    Array.isArray(plan.changes) &&
    Array.isArray(plan.documentation) &&
    isObject(plan.ignored) &&
    isNonNegativeInteger(plan.ignored.unsupported)
  );
}

function targetEvidenceName(target) {
  return `${safeSlug(target.repo)}${target.pr === undefined ? "" : `-pr-${target.pr}`}`;
}

function canonicalPullRequestUrl(target) {
  const [owner, repository] = target.repo.split("/").map(encodeURIComponent);
  return `https://github.com/${owner}/${repository}/pull/${target.pr}`;
}

async function resolvePullRequest(target, targetEvidence) {
  if (target.pr === undefined) return { target, pullRequest: null };
  const commandResult = await runProcess(
    "gh",
    ["api", `repos/${target.repo}/pulls/${target.pr}`],
    { env: makeChildEnvironment() },
  );
  await writeCommandEvidence(
    targetEvidence,
    "pull-request",
    commandResult,
    false,
  );
  requireSuccessfulProcess(commandResult, "pull-request API request failed");

  let parsed;
  try {
    parsed = JSON.parse(commandResult.stdout);
  } catch {
    throw new TargetFailure(
      "pr-validation",
      "pull-request response was not valid JSON",
    );
  }
  if (!isObject(parsed)) {
    throw new TargetFailure(
      "pr-validation",
      "pull-request response was not an object",
    );
  }
  const pullRequest = {
    number: parsed.number,
    title:
      typeof parsed.title === "string" ? sanitizeText(parsed.title, 160) : "",
    html_url:
      typeof parsed.html_url === "string" ? parsed.html_url.slice(0, 200) : "",
    merged_at:
      typeof parsed.merged_at === "string"
        ? parsed.merged_at.slice(0, 64)
        : null,
    base_sha:
      typeof parsed.base?.sha === "string" ? parsed.base.sha.slice(0, 64) : "",
    head_sha:
      typeof parsed.head?.sha === "string" ? parsed.head.sha.slice(0, 64) : "",
    merge_commit_sha:
      typeof parsed.merge_commit_sha === "string"
        ? parsed.merge_commit_sha.slice(0, 64)
        : "",
  };
  await fs.writeFile(
    path.join(targetEvidence, "pull-request.json"),
    `${JSON.stringify(pullRequest, null, 2)}\n`,
    "utf8",
  );
  const validMetadata =
    pullRequest.number === target.pr &&
    pullRequest.title.length > 0 &&
    pullRequest.html_url === canonicalPullRequestUrl(target) &&
    pullRequest.merged_at !== null &&
    SHA_PATTERN.test(pullRequest.base_sha) &&
    SHA_PATTERN.test(pullRequest.head_sha) &&
    SHA_PATTERN.test(pullRequest.merge_commit_sha);
  if (!validMetadata) {
    throw new TargetFailure(
      "pr-validation",
      "pull-request metadata validation failed",
    );
  }

  if (target.base !== undefined) {
    if (target.base !== pullRequest.base_sha) {
      throw new TargetFailure(
        "pr-validation",
        "associated pull-request base did not match",
      );
    }
    if (
      target.head !== pullRequest.head_sha &&
      target.head !== pullRequest.merge_commit_sha
    ) {
      throw new TargetFailure(
        "pr-validation",
        "associated pull-request head did not match",
      );
    }
    return { target, pullRequest };
  }
  if (pullRequest.base_sha === pullRequest.head_sha) {
    throw new TargetFailure(
      "pr-validation",
      "pull-request comparison SHAs were identical",
    );
  }
  return {
    target: Object.freeze({
      ...target,
      base: pullRequest.base_sha,
      head: pullRequest.head_sha,
    }),
    pullRequest,
  };
}

async function runTarget(manifestTarget, evidenceRoot, packageSpec) {
  const started = performance.now();
  const targetEvidence = path.join(
    evidenceRoot,
    targetEvidenceName(manifestTarget),
  );
  await fs.rm(targetEvidence, { recursive: true, force: true });
  await fs.mkdir(targetEvidence, { recursive: true });
  let cloneDir;
  const result = {
    repo: manifestTarget.repo,
    language: manifestTarget.language,
    ...(manifestTarget.pr === undefined ? {} : { pr: manifestTarget.pr }),
    ...(manifestTarget.base === undefined
      ? {}
      : { base: manifestTarget.base, head: manifestTarget.head }),
    package: packageSpec,
    evidenceDirName: path.basename(targetEvidence),
    commands: [],
    status: "ERROR",
    elapsedMs: 0,
    pullRequest: null,
  };
  if (manifestTarget.expected !== undefined)
    result.expected = manifestTarget.expected;
  let pendingWriteError;
  try {
    const resolved = await resolvePullRequest(manifestTarget, targetEvidence);
    const target = resolved.target;
    result.pullRequest = resolved.pullRequest;
    result.base = target.base;
    result.head = target.head;
    cloneDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "staledocs-evaluation-"),
    );
    await cloneTarget(target, cloneDir);
    result.beforeClean = (
      await assertCleanOrStop(cloneDir, targetEvidence, "before")
    ).clean;

    let reviewJson = null;
    let planJson = null;
    try {
      const commands = [
        [
          "review-json",
          [
            "review",
            "--base",
            target.base,
            "--head",
            target.head,
            "--format",
            "json",
          ],
          true,
        ],
        [
          "review-markdown",
          [
            "review",
            "--base",
            target.base,
            "--head",
            target.head,
            "--format",
            "markdown",
          ],
          false,
        ],
        [
          "plan-json",
          ["plan", "--base", target.base, "--head", target.head, "--json"],
          true,
        ],
      ];
      for (const [name, args, parseJson] of commands) {
        const commandResult = await runProcess(
          "npx",
          ["-y", packageSpec, ...args],
          { cwd: cloneDir, env: makeChildEnvironment() },
        );
        result.commands.push(commandRecord(commandResult, false));
        const parsed = await writeCommandEvidence(
          targetEvidence,
          name,
          commandResult,
          parseJson,
        );
        requireSuccessfulProcess(commandResult, `${name} command failed`);
        if (parseJson && parsed === null) {
          throw new TargetFailure(
            "schema",
            `${name} output was not valid JSON`,
          );
        }
        if (name === "review-json") reviewJson = parsed;
        if (name === "plan-json") planJson = parsed;
      }
    } finally {
      result.afterClean = (
        await assertCleanOrStop(cloneDir, targetEvidence, "after")
      ).clean;
    }

    if (
      !validateReviewEnvelope(reviewJson, target) ||
      !validatePlanEnvelope(planJson, target)
    ) {
      throw new TargetFailure(
        "schema",
        "output schema or comparison validation failed",
      );
    }
    result.status = "OK";
    result.publicApiChanges = reviewJson.summary.publicApiChanges;
    result.breaking = reviewJson.summary.breaking;
    result.staleDocuments = reviewJson.summary.staleDocuments;
    result.coChangedDocuments = reviewJson.summary.coChangedDocuments;
    result.unmappedSymbols = reviewJson.summary.unmappedSymbols;
    result.unsupported = planJson.plan.ignored.unsupported;
    result.firstChanges = boundedNames(reviewJson);
    result.staleDetails = boundedStaleDetails(reviewJson);
    if (reviewJson.summary.internalChanges !== undefined)
      result.internalChanges = reviewJson.summary.internalChanges;
  } catch (error) {
    if (error instanceof WriteDetectedError) {
      result.status = "WRITE DETECTED";
      result.errorCategory = "write-detected";
      result.error = error.message;
      pendingWriteError = error;
      await fs.writeFile(
        path.join(targetEvidence, "write-detected.txt"),
        `${error.message}\n`,
        "utf8",
      );
    } else {
      result.errorCategory =
        error instanceof TargetFailure ? error.category : "operational";
      result.error =
        error instanceof Error
          ? sanitizeText(error.message, 200)
          : "evaluation failed";
    }
  } finally {
    result.elapsedMs = performance.now() - started;
    Object.assign(result, deriveOutcome(result, manifestTarget.expected));
    await fs.writeFile(
      path.join(targetEvidence, "metadata.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    if (cloneDir !== undefined)
      await fs.rm(cloneDir, { recursive: true, force: true });
  }
  if (pendingWriteError !== undefined) throw pendingWriteError;
  return result;
}

export function deriveOutcome(result, expected = result.expected) {
  if (result.status !== "OK")
    return { observed: "ERROR", match: expected === undefined ? null : false };
  const observed =
    result.publicApiChanges === 0
      ? "NO-PUBLIC-CHANGE"
      : result.staleDocuments > 0
        ? "DOCS-STALE"
        : result.coChangedDocuments > 0
          ? "DOCS-UPDATED"
          : "UNDOCUMENTED";
  if (expected === undefined) return { observed, match: null };
  if (expected.label === "INTERNAL") {
    const legacy =
      result.package !== DEFAULT_PACKAGE_SPEC &&
      result.internalChanges === undefined;
    return {
      observed: legacy ? "n/a" : observed,
      match:
        result.publicApiChanges === 0 &&
        (legacy || (result.internalChanges ?? 0) > 0),
    };
  }
  return { observed, match: observed === expected.label };
}
function publicResult(result) {
  return {
    repo: result.repo,
    language: result.language,
    package: result.package,
    ...(result.pr === undefined ? {} : { pr: result.pr }),
    ...(result.base === undefined
      ? {}
      : { base: result.base, head: result.head }),
    status: result.status,
    elapsedMs: result.elapsedMs,
    ...(result.expected === undefined ? {} : { expected: result.expected }),
    ...(result.observed === undefined
      ? {}
      : { observed: result.observed, match: result.match }),
    pullRequest: result.pullRequest,
    ...(result.status === "OK"
      ? {
          publicApiChanges: result.publicApiChanges,
          breaking: result.breaking,
          staleDocuments: result.staleDocuments,
          coChangedDocuments: result.coChangedDocuments,
          unmappedSymbols: result.unmappedSymbols,
          unsupported: result.unsupported,
          firstChanges: result.firstChanges,
          staleDetails: result.staleDetails,
          ...(result.internalChanges === undefined
            ? {}
            : { internalChanges: result.internalChanges }),
        }
      : { errorCategory: result.errorCategory }),
  };
}

function formatCount(value) {
  return typeof value === "number" ? String(value) : "n/a";
}

function formatPullRequestCell(result) {
  if (result.pr === undefined) return "n/a";
  if (result.pullRequest === null)
    return `[#${result.pr}](${canonicalPullRequestUrl(result)})`;
  const title = escapeTable(result.pullRequest.title, 100);
  const url = canonicalPullRequestUrl(result);
  return `[#${result.pr}](${url}) ${title}`;
}

function publicNote(result) {
  if (result.status === "OK") {
    const association =
      result.pr === undefined
        ? "no associated PR"
        : `PR #${result.pr} (${escapeTable(result.pullRequest.title, 100)})`;
    const details =
      result.staleDetails.length > 0
        ? `; stale=${result.staleDetails
            .slice(0, 3)
            .map((detail) => escapeTable(detail, 100))
            .join(", ")}`
        : "";
    return `${escapeTable(result.repo, 64)}: ${association}; unsupported=${formatCount(result.unsupported)}${details}; comparison used immutable base and head SHAs.`;
  }
  return `${escapeTable(result.repo, 64)}: ERROR; numeric result unavailable (category=${result.errorCategory ?? "operational"}).`;
}

export function renderMarkdown(
  results,
  packageSpec = DEFAULT_PACKAGE_SPEC,
  oldResults,
) {
  const sorted = results
    .map((result) =>
      result.package === undefined
        ? { ...result, package: packageSpec }
        : result,
    )
    .sort(compareTargets);
  const lines = [
    "# Evaluations on external pull requests",
    "",
    "> Merged pull requests from 2025-01-01 to 2026-09-01 in TypeScript/JavaScript or Python",
    "> repositories with at least 2,000 stars that keep Markdown documentation in the",
    "> repository (root README and/or `docs/**/*.md`). Candidates were taken from the fixed",
    "> list below in order; each was labeled by reading the base commit before either",
    "> StaleDocs version ran. Labels: DOCS-UPDATED (a discovered document mentions the changed",
    "> public symbol and was modified in the PR), DOCS-STALE (mentions it and was not",
    "> modified), UNDOCUMENTED (no discovered document mentions it), INTERNAL (the changed",
    "> symbol is not reachable from the package entry), NO-PUBLIC-CHANGE (control: only",
    "> internals or non-code changed). No candidate was dropped after seeing tool output.",
    "",
    "The owner approved quota-driven skips within the fixed 27-candidate list and a documentation-only control before this corpus ran. All skipped candidates and reasons are recorded privately.",
    "",
    `Generated by \`node scripts/evaluate-external.mjs\` with \`${packageSpec}\`. Comparisons use immutable base and head SHAs. Evidence records timings; the public table omits timings and run dates for deterministic output. No comment, issue, or PR was posted to the evaluated repositories.`,
    "",
  ];
  if (oldResults !== undefined) {
    const oldByTarget = new Map(
      oldResults.map((result) => [targetEvidenceName(result), result]),
    );
    const oldPackage = oldResults[0]?.package;
    if (oldPackage === undefined || !PACKAGE_PATTERN.test(oldPackage))
      throw new Error("Comparison evidence has no old package identity.");
    lines.push(
      `| Repository | PR | Language | Expected | ${escapeTable(oldPackage, 64)} | ${escapeTable(packageSpec, 64)} | Match |`,
      "| --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const result of sorted) {
      const previous = oldByTarget.get(targetEvidenceName(result));
      if (previous === undefined)
        throw new Error("Comparison target is missing.");
      const oldOutcome = deriveOutcome(previous, result.expected);
      const newOutcome = deriveOutcome(result);
      lines.push(
        `| ${escapeTable(result.repo, 64)} | ${formatPullRequestCell(result)} | ${publicLanguage(result.language)} | ${result.expected?.label ?? "n/a"} | ${oldOutcome.observed} | ${newOutcome.observed} | old ${matchCell(oldOutcome.match)}, new ${matchCell(newOutcome.match)} |`,
      );
    }
    lines.push(
      "",
      `Matched expectation: old ${matchedCount(oldResults, sorted)}/${sorted.length}, new ${matchedCount(sorted, sorted)}/${sorted.length}`,
    );
  } else {
    lines.push(
      "| Repository | PR | Language | Public API changes | Breaking | Stale docs | Co-changed docs | Unmapped | Expected | Observed | Match |",
      "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |",
    );
    for (const result of sorted) {
      const names =
        result.firstChanges?.length > 0
          ? ` (${result.firstChanges
              .slice(0, 3)
              .map((name) => escapeTable(name, 64))
              .join(", ")})`
          : "";
      const metrics =
        result.status === "OK"
          ? [
              `${formatCount(result.publicApiChanges)}${names}`,
              formatCount(result.breaking),
              formatCount(result.staleDocuments),
              formatCount(result.coChangedDocuments),
              formatCount(result.unmappedSymbols),
            ]
          : ["ERROR", "n/a", "n/a", "n/a", "n/a"];
      const outcome = deriveOutcome(result);
      lines.push(
        `| ${escapeTable(result.repo, 64)} | ${formatPullRequestCell(result)} | ${publicLanguage(result.language)} | ${metrics.join(" | ")} | ${result.expected?.label ?? "n/a"} | ${outcome.observed} | ${matchCell(outcome.match)} |`,
      );
    }
    lines.push(
      "",
      `Matched expectation: ${packageSpec} ${matchedCount(sorted, sorted)}/${sorted.length}`,
    );
  }
  lines.push(
    "",
    "## Reading the table",
    "",
    "- Observed outcomes come from review JSON counts, not the proposed labels. Zero public changes takes precedence, then stale documents, then co-changed documents, then undocumented changes.",
    "- INTERNAL requires zero public changes and a positive internal-change count. The old package has no internal-change field: its observation is n/a and its match uses zero public changes.",
    "- DOCS-UPDATED means a document changed, not that its prose was verified as correct. DOCS-STALE means a document mentions the changed symbol and did not change.",
    "- ERROR rows remain in the corpus and do not match an expectation. No percentage or precision/recall claim is made.",
    "",
    "## Notes per repository",
    "",
    ...sorted.map(publicNote),
    "",
  );
  return lines.join("\n");
}

function matchCell(match) {
  return match === null ? "n/a" : match ? "yes" : "no";
}

function matchedCount(results, targets) {
  const expected = new Map(
    targets.map((target) => [targetEvidenceName(target), target.expected]),
  );
  return results.filter(
    (result) =>
      deriveOutcome(result, expected.get(targetEvidenceName(result))).match ===
      true,
  ).length;
}

export function assertNoLabelRegression(oldResults, newResults) {
  for (const label of EXPECTED_LABELS) {
    const targets = newResults.filter(
      (result) => result.expected?.label === label,
    );
    const identities = new Set(targets.map(targetEvidenceName));
    const old = oldResults.filter((result) =>
      identities.has(targetEvidenceName(result)),
    );
    if (matchedCount(targets, targets) < matchedCount(old, targets)) {
      throw new Error(
        `Expectation regression for ${label}; comparison stopped without changing labels.`,
      );
    }
  }
}

async function readBoundedJson(file, message) {
  let handle;
  try {
    handle = await fs.open(file, "r");
    const buffer = Buffer.alloc(MAX_OUTPUT_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_OUTPUT_BYTES) throw new Error(message);
    return JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    throw new Error(message);
  } finally {
    await handle?.close();
  }
}

export async function readComparisonEvidence(root, targets) {
  const results = [];
  let baseline;
  for (const target of targets) {
    const result = await readBoundedJson(
      path.join(root, targetEvidenceName(target), "metadata.json"),
      "Comparison evidence is missing, oversized, or invalid.",
    );
    baseline ??= result?.package;
    if (
      !isObject(result) ||
      result.repo !== target.repo ||
      result.pr !== target.pr ||
      result.base !== target.base ||
      result.head !== target.head ||
      typeof result.package !== "string" ||
      !PACKAGE_PATTERN.test(result.package) ||
      result.package === DEFAULT_PACKAGE_SPEC ||
      result.package !== baseline ||
      !["OK", "ERROR"].includes(result.status) ||
      (result.status === "OK" &&
        !["publicApiChanges", "staleDocuments", "coChangedDocuments"].every(
          (key) => isNonNegativeInteger(result[key]),
        )) ||
      (result.internalChanges !== undefined &&
        !isNonNegativeInteger(result.internalChanges))
    ) {
      throw new Error(
        "Comparison evidence does not match the immutable target and package.",
      );
    }
    results.push(result);
  }
  return results;
}

async function verifyPublishedVersion(evidenceRoot, packageSpec) {
  const versionCwd = await fs.mkdtemp(
    path.join(os.tmpdir(), "staledocs-version-"),
  );
  try {
    const result = await runProcess("npx", ["-y", packageSpec, "--version"], {
      cwd: versionCwd,
      env: makeChildEnvironment(),
    });
    await writeCommandEvidence(evidenceRoot, "package-version", result, false);
    const version = PACKAGE_PATTERN.exec(packageSpec)?.[1];
    if (
      result.outputLimitExceeded ||
      result.timedOut ||
      result.exitCode !== 0 ||
      result.stdout.trim() !== version
    ) {
      throw new Error("Published package version check failed.");
    }
  } finally {
    await fs.rm(versionCwd, { recursive: true, force: true });
  }
}

async function readManifest(manifestPath) {
  let text;
  try {
    text = await fs.readFile(manifestPath, "utf8");
  } catch {
    fail("Unable to read manifest.");
  }
  try {
    return validateManifest(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) fail("Manifest is not valid JSON.");
    throw error;
  }
}

async function canonicalizePotentialPath(candidate) {
  let current = path.resolve(candidate);
  const missing = [];
  while (true) {
    try {
      const resolved = await fs.realpath(current);
      return path.join(resolved, ...missing.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function publicWorktreeRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const result = await runGit(["rev-parse", "--show-toplevel"], scriptDir);
  if (
    result.outputLimitExceeded ||
    result.timedOut ||
    result.exitCode !== 0 ||
    result.stdout.trim().length === 0
  ) {
    throw new Error("Unable to locate the public Git worktree.");
  }
  return fs.realpath(result.stdout.trim());
}

async function assertEvidenceOutsideWorktree(candidate, worktreeRoot) {
  const resolved = await canonicalizePotentialPath(candidate);
  if (isWithin(worktreeRoot, resolved)) {
    throw new Error(
      "Evidence directory must be outside the public Git worktree.",
    );
  }
  return resolved;
}

async function prepareEvidenceRoot(evidenceRoot) {
  await fs.mkdir(evidenceRoot, { recursive: true });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const { manifestPath, outputPath, packageSpec, comparePath } = options;
  const targets = await readManifest(manifestPath);
  const worktreeRoot = await publicWorktreeRoot();
  const requestedEvidence =
    options.evidencePath ?? process.env.STALEDOCS_EVALUATION_EVIDENCE_DIR;
  const disposableEvidence =
    requestedEvidence === undefined || requestedEvidence.length === 0;
  const compareRoot =
    comparePath === undefined
      ? undefined
      : await assertEvidenceOutsideWorktree(comparePath, worktreeRoot);
  if (
    compareRoot !== undefined &&
    (packageSpec !== DEFAULT_PACKAGE_SPEC ||
      targets.some(
        (target) => target.expected === undefined || target.base === undefined,
      ))
  ) {
    fail(
      `Comparison requires labeled immutable targets and ${DEFAULT_PACKAGE_SPEC}.`,
    );
  }
  let evidenceRoot;
  if (disposableEvidence) {
    await assertEvidenceOutsideWorktree(os.tmpdir(), worktreeRoot);
    evidenceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "staledocs-evidence-"),
    );
  } else {
    evidenceRoot = await assertEvidenceOutsideWorktree(
      requestedEvidence,
      worktreeRoot,
    );
  }
  if (
    compareRoot !== undefined &&
    (isWithin(compareRoot, evidenceRoot) || isWithin(evidenceRoot, compareRoot))
  ) {
    throw new Error("Old and new evidence directories must not overlap.");
  }
  const results = [];
  const started = performance.now();
  try {
    const previous =
      compareRoot === undefined
        ? undefined
        : await readComparisonEvidence(compareRoot, targets);
    await prepareEvidenceRoot(evidenceRoot);
    await fs.rm(path.join(evidenceRoot, "run-metadata.json"), { force: true });
    await verifyPublishedVersion(evidenceRoot, packageSpec);
    const version = PACKAGE_PATTERN.exec(packageSpec)[1];
    await fs.writeFile(
      path.join(evidenceRoot, "package-version-proof.json"),
      `${JSON.stringify({ package: packageSpec, version }, null, 2)}\n`,
      "utf8",
    );
    for (const target of targets)
      results.push(
        publicResult(await runTarget(target, evidenceRoot, packageSpec)),
      );
    await fs.writeFile(
      path.join(evidenceRoot, "run-metadata.json"),
      `${JSON.stringify(
        {
          package: packageSpec,
          version,
          trustPolicy: TRUST_POLICY,
          totalElapsedMs: performance.now() - started,
          completed: true,
          targets: results,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    if (previous !== undefined) assertNoLabelRegression(previous, results);
    const markdown = renderMarkdown(results, packageSpec, previous);
    await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await fs.writeFile(outputPath, markdown, "utf8");
    console.log(
      markdown
        .split("\n")
        .find((line) => line.startsWith("Matched expectation:")),
    );
  } finally {
    if (disposableEvidence)
      await fs.rm(evidenceRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Evaluation failed.",
    );
    process.exitCode = 1;
  });
}
