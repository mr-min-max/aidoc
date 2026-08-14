import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const { load } = createRequire(import.meta.url)("js-yaml");

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const pluginRoot = path.join(repositoryRoot, "integrations", "codex", "aidoc");
const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const mcpPath = path.join(pluginRoot, ".mcp.json");
const skillPath = path.join(
  pluginRoot,
  "skills",
  "maintain-documentation",
  "SKILL.md",
);

function assertRelativeComponent(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.equal(path.isAbsolute(value), false, `${label} must be relative`);
  assert.equal(value.includes(".."), false, `${label} must not traverse`);
}

function parseSkill(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/u);
  assert.ok(match, "skill must contain YAML frontmatter");
  const frontmatter = load(match[1]);
  assert.equal(typeof frontmatter, "object");
  assert.equal(Array.isArray(frontmatter), false);
  assert.equal(frontmatter.name, "maintain-documentation");
  assert.equal(typeof frontmatter.description, "string");
  assert.ok(frontmatter.description.length > 0);
  assert.match(
    frontmatter.description,
    /\buse when\b[\s\S]*(?:user asks|asks to)[\s\S]*(?:plan|update|validate)[\s\S]*documentation/i,
    "skill description must state its user-trigger condition and goal",
  );
  assert.ok(match[2].trim().length > 0, "skill body must not be empty");
  return match[2];
}

function assertOrderedWorkflow(body) {
  const lower = body.toLowerCase();
  const prepareIndex = lower.indexOf("prepare_documentation_update");
  const generationIndex = lower.indexOf("generation.system_prompt");
  const promptIndex = lower.indexOf("generation.prompt");
  const validateIndex = lower.indexOf("validate_documentation_draft");
  const approvedIndex = lower.indexOf("approved_markdown");
  const writeIndex = Math.min(
    ...["write", "apply"].map((word) => lower.indexOf(word)),
  );
  const freshnessIndex = lower.indexOf("check_docs_freshness");

  assert.ok(prepareIndex >= 0, "skill must call prepare_documentation_update");
  assert.ok(
    generationIndex > prepareIndex && promptIndex > prepareIndex,
    "skill must generate from both bounded generation prompts",
  );
  assert.ok(
    validateIndex > generationIndex && validateIndex > promptIndex,
    "skill must validate after host generation",
  );
  assert.ok(
    approvedIndex > validateIndex,
    "skill must use approved_markdown after validation",
  );
  assert.ok(
    writeIndex > validateIndex,
    "skill must write only after validation",
  );
  assert.ok(
    freshnessIndex > writeIndex,
    "skill must check freshness after the write",
  );
}

function assertSafeWorkflow(body) {
  const lower = body.toLowerCase();
  for (const code of [
    "MCP_INVALID_PATH_INPUT",
    "MCP_DIRECTORY_DENIED",
    "MCP_UNSAFE_CONFIGURATION",
  ]) {
    assert.match(
      lower,
      new RegExp(code.toLowerCase()),
      `skill must recognize ${code}`,
    );
  }
  assert.match(
    lower,
    /(?:if|when)[\s\S]{0,260}(?:mcp_invalid_path_input|mcp_directory_denied|mcp_unsafe_configuration)[\s\S]{0,320}(?:stop|do not retry|never retry)/u,
    "skill must stop on MCP scope/config failures",
  );
  assert.match(
    lower,
    /never\s+(?:retry|try)[\s\S]{0,120}(?:another|different)[\s\S]{0,120}(?:directory|path)|do not guess[\s\S]{0,120}(?:directory|path)/u,
    "skill must not retry or guess a path after scope/config failure",
  );
  assert.match(
    lower,
    /correct[\s\S]{0,80}repository-relative path/u,
    "skill must tell the host how to correct an invalid path safely",
  );
  assert.match(lower, /multiple[\s\S]{0,240}(choose|select)/u);
  assert.match(lower, /never\s+guess|do\s+not\s+guess/u);
  assert.match(lower, /unchanged[\s\S]{0,240}preparation_digest/u);
  assert.match(
    lower,
    /invalid[\s\S]{0,120}(stale|blocked)|stale[\s\S]{0,120}(stop|re-prepare|reprepare)/u,
  );
  assert.match(
    lower,
    /normal host[\s\S]{0,120}(write )?permission|host[\s\S]{0,120}permission/u,
  );
  assert.match(lower, /repository-relative|relative target/u);
  assert.match(lower, /trust gate/u);
  assert.match(
    lower,
    /does not control[\s\S]{0,160}(context window|model)[\s\S]{0,160}(sandbox|permission)/u,
  );
  assert.match(lower, /does\s+not\s+ask[\s\S]{0,160}api\s+key/u);
  assert.match(lower, /subscription[\s\S]{0,160}(bridge|token|oauth)/u);
  assert.match(lower, /never bypass|do not bypass/u);
  const credentialInstruction = lower.match(
    /\b(?:do not|does not|never)?\s*(?:ask|tell|request|instruct)[\s\S]{0,160}(?:read|create|paste|forward)[\s\S]{0,160}(?:api key|oauth token)\b/u,
  );
  assert.ok(
    credentialInstruction === null ||
      /\b(?:do not|does not|never)\b/u.test(credentialInstruction[0]),
    "skill must not instruct the host to handle credentials",
  );
  assert.doesNotMatch(
    lower,
    /\b(?:use|provide|send|forward|pass|supply|share|handle)\b[\s\S]{0,120}\b(?:chatgpt|claude)\b[\s\S]{0,120}\b(?:api key|oauth token)\b/u,
  );
  for (const tool of [
    "generate_readme",
    "generate_api_docs",
    "generate_diagram",
  ]) {
    assert.match(
      lower,
      new RegExp(`do not call[\\s\\S]{0,180}${tool}`, "u"),
      `skill must prohibit ${tool}`,
    );
  }
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(manifest.name, "aidoc");
assert.equal(manifest.version, "0.2.0-beta.4");
assert.equal(
  manifest.description,
  "Plan, prepare, and validate AST-backed documentation updates.",
);
assert.deepEqual(manifest.author, { name: "aidoc contributors" });
assert.equal(manifest.repository, "https://github.com/mr-min-max/aidoc");
assert.equal(manifest.license, "MIT");
assert.deepEqual(manifest.keywords, ["documentation", "ast", "mcp", "codex"]);
assert.equal(manifest.skills, "./skills/");
assert.equal(manifest.mcpServers, "./.mcp.json");
assert.deepEqual(manifest.interface, {
  displayName: "AiDoc",
  shortDescription: "Safe AST-backed documentation maintenance.",
  longDescription:
    "Plan affected documentation, prepare bounded update context, and validate a draft before applying it.",
  developerName: "aidoc contributors",
  category: "Developer Tools",
  capabilities: ["Read", "Write"],
  defaultPrompt: [
    "Update the documentation affected by my code changes.",
    "Plan documentation impact without an API key.",
    "Validate this documentation draft before I apply it.",
  ],
});
assert.ok(manifest.interface.defaultPrompt.length <= 3);
for (const prompt of manifest.interface.defaultPrompt) {
  assert.ok(prompt.length <= 128);
}

for (const [key, value] of Object.entries(manifest)) {
  assert.equal(
    [
      "hooks",
      "marketplace",
      "authentication",
      "secrets",
      "tokens",
      "apps",
    ].includes(key),
    false,
    `manifest must not declare ${key}`,
  );
  if (typeof value === "string") {
    assert.equal(path.isAbsolute(value), false);
    assert.doesNotMatch(value, /\[TODO:|<your-|\/Users\/|\/home\//u);
  }
}
assertRelativeComponent(manifest.skills, "manifest.skills");
assertRelativeComponent(manifest.mcpServers, "manifest.mcpServers");

const mcp = JSON.parse(await readFile(mcpPath, "utf8"));
assert.deepEqual(Object.keys(mcp), ["mcpServers"]);
assert.deepEqual(Object.keys(mcp.mcpServers), ["aidoc"]);
assert.deepEqual(mcp.mcpServers.aidoc, {
  command: "aidoc",
  args: ["--mcp"],
});

const skillBody = parseSkill(await readFile(skillPath, "utf8"));
assertOrderedWorkflow(skillBody);
assertSafeWorkflow(skillBody);

process.stdout.write("Codex plugin smoke: PASS\n");
