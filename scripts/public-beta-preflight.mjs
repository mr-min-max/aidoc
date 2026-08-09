#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const POLICY_SCHEMA = "aidoc.public-beta-policy.v1";
const REPORT_SCHEMA = "aidoc.public-beta-preflight.v1";
const MAX_GIT_OUTPUT_BYTES = 128 * 1024 * 1024;
const ROOT_POLICY_KEYS = [
  "allowedAutomationEmails",
  "candidateBranch",
  "canonicalRepository",
  "defaultBranch",
  "protectedIdentities",
  "schemaVersion",
];
const IDENTITY_KEYS = ["emails", "name"];

class InvocationError extends Error {}
class GitOperationError extends Error {}

function hasExactKeys(value, expectedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

function isSafeText(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isEmail(value) {
  return isSafeText(value) && /^[^\s@]+@[^\s@]+$/u.test(value);
}

function isUniqueStringArray(value, validator) {
  return (
    Array.isArray(value) &&
    value.every(validator) &&
    new Set(value).size === value.length
  );
}

function validatePolicy(value) {
  if (!hasExactKeys(value, ROOT_POLICY_KEYS)) {
    throw new InvocationError("Invalid policy.");
  }
  if (
    value.schemaVersion !== POLICY_SCHEMA ||
    !isSafeText(value.canonicalRepository) ||
    !/^[^/\s]+\/[^/\s]+$/u.test(value.canonicalRepository) ||
    !isSafeText(value.defaultBranch) ||
    !isSafeText(value.candidateBranch) ||
    !Array.isArray(value.protectedIdentities) ||
    value.protectedIdentities.length === 0 ||
    !isUniqueStringArray(value.allowedAutomationEmails, isEmail)
  ) {
    throw new InvocationError("Invalid policy.");
  }

  const names = new Set();
  const protectedEmails = new Set();
  for (const identity of value.protectedIdentities) {
    if (
      !hasExactKeys(identity, IDENTITY_KEYS) ||
      !isSafeText(identity.name) ||
      !isUniqueStringArray(identity.emails, isEmail) ||
      identity.emails.length === 0 ||
      names.has(identity.name)
    ) {
      throw new InvocationError("Invalid policy.");
    }
    names.add(identity.name);
    for (const email of identity.emails) {
      if (protectedEmails.has(email)) {
        throw new InvocationError("Invalid policy.");
      }
      protectedEmails.add(email);
    }
  }

  for (const email of value.allowedAutomationEmails) {
    if (protectedEmails.has(email)) {
      throw new InvocationError("Invalid policy.");
    }
  }

  return value;
}

async function loadPolicy(policyPath) {
  try {
    const source = await readFile(policyPath, "utf8");
    return validatePolicy(JSON.parse(source));
  } catch (error) {
    if (error instanceof InvocationError) {
      throw error;
    }
    throw new InvocationError("Invalid policy.");
  }
}

async function gitText(repositoryRoot, args) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    });
    return stdout;
  } catch {
    throw new GitOperationError("Git operation failed.");
  }
}

async function gitExitCode(repositoryRoot, args) {
  try {
    await execFileAsync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    });
    return 0;
  } catch (error) {
    if (typeof error?.code === "number") {
      return error.code;
    }
    throw new GitOperationError("Git operation failed.");
  }
}

function normalizeRepositoryUrl(remoteUrl) {
  const trimmed = remoteUrl.trim().replace(/\.git$/u, "");
  if (trimmed.startsWith("git@github.com:")) {
    return trimmed.slice("git@github.com:".length).toLowerCase();
  }
  if (trimmed.startsWith("ssh://git@github.com/")) {
    return trimmed.slice("ssh://git@github.com/".length).toLowerCase();
  }
  if (trimmed.startsWith("https://github.com/")) {
    return trimmed.slice("https://github.com/".length).toLowerCase();
  }
  return "";
}

async function enumerateRetainedRefs(repositoryRoot) {
  const output = await gitText(repositoryRoot, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/heads",
    "refs/remotes/origin",
    "refs/tags",
  ]);
  return [...new Set(output.split("\n").filter(Boolean))].sort();
}

async function enumerateCommits(repositoryRoot, refs) {
  if (refs.length === 0) {
    throw new GitOperationError("No retained refs.");
  }
  const output = await gitText(repositoryRoot, ["rev-list", ...refs]);
  return [...new Set(output.split("\n").filter(Boolean))].sort();
}

function parseIdentityRecords(output) {
  return output
    .split("\0\0")
    .map((record) => record.replace(/^\n+|\n+$/gu, ""))
    .filter(Boolean)
    .map((record) => {
      const fields = record.split("\0");
      if (fields.length !== 5) {
        throw new GitOperationError("Invalid identity record.");
      }
      return {
        commit: fields[0],
        authorName: fields[1],
        authorEmail: fields[2],
        committerName: fields[3],
        committerEmail: fields[4],
      };
    });
}

async function inspectIdentities(repositoryRoot, refs, policy) {
  const output = await gitText(repositoryRoot, [
    "log",
    "--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%x00",
    ...refs,
  ]);
  const records = parseIdentityRecords(output);
  const identitiesByName = new Map(
    policy.protectedIdentities.map((identity) => [
      identity.name,
      new Set(identity.emails),
    ]),
  );
  const protectedEmails = new Set(
    policy.protectedIdentities.flatMap((identity) => identity.emails),
  );
  const allowedEmails = new Set([
    ...protectedEmails,
    ...policy.allowedAutomationEmails,
  ]);
  const protectedCommits = new Set();
  let valid = true;

  for (const record of records) {
    for (const [name, email] of [
      [record.authorName, record.authorEmail],
      [record.committerName, record.committerEmail],
    ]) {
      const protectedIdentityEmails = identitiesByName.get(name);
      if (
        !allowedEmails.has(email) ||
        (protectedIdentityEmails && !protectedIdentityEmails.has(email))
      ) {
        valid = false;
      }
      if (protectedIdentityEmails || protectedEmails.has(email)) {
        protectedCommits.add(record.commit);
      }
    }
  }

  return { valid, protectedIdentityCommits: protectedCommits.size };
}

async function loadPrivateNeedles(repositoryRoot, privateNeedlesPath) {
  if (privateNeedlesPath === undefined) {
    return [];
  }
  if (!path.isAbsolute(privateNeedlesPath)) {
    throw new InvocationError("Invalid private needles file.");
  }

  const relativePath = path.relative(repositoryRoot, privateNeedlesPath);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new InvocationError("Invalid private needles file.");
  }

  const ignored = await gitExitCode(repositoryRoot, [
    "check-ignore",
    "--quiet",
    "--",
    relativePath,
  ]);
  if (ignored !== 0) {
    throw new InvocationError("Invalid private needles file.");
  }

  let source;
  try {
    source = await readFile(privateNeedlesPath, "utf8");
  } catch {
    throw new InvocationError("Invalid private needles file.");
  }
  const lines = source.split(/\r?\n/u);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  if (
    lines.length === 0 ||
    lines.some(
      (needle) => needle.length === 0 || /[\u0000\r\n]/u.test(needle),
    ) ||
    new Set(lines).size !== lines.length
  ) {
    throw new InvocationError("Invalid private needles file.");
  }
  return lines;
}

async function enumerateReachableObjects(repositoryRoot, refs) {
  const output = await gitText(repositoryRoot, [
    "rev-list",
    "--objects",
    "--no-object-names",
    ...refs,
  ]);
  return [...new Set(output.split("\n").filter(Boolean))].sort();
}

function scanBatchOutput(output, needles) {
  const needleBuffers = needles.map((needle) => Buffer.from(needle, "utf8"));
  const matchedIndexes = new Set();
  let offset = 0;

  while (offset < output.length) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd === -1) {
      throw new GitOperationError("Invalid batch output.");
    }
    const header = output.subarray(offset, headerEnd).toString("utf8");
    const fields = header.split(" ");
    if (fields.length !== 3) {
      throw new GitOperationError("Invalid batch output.");
    }
    const size = Number(fields[2]);
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      contentEnd >= output.length ||
      output[contentEnd] !== 0x0a
    ) {
      throw new GitOperationError("Invalid batch output.");
    }
    const content = output.subarray(contentStart, contentEnd);
    for (let index = 0; index < needleBuffers.length; index += 1) {
      if (
        !matchedIndexes.has(index) &&
        content.includes(needleBuffers[index])
      ) {
        matchedIndexes.add(index);
      }
    }
    offset = contentEnd + 1;
  }

  return matchedIndexes;
}

async function scanReachableObjects(repositoryRoot, objectIds, needles) {
  if (objectIds.length === 0 || needles.length === 0) {
    return new Set();
  }

  const output = await new Promise((resolve, reject) => {
    const child = spawn("git", ["cat-file", "--batch"], {
      cwd: repositoryRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks = [];
    let byteLength = 0;
    let exceededLimit = false;

    child.on("error", () =>
      reject(new GitOperationError("Git operation failed.")),
    );
    child.stderr.resume();
    child.stdout.on("data", (chunk) => {
      byteLength += chunk.length;
      if (byteLength > MAX_GIT_OUTPUT_BYTES) {
        exceededLimit = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.on("close", (code) => {
      if (exceededLimit || code !== 0) {
        reject(new GitOperationError("Git operation failed."));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(`${objectIds.join("\n")}\n`);
  });

  return scanBatchOutput(output, needles);
}

function makeCheck(id, status, summary) {
  return { id, status, summary };
}

export async function runPreflight({
  repositoryRoot,
  policyPath,
  privateNeedlesPath,
  mainRef,
  candidateRef,
}) {
  if (!path.isAbsolute(repositoryRoot) || !path.isAbsolute(policyPath)) {
    throw new InvocationError("Invalid invocation.");
  }

  const policy = await loadPolicy(policyPath);
  const selectedMainRef = mainRef ?? policy.defaultBranch;
  const selectedCandidateRef = candidateRef ?? policy.candidateBranch;
  if (!isSafeText(selectedMainRef) || !isSafeText(selectedCandidateRef)) {
    throw new InvocationError("Invalid invocation.");
  }
  const privateNeedles = await loadPrivateNeedles(
    repositoryRoot,
    privateNeedlesPath,
  );
  const checks = [];
  let refs = [];
  let commits = [];
  let protectedIdentityCommits = 0;
  let matchedPrivateNeedles = 0;

  try {
    const remoteUrl = await gitText(repositoryRoot, [
      "remote",
      "get-url",
      "origin",
    ]);
    const matches =
      normalizeRepositoryUrl(remoteUrl) ===
      policy.canonicalRepository.toLowerCase();
    checks.push(
      makeCheck(
        "canonical-remote",
        matches ? "pass" : "fail",
        matches
          ? "Canonical repository remote is configured."
          : "Canonical repository remote is not configured.",
      ),
    );
  } catch {
    checks.push(
      makeCheck(
        "canonical-remote",
        "fail",
        "Canonical repository remote could not be verified.",
      ),
    );
  }

  try {
    refs = await enumerateRetainedRefs(repositoryRoot);
    commits = await enumerateCommits(repositoryRoot, refs);
    checks.push(
      makeCheck(
        "retained-refs",
        "pass",
        `${refs.length} retained Git refs and ${commits.length} commits were enumerated.`,
      ),
    );
  } catch {
    checks.push(
      makeCheck(
        "retained-refs",
        "fail",
        "Retained Git refs could not be enumerated.",
      ),
    );
  }

  try {
    const ancestryExitCode = await gitExitCode(repositoryRoot, [
      "merge-base",
      "--is-ancestor",
      selectedMainRef,
      selectedCandidateRef,
    ]);
    checks.push(
      makeCheck(
        "branch-ancestry",
        ancestryExitCode === 0 ? "pass" : "fail",
        ancestryExitCode === 0
          ? "Main is an ancestor of the candidate."
          : "Main is not an ancestor of the candidate.",
      ),
    );
  } catch {
    checks.push(
      makeCheck(
        "branch-ancestry",
        "fail",
        "Branch ancestry could not be verified.",
      ),
    );
  }

  if (refs.length > 0) {
    try {
      const identityResult = await inspectIdentities(
        repositoryRoot,
        refs,
        policy,
      );
      protectedIdentityCommits = identityResult.protectedIdentityCommits;
      checks.push(
        makeCheck(
          "identity-policy",
          identityResult.valid ? "pass" : "fail",
          identityResult.valid
            ? `${protectedIdentityCommits} commits use an approved protected identity.`
            : "Reachable history contains an unapproved commit identity.",
        ),
      );
    } catch {
      checks.push(
        makeCheck(
          "identity-policy",
          "fail",
          "Commit identities could not be verified.",
        ),
      );
    }
  } else {
    checks.push(
      makeCheck(
        "identity-policy",
        "fail",
        "Commit identities could not be verified.",
      ),
    );
  }

  if (refs.length > 0 && privateNeedles.length > 0) {
    try {
      const objectIds = await enumerateReachableObjects(repositoryRoot, refs);
      const matchedIndexes = await scanReachableObjects(
        repositoryRoot,
        objectIds,
        privateNeedles,
      );
      const refText = refs.join("\n");
      privateNeedles.forEach((needle, index) => {
        if (refText.includes(needle)) {
          matchedIndexes.add(index);
        }
      });
      matchedPrivateNeedles = matchedIndexes.size;
      checks.push(
        makeCheck(
          "private-needles",
          matchedPrivateNeedles === 0 ? "pass" : "fail",
          matchedPrivateNeedles === 0
            ? "No private needles were found in retained history."
            : `${matchedPrivateNeedles} private needles were found in retained history.`,
        ),
      );
    } catch {
      checks.push(
        makeCheck(
          "private-needles",
          "fail",
          "Private history values could not be verified.",
        ),
      );
    }
  } else {
    checks.push(
      makeCheck(
        "private-needles",
        refs.length > 0 ? "pass" : "fail",
        refs.length > 0
          ? "No private needles were configured."
          : "Private history values could not be verified.",
      ),
    );
  }

  checks.sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: REPORT_SCHEMA,
    status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
    checks,
    counts: {
      refs: refs.length,
      commits: commits.length,
      protectedIdentityCommits,
      privateNeedles: matchedPrivateNeedles,
    },
  };
}

function parseArguments(argv) {
  const options = { json: false };
  const valueFlags = new Map([
    ["--repository-root", "repositoryRoot"],
    ["--policy", "policyPath"],
    ["--private-needles", "privateNeedlesPath"],
    ["--main-ref", "mainRef"],
    ["--candidate-ref", "candidateRef"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    const key = valueFlags.get(argument);
    const value = argv[index + 1];
    if (!key || value === undefined || value.startsWith("--")) {
      throw new InvocationError("Invalid invocation.");
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function printHuman(report) {
  process.stdout.write(
    `Public beta preflight: ${report.status.toUpperCase()}\n`,
  );
  for (const check of report.checks) {
    process.stdout.write(`- ${check.status.toUpperCase()} ${check.summary}\n`);
  }
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    const repositoryRoot = path.resolve(
      options.repositoryRoot ?? process.cwd(),
    );
    const policyPath = path.resolve(
      repositoryRoot,
      options.policyPath ?? ".github/public-beta-policy.json",
    );
    const defaultNeedlesPath = path.resolve(
      repositoryRoot,
      ".private/public-beta-needles.txt",
    );
    const privateNeedlesPath = options.privateNeedlesPath
      ? path.resolve(options.privateNeedlesPath)
      : existsSync(defaultNeedlesPath)
        ? defaultNeedlesPath
        : undefined;
    const report = await runPreflight({
      repositoryRoot,
      policyPath,
      privateNeedlesPath,
      mainRef: options.mainRef,
      candidateRef: options.candidateRef,
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      printHuman(report);
    }
    process.exitCode = report.status === "pass" ? 0 : 1;
  } catch {
    if (options?.json) {
      process.stdout.write(
        `${JSON.stringify({
          schemaVersion: REPORT_SCHEMA,
          status: "error",
          error: "Public beta preflight invocation is invalid.",
        })}\n`,
      );
    } else {
      process.stderr.write("Public beta preflight invocation is invalid.\n");
    }
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
