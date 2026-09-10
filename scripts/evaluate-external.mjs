#!/usr/bin/env node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACKAGE_VERSION = "0.3.0-beta.1";
const PACKAGE_SPEC = `staledocs@${PACKAGE_VERSION}`;
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
  return "Usage: node scripts/evaluate-external.mjs <manifest.json> --out <markdown-file>";
}

function fail(message) {
  throw new Error(`${message}\n\n${usage()}`);
}

function parseArgs(argv) {
  if (argv.length < 3) fail("Expected a manifest path and --out path.");
  const manifestPath = argv[0];
  if (argv[1] !== "--out" || argv[2].length === 0 || argv.length !== 3) {
    fail("Expected --out followed by an output path.");
  }
  return { manifestPath, outputPath: argv[2] };
}

function validateManifest(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("Manifest must be a JSON object.");
  }
  assertExactKeys(value, ["version", "targets"], "manifest");
  if (value.version !== 1) fail("Manifest version must be 1.");
  if (!Array.isArray(value.targets) || value.targets.length === 0) {
    fail("Manifest targets must be a non-empty array.");
  }

  const repos = new Set();
  const comparisons = new Set();
  return value.targets.map((target, index) => {
    if (typeof target !== "object" || target === null || Array.isArray(target)) {
      fail(`Target ${index + 1} must be an object.`);
    }
    assertExactKeys(target, ["repo", "language", "base", "head", "pr"], `target ${index + 1}`);
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
    if (repos.has(repo)) fail(`Target ${index + 1} duplicates a repository.`);
    repos.add(repo);
    if (!["typescript", "javascript", "python"].includes(language)) {
      fail(`Target ${index + 1} has an invalid language.`);
    }
    if (hasPr && (!Number.isInteger(pr) || pr <= 0)) {
      fail(`Target ${index + 1} has an invalid PR number.`);
    }
    if (hasBase) {
      if (typeof base !== "string" || !SHA_PATTERN.test(base)) {
        fail(`Target ${index + 1} has an invalid base SHA.`);
      }
      if (typeof head !== "string" || !SHA_PATTERN.test(head)) {
        fail(`Target ${index + 1} has an invalid head SHA.`);
      }
      if (base === head) fail(`Target ${index + 1} must compare different SHAs.`);
      const comparison = `${base}:${head}`;
      if (comparisons.has(comparison)) fail(`Target ${index + 1} duplicates a comparison.`);
      comparisons.add(comparison);
    }
    return Object.freeze({
      repo,
      language,
      ...(hasPr ? { pr } : {}),
      ...(hasBase ? { base, head } : {}),
    });
  });
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
        const remaining = Math.max(0, MAX_OUTPUT_BYTES - Buffer.byteLength(stderr));
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
  return sanitizeText(value, max).replaceAll("|", "\\|");
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
        .map((section) => `${escapeTable(document.path, 48)} > ${escapeTable(section.section, 48)}`),
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
  const status = await runGit(["status", "--porcelain=v1", "--untracked-files=all"], cloneDir);
  const unstaged = await runGit(["diff", "--no-ext-diff", "--exit-code"], cloneDir);
  const staged = await runGit(["diff", "--cached", "--no-ext-diff", "--exit-code"], cloneDir);
  const results = [status, unstaged, staged];
  const boundedFailure = results.find((result) => result.outputLimitExceeded || result.timedOut);
  if (boundedFailure !== undefined) {
    throw new TargetFailure(processFailureCategory(boundedFailure), "repository status check failed");
  }
  if (status.exitCode !== 0 || ![0, 1].includes(unstaged.exitCode) || ![0, 1].includes(staged.exitCode)) {
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
  const checkout = await runGit(["checkout", "--detach", "--quiet", target.head], cloneDir);
  requireSuccessfulProcess(checkout, "checkout failed");
  const head = await runGit(["rev-parse", "HEAD"], cloneDir);
  const base = await runGit(["rev-parse", `${target.base}^{commit}`], cloneDir);
  requireSuccessfulProcess(head, "head verification failed");
  requireSuccessfulProcess(base, "base verification failed");
  if (head.stdout.trim() !== target.head || base.stdout.trim() !== target.base) {
    throw new TargetFailure("operational", "checked-out comparison did not match the resolved SHAs");
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function matchesSnapshot(value, commit) {
  return isObject(value) && value.type === "git" && typeof value.label === "string" && value.commit === commit;
}

function validateReviewEnvelope(reviewJson, target) {
  if (!isObject(reviewJson) || reviewJson.schemaVersion !== REVIEW_SCHEMA_VERSION) return false;
  if (!matchesSnapshot(reviewJson.base, target.base) || !matchesSnapshot(reviewJson.head, target.head)) return false;
  if (!isObject(reviewJson.summary)) return false;
  const summaryKeys = [
    "publicApiChanges",
    "breaking",
    "staleDocuments",
    "coChangedDocuments",
    "unmappedSymbols",
    "suppressed",
  ];
  if (!summaryKeys.every((key) => isNonNegativeInteger(reviewJson.summary[key]))) return false;
  if (!Array.isArray(reviewJson.changes) || !reviewJson.changes.every((change) => isObject(change) && typeof change.qualifiedName === "string")) return false;
  if (!Array.isArray(reviewJson.documents) || !reviewJson.documents.every((document) =>
    isObject(document) &&
    typeof document.path === "string" &&
    ["stale", "co-changed"].includes(document.status) &&
    Array.isArray(document.sections) &&
    document.sections.every((section) => isObject(section) && typeof section.section === "string")
  )) return false;
  return Array.isArray(reviewJson.unmapped) &&
    reviewJson.unmapped.every((name) => typeof name === "string") &&
    Array.isArray(reviewJson.suppressed) &&
    ["clean", "stale", "breaking"].includes(reviewJson.verdict);
}

function validatePlanEnvelope(planJson, target) {
  if (!isObject(planJson) || planJson.ok !== true || !isObject(planJson.plan)) return false;
  const plan = planJson.plan;
  return plan.schemaVersion === PLAN_SCHEMA_VERSION &&
    matchesSnapshot(plan.base, target.base) &&
    matchesSnapshot(plan.head, target.head) &&
    isObject(plan.summary) &&
    Array.isArray(plan.changes) &&
    Array.isArray(plan.documentation) &&
    isObject(plan.ignored) &&
    isNonNegativeInteger(plan.ignored.unsupported);
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
  await writeCommandEvidence(targetEvidence, "pull-request", commandResult, false);
  requireSuccessfulProcess(commandResult, "pull-request API request failed");

  let parsed;
  try {
    parsed = JSON.parse(commandResult.stdout);
  } catch {
    throw new TargetFailure("pr-validation", "pull-request response was not valid JSON");
  }
  if (!isObject(parsed)) {
    throw new TargetFailure("pr-validation", "pull-request response was not an object");
  }
  const pullRequest = {
    number: parsed.number,
    title: typeof parsed.title === "string" ? sanitizeText(parsed.title, 160) : "",
    html_url: typeof parsed.html_url === "string" ? parsed.html_url.slice(0, 200) : "",
    merged_at: typeof parsed.merged_at === "string" ? parsed.merged_at.slice(0, 64) : null,
    base_sha: typeof parsed.base?.sha === "string" ? parsed.base.sha.slice(0, 64) : "",
    head_sha: typeof parsed.head?.sha === "string" ? parsed.head.sha.slice(0, 64) : "",
    merge_commit_sha: typeof parsed.merge_commit_sha === "string" ? parsed.merge_commit_sha.slice(0, 64) : "",
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
    throw new TargetFailure("pr-validation", "pull-request metadata validation failed");
  }

  if (target.base !== undefined) {
    if (target.base !== pullRequest.base_sha) {
      throw new TargetFailure("pr-validation", "associated pull-request base did not match");
    }
    if (target.head !== pullRequest.head_sha && target.head !== pullRequest.merge_commit_sha) {
      throw new TargetFailure("pr-validation", "associated pull-request head did not match");
    }
    return { target, pullRequest };
  }
  if (pullRequest.base_sha === pullRequest.head_sha) {
    throw new TargetFailure("pr-validation", "pull-request comparison SHAs were identical");
  }
  return {
    target: Object.freeze({ ...target, base: pullRequest.base_sha, head: pullRequest.head_sha }),
    pullRequest,
  };
}

async function runTarget(manifestTarget, evidenceRoot) {
  const started = performance.now();
  const targetEvidence = path.join(evidenceRoot, targetEvidenceName(manifestTarget));
  await fs.rm(targetEvidence, { recursive: true, force: true });
  await fs.mkdir(targetEvidence, { recursive: true });
  let cloneDir;
  const result = {
    repo: manifestTarget.repo,
    language: manifestTarget.language,
    ...(manifestTarget.pr === undefined ? {} : { pr: manifestTarget.pr }),
    ...(manifestTarget.base === undefined ? {} : { base: manifestTarget.base, head: manifestTarget.head }),
    package: PACKAGE_SPEC,
    evidenceDirName: path.basename(targetEvidence),
    commands: [],
    status: "ERROR",
    elapsedMs: 0,
    pullRequest: null,
  };
  let pendingWriteError;
  try {
    const resolved = await resolvePullRequest(manifestTarget, targetEvidence);
    const target = resolved.target;
    result.pullRequest = resolved.pullRequest;
    result.base = target.base;
    result.head = target.head;
    cloneDir = await fs.mkdtemp(path.join(os.tmpdir(), "staledocs-evaluation-"));
    await cloneTarget(target, cloneDir);
    result.beforeClean = (await assertCleanOrStop(cloneDir, targetEvidence, "before")).clean;

    let reviewJson = null;
    let planJson = null;
    try {
      const commands = [
        ["review-json", ["review", "--base", target.base, "--head", target.head, "--format", "json"], true],
        ["review-markdown", ["review", "--base", target.base, "--head", target.head, "--format", "markdown"], false],
        ["plan-json", ["plan", "--base", target.base, "--head", target.head, "--json"], true],
      ];
      for (const [name, args, parseJson] of commands) {
        const commandResult = await runProcess(
          "npx",
          ["-y", PACKAGE_SPEC, ...args],
          { cwd: cloneDir, env: makeChildEnvironment() },
        );
        result.commands.push(commandRecord(commandResult, false));
        const parsed = await writeCommandEvidence(targetEvidence, name, commandResult, parseJson);
        requireSuccessfulProcess(commandResult, `${name} command failed`);
        if (parseJson && parsed === null) {
          throw new TargetFailure("schema", `${name} output was not valid JSON`);
        }
        if (name === "review-json") reviewJson = parsed;
        if (name === "plan-json") planJson = parsed;
      }
    } finally {
      result.afterClean = (await assertCleanOrStop(cloneDir, targetEvidence, "after")).clean;
    }

    if (!validateReviewEnvelope(reviewJson, target) || !validatePlanEnvelope(planJson, target)) {
      throw new TargetFailure("schema", "output schema or comparison validation failed");
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
  } catch (error) {
    if (error instanceof WriteDetectedError) {
      result.status = "WRITE DETECTED";
      result.errorCategory = "write-detected";
      result.error = error.message;
      pendingWriteError = error;
      await fs.writeFile(path.join(targetEvidence, "write-detected.txt"), `${error.message}\n`, "utf8");
    } else {
      result.errorCategory = error instanceof TargetFailure ? error.category : "operational";
      result.error = error instanceof Error ? sanitizeText(error.message, 200) : "evaluation failed";
    }
  } finally {
    result.elapsedMs = performance.now() - started;
    await fs.writeFile(
      path.join(targetEvidence, "metadata.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    if (cloneDir !== undefined) await fs.rm(cloneDir, { recursive: true, force: true });
  }
  if (pendingWriteError !== undefined) throw pendingWriteError;
  return result;
}
function publicResult(result) {
  return {
    repo: result.repo,
    language: result.language,
    ...(result.pr === undefined ? {} : { pr: result.pr }),
    ...(result.base === undefined ? {} : { base: result.base, head: result.head }),
    status: result.status,
    elapsedMs: result.elapsedMs,
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
        }
      : { errorCategory: result.errorCategory }),
  };
}

function formatCount(value) {
  return typeof value === "number" ? String(value) : "n/a";
}

function formatSeconds(milliseconds) {
  if (typeof milliseconds !== "number") return "n/a";
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function formatPullRequestCell(result) {
  if (result.pr === undefined) return "n/a";
  if (result.pullRequest === null) return `[#${result.pr}](${canonicalPullRequestUrl(result)})`;
  const title = escapeTable(result.pullRequest.title, 100);
  const url = escapeTable(result.pullRequest.html_url, 200);
  return `[#${result.pr}](${url}) ${title}`;
}

function publicNote(result) {
  if (result.status === "OK") {
    const association = result.pr === undefined
      ? "no associated PR"
      : `PR #${result.pr} (${escapeTable(result.pullRequest.title, 100)})`;
    const details = result.staleDetails.length > 0 ? `; stale=${result.staleDetails.join(", ")}` : "";
    return `${escapeTable(result.repo, 64)}: ${association}; unsupported=${formatCount(result.unsupported)}${details}; comparison used immutable base and head SHAs.`;
  }
  return `${escapeTable(result.repo, 64)}: ERROR; numeric result unavailable (category=${result.errorCategory ?? "operational"}).`;
}

function renderMarkdown(results) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    "# Evaluations on external pull requests",
    "",
    `Generated by \`node scripts/evaluate-external.mjs\` with \`${PACKAGE_SPEC}\` on ${date}. This is an initial ${results.length}-repository evaluation using immutable base and head comparisons. The PR column identifies a validated merged pull request when one is associated. Runs are read-only and no comment, issue, or PR was posted to these repositories. Re-run the script to reproduce.`,
    "",
    "| Repository | PR | Language | Public API changes | Breaking | Stale docs | Co-changed docs | Unmapped | Time |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const result of results) {
    const names = result.firstChanges?.length > 0 ? ` (${result.firstChanges.join(", ")})` : "";
    const stale = result.staleDocuments > 0 && result.staleDetails?.length > 0
      ? `${result.staleDocuments} (${result.staleDetails.join(", ")})`
      : formatCount(result.staleDocuments);
    const metrics = result.status === "OK"
      ? [
          `${formatCount(result.publicApiChanges)}${names}`,
          formatCount(result.breaking),
          stale,
          formatCount(result.coChangedDocuments),
          formatCount(result.unmappedSymbols),
        ]
      : ["ERROR", "n/a", "n/a", "n/a", "n/a"];
    lines.push(`| ${escapeTable(result.repo, 64)} | ${formatPullRequestCell(result)} | ${publicLanguage(result.language)} | ${metrics.join(" | ")} | ${formatSeconds(result.elapsedMs)} |`);
  }
  lines.push(
    "",
    "## Reading the table",
    "",
    "- Stale docs means a section mentions a changed public symbol and was not modified in the comparison.",
    "- Unmapped symbols changed but are not mentioned in any Markdown under the repository root or docs/.",
    "- Rows with 0 public API changes are kept because they show the tool stays quiet on internal changes.",
    "- `unsupported` is the supplemental count reported by the published plan command; bounded details are recorded in the saved evidence and summarized below.",
    "",
    "## Notes per repository",
    "",
    ...results.map(publicNote),
    "",
    `This page reports an initial ${results.length}-repository evaluation. It does not claim completion of a larger evidence phase.`,
    "",
  );
  return lines.join("\n");
}

async function verifyPublishedVersion(evidenceRoot) {
  const versionCwd = await fs.mkdtemp(path.join(os.tmpdir(), "staledocs-version-"));
  try {
    const result = await runProcess(
      "npx",
      ["-y", PACKAGE_SPEC, "--version"],
      { cwd: versionCwd, env: makeChildEnvironment() },
    );
    await writeCommandEvidence(evidenceRoot, "package-version", result, false);
    if (result.outputLimitExceeded || result.timedOut || result.exitCode !== 0 || result.stdout.trim() !== PACKAGE_VERSION) {
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
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function publicWorktreeRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const result = await runGit(["rev-parse", "--show-toplevel"], scriptDir);
  if (result.outputLimitExceeded || result.timedOut || result.exitCode !== 0 || result.stdout.trim().length === 0) {
    throw new Error("Unable to locate the public Git worktree.");
  }
  return fs.realpath(result.stdout.trim());
}

async function assertEvidenceOutsideWorktree(candidate, worktreeRoot) {
  const resolved = await canonicalizePotentialPath(candidate);
  if (isWithin(worktreeRoot, resolved)) {
    throw new Error("Evidence directory must be outside the public Git worktree.");
  }
  return resolved;
}

async function prepareEvidenceRoot(evidenceRoot) {
  await fs.mkdir(evidenceRoot, { recursive: true });
}

async function main() {
  const { manifestPath, outputPath } = parseArgs(process.argv.slice(2));
  const targets = await readManifest(manifestPath);
  const worktreeRoot = await publicWorktreeRoot();
  const requestedEvidence = process.env.STALEDOCS_EVALUATION_EVIDENCE_DIR;
  const disposableEvidence = requestedEvidence === undefined || requestedEvidence.length === 0;
  let evidenceRoot;
  if (disposableEvidence) {
    await assertEvidenceOutsideWorktree(os.tmpdir(), worktreeRoot);
    evidenceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "staledocs-evidence-"));
  } else {
    evidenceRoot = await assertEvidenceOutsideWorktree(requestedEvidence, worktreeRoot);
  }

  const results = [];
  const started = performance.now();
  try {
    await prepareEvidenceRoot(evidenceRoot);
    await fs.rm(path.join(evidenceRoot, "run-metadata.json"), { force: true });
    await verifyPublishedVersion(evidenceRoot);
    await fs.writeFile(
      path.join(evidenceRoot, "package-version-proof.json"),
      `${JSON.stringify({ package: PACKAGE_SPEC, version: PACKAGE_VERSION }, null, 2)}\n`,
      "utf8",
    );
    for (const target of targets) {
      results.push(publicResult(await runTarget(target, evidenceRoot)));
    }
    await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await fs.writeFile(outputPath, renderMarkdown(results), "utf8");
    const totalElapsedMs = performance.now() - started;
    await fs.writeFile(
      path.join(evidenceRoot, "run-metadata.json"),
      `${JSON.stringify({
        package: PACKAGE_SPEC,
        version: PACKAGE_VERSION,
        trustPolicy: TRUST_POLICY,
        totalElapsedMs,
        completed: true,
        targets: results,
      }, null, 2)}\n`,
      "utf8",
    );
  } finally {
    if (disposableEvidence) await fs.rm(evidenceRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Evaluation failed.");
    process.exitCode = 1;
  });
}
