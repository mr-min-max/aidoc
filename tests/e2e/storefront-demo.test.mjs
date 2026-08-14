import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");
const script = path.join(root, "scripts", "demo-hybrid-beta.mjs");

test("renders the exact provider-free storefront story", async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [script, "--presentation"],
    { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    [
      "AiDoc storefront demo",
      "Change: createUser(email) -> createUser(email, role)",
      "Impact: README.md, docs/API.md",
      "Host contract: prepare -> host draft -> validate",
      "Provider calls: none",
      "Repository writes: none",
      "Result: PASS",
      "",
    ].join("\n"),
  );
});

test("presentation output is value-free", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [script, "--presentation"],
    { cwd: root, encoding: "utf8" },
  );
  for (const forbidden of [
    root,
    "/Users/",
    "/home/",
    "sk-proj-",
    "preparation_digest",
    "system_prompt",
    "candidate_markdown",
  ]) {
    assert.equal(stdout.includes(forbidden), false);
  }
});
