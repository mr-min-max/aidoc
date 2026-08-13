import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getConfiguredSmokeTarball } from "./smoke-tarball.mjs";

const PACK_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 120_000;
const MCP_OPERATION_TIMEOUT_MS = 5_000;
const fakeProviderKey = ["sk", "proj", "M".repeat(32)].join("-");
const fakeFormatterKey = ["sk", "proj", "F".repeat(32)].join("-");
const rawSentinel = "AIDOC_MCP_RAW_SOURCE_MUST_NOT_LEAK";
const root = mkdtempSync(join(tmpdir(), "aidoc-mcp-smoke-"));
let client;
let transport;
let originalGitConfig;

function createThrowingConfigFixture(name, source) {
  const directory = join(root, name);
  mkdirSync(directory);
  writeFileSync(join(directory, ".aidocrc.cjs"), source);
  return directory;
}

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

function repositoryTreeHash(directory) {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: directory,
    encoding: "buffer",
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file, "utf8");
    hash.update("\0", "utf8");
    hash.update(readFileSync(join(directory, file)));
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

async function runProviderFreeRoundTrip(cliPath, fixture, base, head, label) {
  const localClient = new Client({ name: `aidoc-${label}`, version: "1.0.0" });
  const localTransport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, "--mcp"],
    cwd: fixture,
    env: credentialFreeEnv(),
  });
  try {
    await withTimeout(
      localClient.connect(localTransport),
      `${label} initialization`,
    );
    const before = repositoryTreeHash(fixture);
    const listed = await withTimeout(
      localClient.listTools(),
      `${label} tools/list`,
    );
    assert.ok(
      listed.tools.some((tool) => tool.name === "prepare_documentation_update"),
    );
    assert.ok(
      listed.tools.some((tool) => tool.name === "validate_documentation_draft"),
    );

    const preparationResult = await withTimeout(
      localClient.callTool({
        name: "prepare_documentation_update",
        arguments: { base, head },
      }),
      `${label} prepare_documentation_update`,
    );
    assert.notEqual(preparationResult.isError, true);
    const preparationText = preparationResult.content.find(
      (item) => item.type === "text",
    );
    assert.ok(preparationText && "text" in preparationText);
    const preparation = JSON.parse(preparationText.text);
    assert.equal(preparation.schema_version, "aidoc.mcp-update-preparation.v1");
    assert.equal(preparation.target, "README.md");
    assert.match(preparation.preparation_digest, /^v1\./u);
    assert.equal(preparation.generation.prompt.includes(rawSentinel), false);
    assert.equal(repositoryTreeHash(fixture), before);

    const candidate = "# MCP fixture\n\nUpdated by the host.\n";
    const validationResult = await withTimeout(
      localClient.callTool({
        name: "validate_documentation_draft",
        arguments: {
          preparation_digest: preparation.preparation_digest,
          target: preparation.target,
          candidate_markdown: candidate,
        },
      }),
      `${label} validate_documentation_draft`,
    );
    assert.notEqual(validationResult.isError, true);
    const validationText = validationResult.content.find(
      (item) => item.type === "text",
    );
    assert.ok(validationText && "text" in validationText);
    const validation = JSON.parse(validationText.text);
    assert.equal(validation.schema_version, "aidoc.mcp-draft-validation.v1");
    assert.equal(validation.valid, true);
    assert.equal(validation.approved_markdown, candidate);
    assert.equal(repositoryTreeHash(fixture), before);

    const tampered = preparation.preparation_digest.endsWith("A")
      ? `${preparation.preparation_digest.slice(0, -1)}B`
      : `${preparation.preparation_digest.slice(0, -1)}A`;
    const tamperedResult = await withTimeout(
      localClient.callTool({
        name: "validate_documentation_draft",
        arguments: {
          preparation_digest: tampered,
          target: preparation.target,
          candidate_markdown: candidate,
        },
      }),
      `${label} tampered validation`,
    );
    assert.equal(tamperedResult.isError, true);
    const tamperedText = tamperedResult.content.find(
      (item) => item.type === "text",
    );
    assert.ok(tamperedText && "text" in tamperedText);
    assert.match(tamperedText.text, /^MCP_INVALID_PREPARATION:/u);
    assert.equal(repositoryTreeHash(fixture), before);
  } finally {
    await localClient.close().catch(() => {});
    await localTransport.close().catch(() => {});
  }
}

function terminateProcessTree(child) {
  if (!child.pid) return;

  if (process.platform === "win32") {
    const taskkill = spawn(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    taskkill.unref();
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // The process may have exited between the timeout and this cleanup.
  }

  setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // The process was already terminated.
    }
  }, 1_000).unref();
}

async function runCommand(command, args, options = {}) {
  const { cwd, timeout } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, timeout);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      const output = Buffer.concat(stdout).toString("utf8");
      const errors = Buffer.concat(stderr).toString("utf8");
      if (timedOut) {
        reject(
          new Error(
            `${command} ${args.join(" ")} timed out after ${timeout}ms${errors ? `: ${errors}` : ""}`,
          ),
        );
      } else if (code !== 0) {
        reject(
          new Error(
            `${command} ${args.join(" ")} exited with ${code ?? signal}${errors ? `: ${errors}` : ""}`,
          ),
        );
      } else {
        resolve(output);
      }
    });
  });
}

async function withTimeout(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${label} timed out after ${MCP_OPERATION_TIMEOUT_MS}ms`,
              ),
            ),
          MCP_OPERATION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

try {
  let tarball = getConfiguredSmokeTarball();
  if (tarball === null) {
    const packOutput = await runCommand(
      "npm",
      ["pack", "--json", "--pack-destination", root],
      { cwd: resolve("."), timeout: PACK_TIMEOUT_MS },
    );
    const [{ filename }] = JSON.parse(packOutput);
    tarball = join(root, filename);
  }

  const consumer = join(root, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "aidoc-mcp-consumer", private: true }),
  );
  await runCommand("npm", ["install", "--ignore-scripts", tarball], {
    cwd: consumer,
    timeout: INSTALL_TIMEOUT_MS,
  });

  const fixture = join(root, "fixture-repo");
  mkdirSync(join(fixture, "src"), { recursive: true });
  const emptyGitTemplate = join(fixture, "empty-git-template");
  const hostileHooks = join(fixture, "hostile-hooks");
  const hostileGitConfig = join(fixture, "hostile.gitconfig");
  mkdirSync(join(emptyGitTemplate, "hooks"), { recursive: true });
  mkdirSync(hostileHooks);
  writeFileSync(
    join(hostileHooks, "pre-commit"),
    "#!/usr/bin/env bash\nexit 1\n",
  );
  chmodSync(join(hostileHooks, "pre-commit"), 0o755);
  writeFileSync(
    hostileGitConfig,
    `[commit]\n\tgpgSign = true\n[core]\n\thooksPath = ${hostileHooks}\n`,
  );
  originalGitConfig = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = hostileGitConfig;
  writeFileSync(join(fixture, "README.md"), "# MCP fixture\n");
  writeFileSync(
    join(fixture, "src", "index.ts"),
    [
      "export function api(value: number): number {",
      `  return value + 1; // ${rawSentinel}`,
      "}",
      "export function helper(value: number): number {",
      "  return value * 2;",
      "}",
      "",
    ].join("\n"),
  );
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "commit.gpgSign=false",
        "-c",
        `core.hooksPath=${join(emptyGitTemplate, "hooks")}`,
        ...args,
      ],
      {
        cwd: fixture,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  git("init", "--quiet", `--template=${emptyGitTemplate}`);
  git("config", "user.name", "aidoc test");
  git("config", "user.email", "aidoc-test@example.invalid");
  git("add", ".");
  git("commit", "-m", "fixture: baseline");
  const base = git("rev-parse", "HEAD");
  writeFileSync(
    join(fixture, "src", "index.ts"),
    [
      "export function api(value: number, scale = 1): number {",
      `  return value + scale; // ${rawSentinel}`,
      "}",
      "export function helper(value: number): number {",
      "  return value * 3;",
      "}",
      "",
    ].join("\n"),
  );
  git("add", ".");
  git("commit", "-m", "fixture: source change");
  const head = git("rev-parse", "HEAD");

  const packedCli = join(
    consumer,
    "node_modules",
    "aidoc-gen",
    "dist",
    "cli",
    "index.js",
  );
  await runProviderFreeRoundTrip(
    resolve("dist/cli/index.js"),
    fixture,
    base,
    head,
    "built-mcp",
  );
  client = new Client({ name: "aidoc-smoke", version: "1.0.0" });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [packedCli, "--mcp"],
    cwd: fixture,
    env: credentialFreeEnv(),
  });

  await withTimeout(client.connect(transport), "MCP initialization");
  const packedPackage = JSON.parse(
    readFileSync(
      join(consumer, "node_modules", "aidoc-gen", "package.json"),
      "utf8",
    ),
  );
  assert.equal(client.getServerVersion()?.version, packedPackage.version);
  const { tools } = await withTimeout(client.listTools(), "MCP tools/list");
  assert.ok(tools.some((tool) => tool.name === "analyze_codebase"));
  const impactTool = tools.find(
    (tool) => tool.name === "plan_documentation_impact",
  );
  assert.ok(impactTool);
  const checkTool = tools.find((tool) => tool.name === "check_docs_freshness");
  assert.ok(checkTool);
  assert.match(checkTool.description ?? "", /co-change/i);

  const result = await withTimeout(
    client.callTool({
      name: "analyze_codebase",
      arguments: {
        directory: resolve("tests/fixtures"),
        include: "**/*.ts",
        exclude: "",
      },
    }),
    "MCP analyze_codebase",
  );
  assert.notEqual(result.isError, true);
  const text = result.content.find((item) => item.type === "text");
  assert.ok(text && "text" in text);
  const payload = JSON.parse(text.text);
  assert.ok(payload.totalModules >= 1);

  const cliPlanOutput = execFileSync(
    process.execPath,
    [packedCli, "plan", "--base", base, "--head", head, "--json"],
    {
      cwd: fixture,
      encoding: "utf8",
      env: credentialFreeEnv(),
    },
  );
  const cliPlanResult = JSON.parse(cliPlanOutput);
  assert.equal(cliPlanResult.ok, true);
  assert.equal(cliPlanOutput.includes(rawSentinel), false);
  assert.equal(
    cliPlanResult.plan.changes.filter(
      (change) => change.category === "contract-changed",
    ).length,
    1,
  );
  assert.equal(
    cliPlanResult.plan.changes.filter(
      (change) => change.category === "implementation-changed",
    ).length,
    1,
  );

  const impactResult = await withTimeout(
    client.callTool({
      name: "plan_documentation_impact",
      arguments: { base, head },
    }),
    "MCP plan_documentation_impact",
  );
  assert.notEqual(impactResult.isError, true);
  const impactText = impactResult.content.find((item) => item.type === "text");
  assert.ok(impactText && "text" in impactText);
  const mcpPlan = JSON.parse(impactText.text);
  assert.deepEqual(mcpPlan, cliPlanResult.plan);
  assert.equal(impactText.text.includes(rawSentinel), false);

  await runProviderFreeRoundTrip(packedCli, fixture, base, head, "packed-mcp");

  const errorResult = await withTimeout(
    client.callTool({
      name: `unknown-${fakeProviderKey}`,
      arguments: {},
    }),
    "MCP sanitized error",
  );
  assert.equal(errorResult.isError, true);
  const errorText = errorResult.content.find((item) => item.type === "text");
  assert.ok(errorText && "text" in errorText);
  assert.match(errorText.text, /<AIDOC_REDACTED:OPENAI_API_KEY:1>/);
  assert.equal(errorText.text.includes(fakeProviderKey), false);

  const hostileConfigFixtures = [
    {
      label: "throwing message getter",
      directory: createThrowingConfigFixture(
        "hostile-message-getter",
        `const error = new Error("unused");
Object.defineProperty(error, "message", {
  get() { throw new Error("${fakeFormatterKey}"); },
});
throw error;
`,
      ),
    },
    {
      label: "throwing code getter",
      directory: createThrowingConfigFixture(
        "hostile-code-getter",
        `const error = new Error("safe provider failure");
let codeReads = 0;
Object.defineProperty(error, "code", {
  get() {
    codeReads += 1;
    if (codeReads <= 4) return "NOT_A_FILE_ERROR";
    throw new Error("${fakeFormatterKey}");
  },
});
throw error;
`,
      ),
    },
    {
      label: "throwing instanceof check",
      directory: createThrowingConfigFixture(
        "hostile-instanceof",
        `const target = new Error("unused");
const error = new Proxy(target, {
  get(current, property, receiver) {
    if (property === "code") return "NOT_A_FILE_ERROR";
    return Reflect.get(current, property, receiver);
  },
  getPrototypeOf() { throw new Error("${fakeFormatterKey}"); },
});
throw error;
`,
      ),
    },
    {
      label: "non-string message",
      directory: createThrowingConfigFixture(
        "hostile-message-type",
        `const error = new Error("unused");
Object.defineProperty(error, "message", {
  value: { secret: "${fakeFormatterKey}" },
});
throw error;
`,
      ),
    },
  ];

  for (const { label, directory } of hostileConfigFixtures) {
    const hostileResult = await withTimeout(
      client.callTool({
        name: "generate_readme",
        arguments: { directory },
      }),
      `MCP ${label}`,
    );
    assert.equal(hostileResult.isError, true);
    const hostileText = hostileResult.content.find(
      (item) => item.type === "text",
    );
    assert.ok(hostileText && "text" in hostileText);
    assert.equal(hostileText.text, "Unknown MCP error.", label);
    assert.equal(hostileText.text.includes(fakeFormatterKey), false);
  }

  const checkResult = await withTimeout(
    client.callTool({
      name: "check_docs_freshness",
      arguments: {
        directory: fixture,
        doc_file: "README.md",
        since: base,
      },
    }),
    "MCP check_docs_freshness",
  );
  assert.notEqual(checkResult.isError, true);
  const checkText = checkResult.content.find((item) => item.type === "text");
  assert.ok(checkText && "text" in checkText);
  assert.equal(JSON.parse(checkText.text).status, "stale");
} finally {
  if (client) {
    await client.close().catch(() => {});
  }
  await transport?.close().catch(() => {});
  rmSync(root, { recursive: true, force: true });
  if (originalGitConfig === undefined) {
    delete process.env.GIT_CONFIG_GLOBAL;
  } else {
    process.env.GIT_CONFIG_GLOBAL = originalGitConfig;
  }
}
