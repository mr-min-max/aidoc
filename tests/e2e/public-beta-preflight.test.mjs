import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";

import { runPreflight } from "../../scripts/public-beta-preflight.mjs";

const execFileAsync = promisify(execFile);
const PREFLIGHT_SCRIPT = path.resolve("scripts/public-beta-preflight.mjs");
const APPROVED_EMAIL = "100+tester@users.noreply.github.com";
const PRIVATE_EMAIL = "private-person@example.invalid";

async function git(repositoryRoot, args) {
  return execFileAsync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
}

async function setIdentity(repositoryRoot, email = APPROVED_EMAIL) {
  await git(repositoryRoot, ["config", "user.name", "tester"]);
  await git(repositoryRoot, ["config", "user.email", email]);
}

async function commitFile(repositoryRoot, relativePath, content, message) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
  await git(repositoryRoot, ["add", relativePath]);
  await git(repositoryRoot, ["commit", "-m", message]);
}

async function createFixture(t) {
  const repositoryRoot = await mkdtemp(
    path.join(tmpdir(), "aidoc-public-beta-preflight-"),
  );
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));

  await git(repositoryRoot, ["init", "--initial-branch=main"]);
  await git(repositoryRoot, ["config", "commit.gpgsign", "false"]);
  await setIdentity(repositoryRoot);
  await git(repositoryRoot, [
    "remote",
    "add",
    "origin",
    "https://github.com/example/aidoc.git",
  ]);

  await writeFile(
    path.join(repositoryRoot, ".gitignore"),
    ".private/\n",
    "utf8",
  );
  await commitFile(
    repositoryRoot,
    "README.md",
    "# fixture\n",
    "initial fixture",
  );
  await git(repositoryRoot, ["branch", "codex/release-integrity"]);

  const policyPath = path.join(
    repositoryRoot,
    ".github",
    "public-beta-policy.json",
  );
  await mkdir(path.dirname(policyPath), { recursive: true });
  await writeFile(
    policyPath,
    `${JSON.stringify(
      {
        schemaVersion: "aidoc.public-beta-policy.v1",
        canonicalRepository: "example/aidoc",
        defaultBranch: "main",
        candidateBranch: "codex/release-integrity",
        protectedIdentities: [
          {
            name: "tester",
            emails: [APPROVED_EMAIL],
          },
        ],
        allowedAutomationEmails: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    repositoryRoot,
    policyPath,
    mainRef: "main",
    candidateRef: "codex/release-integrity",
  };
}

async function createNeedlesFile(repositoryRoot, needles) {
  const privateNeedlesPath = path.join(
    repositoryRoot,
    ".private",
    "public-beta-needles.txt",
  );
  await mkdir(path.dirname(privateNeedlesPath), { recursive: true });
  await writeFile(privateNeedlesPath, `${needles.join("\n")}\n`, "utf8");
  return privateNeedlesPath;
}

function findCheck(report, id) {
  const check = report.checks.find((candidate) => candidate.id === id);
  assert.ok(check, `missing check ${id}`);
  return check;
}

function assertValueSafe(report, fixture, privateValues = []) {
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(fixture.repositoryRoot), false);
  assert.equal(serialized.includes("@"), false);
  for (const value of privateValues) {
    assert.equal(serialized.includes(value), false);
  }
}

test("fails a protected identity using an unapproved email without echoing it", async (t) => {
  const fixture = await createFixture(t);
  await git(fixture.repositoryRoot, ["checkout", "codex/release-integrity"]);
  await setIdentity(fixture.repositoryRoot, PRIVATE_EMAIL);
  await commitFile(
    fixture.repositoryRoot,
    "private-author.txt",
    "identity fixture\n",
    "private author fixture",
  );

  const report = await runPreflight(fixture);

  assert.equal(report.status, "fail");
  assert.equal(findCheck(report, "identity-policy").status, "fail");
  assertValueSafe(report, fixture, [PRIVATE_EMAIL]);
});

test("passes the protected identity after rewriting it to the approved noreply", async (t) => {
  const fixture = await createFixture(t);
  await git(fixture.repositoryRoot, ["checkout", "codex/release-integrity"]);
  await setIdentity(fixture.repositoryRoot, PRIVATE_EMAIL);
  await commitFile(
    fixture.repositoryRoot,
    "rewritten.txt",
    "before rewrite\n",
    "rewrite fixture",
  );
  await setIdentity(fixture.repositoryRoot);
  await git(fixture.repositoryRoot, [
    "commit",
    "--amend",
    "--no-edit",
    "--reset-author",
  ]);

  const report = await runPreflight(fixture);

  assert.equal(report.status, "pass");
  assert.equal(findCheck(report, "identity-policy").status, "pass");
  assertValueSafe(report, fixture, [PRIVATE_EMAIL, APPROVED_EMAIL]);
});

test("fails when main is not an ancestor of the candidate", async (t) => {
  const fixture = await createFixture(t);
  await git(fixture.repositoryRoot, ["checkout", "main"]);
  await commitFile(
    fixture.repositoryRoot,
    "main-only.txt",
    "main advanced\n",
    "advance main",
  );

  const report = await runPreflight(fixture);

  assert.equal(report.status, "fail");
  assert.equal(findCheck(report, "branch-ancestry").status, "fail");
  assertValueSafe(report, fixture);
});

test("finds a private needle in reachable metadata or blobs without echoing it", async (t) => {
  const fixture = await createFixture(t);
  const metadataNeedle = "private-metadata-marker";
  const blobNeedle = "private-blob-marker";
  const privateNeedlesPath = await createNeedlesFile(fixture.repositoryRoot, [
    metadataNeedle,
    blobNeedle,
  ]);
  await git(fixture.repositoryRoot, ["checkout", "codex/release-integrity"]);
  await commitFile(
    fixture.repositoryRoot,
    "reachable.txt",
    `${blobNeedle}\n`,
    `fixture ${metadataNeedle}`,
  );

  const report = await runPreflight({ ...fixture, privateNeedlesPath });

  assert.equal(report.status, "fail");
  assert.equal(findCheck(report, "private-needles").status, "fail");
  assert.equal(report.counts.privateNeedles, 2);
  assertValueSafe(report, fixture, [metadataNeedle, blobNeedle]);
});

test("ignores unreachable objects and scans every retained branch and tag", async (t) => {
  const fixture = await createFixture(t);
  const privateNeedle = "retained-ref-private-marker";
  const privateNeedlesPath = await createNeedlesFile(fixture.repositoryRoot, [
    privateNeedle,
  ]);
  await git(fixture.repositoryRoot, ["checkout", "codex/release-integrity"]);
  await git(fixture.repositoryRoot, ["checkout", "-b", "private-topic"]);
  await commitFile(
    fixture.repositoryRoot,
    "retained.txt",
    `${privateNeedle}\n`,
    "retained branch fixture",
  );

  const branchReport = await runPreflight({ ...fixture, privateNeedlesPath });
  assert.equal(findCheck(branchReport, "private-needles").status, "fail");

  await git(fixture.repositoryRoot, ["tag", "private-retained-tag"]);
  await git(fixture.repositoryRoot, ["checkout", "codex/release-integrity"]);
  await git(fixture.repositoryRoot, ["branch", "-D", "private-topic"]);
  const tagReport = await runPreflight({ ...fixture, privateNeedlesPath });
  assert.equal(findCheck(tagReport, "private-needles").status, "fail");

  await git(fixture.repositoryRoot, ["tag", "-d", "private-retained-tag"]);
  const unreachableReport = await runPreflight({
    ...fixture,
    privateNeedlesPath,
  });
  assert.equal(unreachableReport.status, "pass");
  assert.equal(unreachableReport.counts.privateNeedles, 0);
  assertValueSafe(unreachableReport, fixture, [privateNeedle]);
});

test("emits deterministic schema-valid JSON with fixed diagnostic text", async (t) => {
  const fixture = await createFixture(t);

  const first = await runPreflight(fixture);
  const second = await runPreflight(fixture);

  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, "aidoc.public-beta-preflight.v1");
  assert.equal(first.status, "pass");
  assert.deepEqual(
    first.checks.map((check) => check.id),
    [...first.checks.map((check) => check.id)].sort(),
  );
  for (const check of first.checks) {
    assert.match(check.summary, /^[a-z0-9 ,.:-]+$/i);
  }
  assertValueSafe(first, fixture, [APPROVED_EMAIL]);
});

test("loads an ignored private needles file from the CLI flag or environment", async (t) => {
  const fixture = await createFixture(t);
  const privateNeedlesPath = await createNeedlesFile(fixture.repositoryRoot, [
    "absent-private-marker",
  ]);
  const commonArguments = [
    PREFLIGHT_SCRIPT,
    "--json",
    "--repository-root",
    fixture.repositoryRoot,
    "--policy",
    fixture.policyPath,
  ];

  const fromFlag = await execFileAsync(
    process.execPath,
    [...commonArguments, "--private-needles-file", privateNeedlesPath],
    { encoding: "utf8" },
  );
  const flagReport = JSON.parse(fromFlag.stdout);
  assert.equal(flagReport.status, "pass");
  assert.equal(
    findCheck(flagReport, "private-needles").summary,
    "No private needles were found in retained history.",
  );

  const fromEnvironment = await execFileAsync(
    process.execPath,
    commonArguments,
    {
      encoding: "utf8",
      env: {
        ...process.env,
        AIDOC_PRIVATE_NEEDLES_FILE: privateNeedlesPath,
      },
    },
  );
  const environmentReport = JSON.parse(fromEnvironment.stdout);
  assert.deepEqual(environmentReport, flagReport);
  assertValueSafe(environmentReport, fixture, ["absent-private-marker"]);
});
