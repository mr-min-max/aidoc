#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { promisify } from "node:util";
import { snapshotRepositoryTree } from "./hybrid-beta-snapshot.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repositoryRoot, "dist", "cli", "index.js");
const pluginSmokePath = path.join(
  repositoryRoot,
  "tests",
  "e2e",
  "codex-plugin-smoke.mjs",
);
const DEMO_SCHEMA = "aidoc.hybrid-beta-demo.v1";
// This demo is offline, credential-free, and makes no network request.
const FAKE_SECRET = ["sk", "proj", "M".repeat(32)].join("-");
const CHECK_NAMES = [
  "no_impact_plan_has_no_next_action",
  "one_target_auto_selected_in_mock_dry_run",
  "multiple_targets_require_selection",
  "all_targets_require_explicit_behavior",
  "mcp_prepare_validate_approved",
  "mcp_prepare_validate_did_not_write",
  "forged_preparation_blocked",
  "secret_candidate_redacted_or_blocked",
  "codex_plugin_smoke_passed",
];

function credentialFreeEnv() {
  const env = { ...process.env };
  for (const key of [
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
    "AIDOC_TRUST_POLICY",
  ]) {
    delete env[key];
  }
  return env;
}

async function git(cwd, args) {
  return execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...credentialFreeEnv(),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

async function commit(cwd, message) {
  await git(cwd, ["add", "."]);
  await git(cwd, ["commit", "--quiet", "-m", message]);
  return (await git(cwd, ["rev-parse", "HEAD"])).stdout.trim();
}

async function createFixture({ documents, noImpact = false }) {
  const cwd = await mkdtemp(path.join(tmpdir(), "aidoc-hybrid-beta-"));
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await git(cwd, ["init", "--quiet", "--initial-branch=main"]);
  await git(cwd, ["config", "user.name", "aidoc hybrid demo"]);
  await git(cwd, ["config", "user.email", "aidoc-demo@example.invalid"]);
  await writeFile(
    path.join(cwd, "src", "index.ts"),
    [
      "export function formatName(name: string): string {",
      "  return `Hello ${name}`;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  for (const document of documents) {
    await mkdir(path.dirname(path.join(cwd, document)), { recursive: true });
    await writeFile(
      path.join(cwd, document),
      `# Hybrid fixture\n\n## API\n\nUse \`formatName\` from the source module.\n`,
      "utf8",
    );
  }
  const base = await commit(cwd, "fixture: baseline");

  if (noImpact) {
    await writeFile(path.join(cwd, "notes.txt"), "No API impact.\n", "utf8");
  } else {
    await writeFile(
      path.join(cwd, "src", "index.ts"),
      [
        "export function formatName(name: string, excited = false): string {",
        "  return excited ? `Hello ${name}!` : `Hello ${name}`;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
  }
  const head = await commit(
    cwd,
    noImpact ? "fixture: unrelated note" : "fixture: API change",
  );
  return { cwd, base, head };
}

async function runCli(cwd, args) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: "utf8",
      env: credentialFreeEnv(),
      maxBuffer: 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: typeof error?.code === "number" ? error.code : 1,
      stdout: typeof error?.stdout === "string" ? error.stdout : "",
      stderr: typeof error?.stderr === "string" ? error.stderr : "",
    };
  }
}

function parseToolText(result) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") throw new Error("MCP text result missing");
  return JSON.parse(text);
}

async function runMcpEvidence(fixture) {
  const client = new Client({
    name: "aidoc-hybrid-beta-demo",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, "--mcp"],
    cwd: fixture.cwd,
    env: credentialFreeEnv(),
  });
  try {
    await client.connect(transport);
    const before = await snapshotRepositoryTree(fixture.cwd);
    const preparationResult = await client.callTool({
      name: "prepare_documentation_update",
      arguments: {
        base: fixture.base,
        head: fixture.head,
        target: "README.md",
      },
    });
    if (preparationResult.isError === true)
      throw new Error("MCP preparation failed");
    const preparation = parseToolText(preparationResult);
    if (
      preparation.schema_version !== "aidoc.mcp-update-preparation.v1" ||
      preparation.target !== "README.md" ||
      typeof preparation.preparation_digest !== "string" ||
      typeof preparation.generation?.system_prompt !== "string" ||
      typeof preparation.generation?.prompt !== "string"
    ) {
      throw new Error("MCP preparation shape failed");
    }
    const unchangedAfterPrepare =
      (await snapshotRepositoryTree(fixture.cwd)) === before;
    if (!unchangedAfterPrepare) {
      throw new Error("MCP preparation wrote the repository");
    }

    const candidate = "# Hybrid fixture\n\nValidated by the host.\n";
    const validationResult = await client.callTool({
      name: "validate_documentation_draft",
      arguments: {
        preparation_digest: preparation.preparation_digest,
        target: preparation.target,
        candidate_markdown: candidate,
      },
    });
    if (validationResult.isError === true)
      throw new Error("MCP validation failed");
    const validation = parseToolText(validationResult);
    const approved =
      validation.valid === true && validation.approved_markdown === candidate;
    const unchangedAfterValidation =
      (await snapshotRepositoryTree(fixture.cwd)) === before;

    const tamperedDigest = preparation.preparation_digest.endsWith("A")
      ? `${preparation.preparation_digest.slice(0, -1)}B`
      : `${preparation.preparation_digest.slice(0, -1)}A`;
    const forgedResult = await client.callTool({
      name: "validate_documentation_draft",
      arguments: {
        preparation_digest: tamperedDigest,
        target: preparation.target,
        candidate_markdown: candidate,
      },
    });
    const forgedText = forgedResult.content?.find(
      (item) => item.type === "text",
    )?.text;
    const forgedBlocked =
      forgedResult.isError === true &&
      typeof forgedText === "string" &&
      forgedText.startsWith("MCP_INVALID_PREPARATION:");
    const unchangedAfterForged =
      (await snapshotRepositoryTree(fixture.cwd)) === before;

    const secretResult = await client.callTool({
      name: "validate_documentation_draft",
      arguments: {
        preparation_digest: preparation.preparation_digest,
        target: preparation.target,
        candidate_markdown: `# Hybrid fixture\n\nContact: ${FAKE_SECRET}\n`,
      },
    });
    const secretValidation =
      secretResult.isError === true ? undefined : parseToolText(secretResult);
    const secretSafe =
      secretResult.isError === true ||
      (typeof secretValidation?.approved_markdown === "string" &&
        !secretValidation.approved_markdown.includes(FAKE_SECRET)) ||
      ["redacted", "blocked"].includes(secretValidation?.trust?.action);
    const unchangedAfterSecret =
      (await snapshotRepositoryTree(fixture.cwd)) === before;

    const freshnessResult = await client.callTool({
      name: "check_docs_freshness",
      arguments: {
        directory: fixture.cwd,
        doc_file: "README.md",
        since: fixture.base,
      },
    });
    if (freshnessResult.isError === true)
      throw new Error("MCP freshness check failed");
    const unchangedAfterFreshness =
      (await snapshotRepositoryTree(fixture.cwd)) === before;

    return {
      approved,
      noWrite: [
        unchangedAfterPrepare,
        unchangedAfterValidation,
        unchangedAfterForged,
        unchangedAfterSecret,
        unchangedAfterFreshness,
      ].every(Boolean),
      forgedBlocked,
      secretSafe,
    };
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

function emptyChecks() {
  return Object.fromEntries(CHECK_NAMES.map((name) => [name, false]));
}

async function runDemo() {
  const noImpactFixture = await createFixture({
    documents: ["README.md"],
    noImpact: true,
  });
  const singleTargetFixture = await createFixture({
    documents: ["README.md"],
  });
  const multipleTargetFixture = await createFixture({
    documents: ["docs/API.md", "docs/guide.md"],
  });

  try {
    const noImpact = await runCli(noImpactFixture.cwd, [
      "plan",
      "--base",
      noImpactFixture.base,
      "--head",
      noImpactFixture.head,
    ]);
    const noImpactCheck =
      noImpact.code === 0 && !noImpact.stdout.includes("Next: aidoc update");

    const singleBefore = await snapshotRepositoryTree(singleTargetFixture.cwd);
    const singleTarget = await runCli(singleTargetFixture.cwd, [
      "update",
      "--base",
      singleTargetFixture.base,
      "--mock",
      "--dry-run",
    ]);
    const singleAfter = await snapshotRepositoryTree(singleTargetFixture.cwd);
    const singleCheck =
      singleTarget.code === 0 &&
      singleTarget.stdout.includes("Target: README.md") &&
      singleBefore === singleAfter;

    const multipleBefore = await snapshotRepositoryTree(
      multipleTargetFixture.cwd,
    );
    const multiple = await runCli(multipleTargetFixture.cwd, [
      "update",
      "--base",
      multipleTargetFixture.base,
      "--mock",
      "--dry-run",
    ]);
    const multipleMessage = `${multiple.stdout}\n${multiple.stderr}`;
    const multipleCheck =
      multiple.code !== 0 &&
      multipleMessage.includes("Multiple documentation targets") &&
      (await snapshotRepositoryTree(multipleTargetFixture.cwd)) ===
        multipleBefore;

    const allBefore = await snapshotRepositoryTree(multipleTargetFixture.cwd);
    const all = await runCli(multipleTargetFixture.cwd, [
      "update",
      "--base",
      multipleTargetFixture.base,
      "--mock",
      "--dry-run",
      "--all",
    ]);
    const allAfter = await snapshotRepositoryTree(multipleTargetFixture.cwd);
    const allMessage = `${all.stdout}\n${all.stderr}`;
    const allCheck =
      all.code === 0 &&
      allMessage.includes(
        "Update progress: 2 of 2 selected targets processed.",
      ) &&
      allBefore === allAfter &&
      allMessage.includes("Generated docs/API.md") &&
      allMessage.includes("Generated docs/guide.md");

    const mcp = await runMcpEvidence(singleTargetFixture);
    let plugin;
    try {
      const pluginResult = await execFileAsync(
        process.execPath,
        [pluginSmokePath],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: credentialFreeEnv(),
          maxBuffer: 1024 * 1024,
        },
      );
      plugin = {
        code: 0,
        stdout: pluginResult.stdout,
        stderr: pluginResult.stderr,
      };
    } catch (error) {
      plugin = {
        code: typeof error?.code === "number" ? error.code : 1,
        stdout: "",
        stderr: "",
      };
    }

    const checks = {
      no_impact_plan_has_no_next_action: noImpactCheck,
      one_target_auto_selected_in_mock_dry_run: singleCheck,
      multiple_targets_require_selection: multipleCheck,
      all_targets_require_explicit_behavior: allCheck,
      mcp_prepare_validate_approved: mcp.approved,
      mcp_prepare_validate_did_not_write: mcp.noWrite,
      forged_preparation_blocked: mcp.forgedBlocked,
      secret_candidate_redacted_or_blocked: mcp.secretSafe,
      codex_plugin_smoke_passed: plugin.code === 0,
    };
    return {
      schema_version: DEMO_SCHEMA,
      status: Object.values(checks).every(Boolean) ? "pass" : "fail",
      checks,
      tools: [
        "prepare_documentation_update",
        "validate_documentation_draft",
        "check_docs_freshness",
      ],
      providers: ["none"],
      fixtures: [
        "no-impact",
        "single-target",
        "multiple-targets",
        "provider-free-mcp",
      ],
      counts: {
        affected_targets: 2,
        secret_findings: 1,
      },
    };
  } finally {
    await Promise.all([
      rm(noImpactFixture.cwd, { recursive: true, force: true }),
      rm(singleTargetFixture.cwd, { recursive: true, force: true }),
      rm(multipleTargetFixture.cwd, { recursive: true, force: true }),
    ]);
  }
}

try {
  const report = await runDemo();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = report.status === "pass" ? 0 : 1;
} catch {
  process.stdout.write(
    `${JSON.stringify({
      schema_version: DEMO_SCHEMA,
      status: "fail",
      checks: emptyChecks(),
      tools: [],
      providers: ["none"],
      fixtures: [
        "no-impact",
        "single-target",
        "multiple-targets",
        "provider-free-mcp",
      ],
      counts: { affected_targets: 0, secret_findings: 0 },
    })}\n`,
  );
  process.exitCode = 1;
}
