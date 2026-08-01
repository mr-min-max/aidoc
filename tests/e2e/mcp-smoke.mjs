import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
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
    "export function api(): number { return 1; }\n",
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
    "export function api(): number { return 2; }\n",
  );
  git("add", ".");
  git("commit", "-m", "fixture: source change");

  const packedCli = join(
    consumer,
    "node_modules",
    "aidoc-gen",
    "dist",
    "cli",
    "index.js",
  );
  client = new Client({ name: "aidoc-smoke", version: "1.0.0" });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [packedCli, "--mcp"],
    cwd: consumer,
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
