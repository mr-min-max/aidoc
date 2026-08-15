import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const readmePath = "README.md";
const detailPaths = [
  "docs/CLI.md",
  "docs/GITHUB_ACTION.md",
  "docs/PUBLIC_BETA.md",
  "docs/integrations/codex.md",
  "docs/integrations/claude.md",
];
const sections = [
  "Create docs and keep them current",
  "How a code change becomes a docs update",
  "See the workflow",
  "What AiDoc can do",
  "Why AST-first matters",
  "Quick starts",
  "Safety and boundaries",
  "Supported languages and current limits",
  "Contributing and feedback",
];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
}

const readme = read(readmePath);
const details = Object.fromEntries(
  detailPaths.map((relativePath) => [relativePath, read(relativePath)]),
);
const corpus = [readme, ...Object.values(details)].join("\n");

function collapseWhitespace(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function markdownDestinations(source) {
  return [
    ...source.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/gu),
  ].map(([, destination]) => destination.replace(/^<|>$/gu, ""));
}

function htmlDestinations(source) {
  return [...source.matchAll(/\b(?:href|src)=["']([^"']+)["']/giu)].map(
    ([, destination]) => destination,
  );
}

function isExternal(destination) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(destination);
}

function localTarget(sourcePath, destination) {
  if (
    destination.length === 0 ||
    destination.startsWith("#") ||
    isExternal(destination)
  ) {
    return null;
  }
  const withoutQueryOrFragment = destination.split(/[?#]/u, 1)[0];
  if (withoutQueryOrFragment.length === 0) return null;
  return path.resolve(
    path.dirname(path.join(root, sourcePath)),
    withoutQueryOrFragment,
  );
}

function localReferences() {
  return [readmePath, ...detailPaths].flatMap((sourcePath) => {
    const source = read(sourcePath);
    return [
      ...markdownDestinations(source),
      ...htmlDestinations(source),
    ].flatMap((destination) => {
      const absolutePath = localTarget(sourcePath, destination);
      return absolutePath === null
        ? []
        : [{ sourcePath, destination, absolutePath }];
    });
  });
}

test("uses the exact progressive storefront section order", () => {
  const actualSections = [...readme.matchAll(/^##\s+(.+)$/gmu)].map(
    ([, title]) => title.trim(),
  );
  assert.deepEqual(actualSections, sections);
  assert.doesNotMatch(readme, /^##\s+[^\n]*[\p{Extended_Pictographic}]/gmu);
});

test("keeps the exact hero, beta notice, install, badges, and demo flow contract", () => {
  const firstHeadingIndex = readme.search(/^##\s+/mu);
  assert.ok(firstHeadingIndex > 0, "README must contain a level-two section");
  const firstScreen = readme.slice(0, firstHeadingIndex);

  assert.match(
    firstScreen,
    /<p align="center">\s*<img src="\.\/docs\/assets\/demo\/aidoc-flow-poster-source\.png" alt="AiDoc: Documentation that keeps up with your code\. A code change becomes an impact plan and a reviewable documentation update\." width="900">\s*<\/p>/u,
  );
  assert.doesNotMatch(firstScreen, /aidoc-wordmark\.svg/u);
  assert.match(
    firstScreen,
    /<p align="center"><strong>Public beta<\/strong><\/p>/u,
  );
  assert.doesNotMatch(
    firstScreen,
    /<p align="center"><strong>Documentation that keeps up with your code\.<\/strong><\/p>/u,
  );
  assert.ok(
    collapseWhitespace(firstScreen).includes(
      "AiDoc helps Codex, Claude, or a supported model create READMEs, API docs, changelogs, diagrams, and code comments, then keep them aligned as code changes. It analyzes code structure first, focuses the relevant context, and keeps change-driven updates reviewable.",
    ),
    "hero supporting copy must remain exact",
  );
  assert.match(
    firstScreen,
    /```bash\s*npm install -g @mr-min-max\/aidoc-gen@beta\s+aidoc\s*```/u,
  );

  for (const badge of [
    "[![npm beta](https://img.shields.io/npm/v/@mr-min-max/aidoc-gen/beta?label=npm%20beta)](https://www.npmjs.com/package/@mr-min-max/aidoc-gen)",
    "[![CI](https://github.com/mr-min-max/aidoc/actions/workflows/ci.yml/badge.svg)](https://github.com/mr-min-max/aidoc/actions/workflows/ci.yml)",
    "[![License: MIT](https://img.shields.io/badge/license-MIT-3FB950.svg)](./LICENSE)",
    "[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-58A6FF.svg)](https://nodejs.org/)",
  ]) {
    assert.ok(firstScreen.includes(badge), `missing exact badge: ${badge}`);
  }
  const badgeCount = firstScreen.match(/^\[!\[[^\n]+$/gmu)?.length ?? 0;
  assert.ok(
    badgeCount <= 4,
    `expected at most four badges, found ${badgeCount}`,
  );

  assert.match(
    firstScreen,
    /!\[AiDoc turns a code signature change into a validated documentation update\]\(\.\/docs\/assets\/demo\/aidoc-flow\.gif\)/u,
  );
  assert.doesNotMatch(firstScreen, /\[Static demo poster\]/u);
  assert.ok(
    collapseWhitespace(firstScreen).includes(
      "Code signature change -> impact plan -> focused README/API draft -> validation -> maintainer review.",
    ),
    "static demo explanation must remain beside the animation",
  );
  assert.match(
    firstScreen,
    /> \[!NOTE\]\s*> This source targets `0\.2\.0-beta\.6`\. The `@beta` install command resolves to the currently published npm beta; the \[Public Beta guide\]\(\.\/docs\/PUBLIC_BETA\.md\) records the verified release state\./u,
  );
  assert.doesNotMatch(
    firstScreen,
    /beta\.6[^\n]*(?:unpublished|forthcoming)/iu,
  );

  const cleanDemo = [
    "git clone https://github.com/mr-min-max/aidoc.git",
    "cd aidoc",
    "npm ci",
    "npm run demo:storefront",
  ];
  let cleanDemoIndex = -1;
  for (const command of cleanDemo) {
    const nextIndex = readme.indexOf(command);
    assert.ok(nextIndex > cleanDemoIndex, `${command} must appear in order`);
    cleanDemoIndex = nextIndex;
  }
});

test("resolves every local Markdown and HTML reference and validates local images", () => {
  const missingDetails = detailPaths.filter(
    (relativePath) => !existsSync(path.join(root, relativePath)),
  );
  assert.deepEqual(
    missingDetails,
    [],
    "every linked detail document must exist",
  );

  const references = localReferences();
  const missing = references.filter(
    ({ absolutePath }) => !existsSync(absolutePath),
  );
  assert.deepEqual(
    missing,
    [],
    `unresolved local references: ${missing.map(({ sourcePath, destination }) => `${sourcePath} -> ${destination}`).join(", ")}`,
  );

  for (const reference of references) {
    if (
      !/\.(?:svg|gif|png)$/iu.test(reference.destination.split(/[?#]/u, 1)[0])
    ) {
      continue;
    }
    const bytes = readFileSync(reference.absolutePath);
    const extension = path.extname(reference.absolutePath).toLowerCase();
    if (extension === ".svg") {
      const source = bytes.toString("utf8");
      assert.match(source, /<svg\b/iu, `${reference.destination} must be SVG`);
      assert.doesNotMatch(source, /<script\b|javascript:|<foreignObject\b/iu);
    } else if (extension === ".gif") {
      assert.match(bytes.toString("ascii", 0, 6), /^GIF(?:87a|89a)$/u);
      assert.ok(bytes.readUInt16LE(6) > 0 && bytes.readUInt16LE(8) > 0);
    } else {
      assert.deepEqual(
        [...bytes.subarray(0, 8)],
        [137, 80, 78, 71, 13, 10, 26, 10],
        `${reference.destination} must be PNG`,
      );
      assert.equal(bytes.toString("ascii", 12, 16), "IHDR");
      assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
    }
  }
});

test("shows both documentation jobs and all three honest model paths", () => {
  assert.match(
    readme,
    /Create docs and keep them current[\s\S]{0,900}Create project docs/iu,
  );
  assert.match(readme, /Keep docs current|Keep documentation current/iu);
  assert.match(readme, /Connect/iu);
  assert.match(readme, /provider-free[\s\S]{0,220}(?:plan|check|score)/iu);
  assert.match(
    readme,
    /host-managed MCP[\s\S]{0,260}(?:provider-free|no provider|never writes)/iu,
  );
  assert.match(
    readme,
    /direct provider[\s\S]{0,260}(?:credential|API key)[\s\S]{0,180}Ollama/iu,
  );
  assert.match(
    readme,
    /seeded demo|clean repository[\s\S]{0,180}(?:demo|storefront)/iu,
  );
  assert.match(readme, /changed repository[\s\S]{0,220}bare `aidoc`/iu);
  assert.match(
    readme,
    /initial generation|first document[\s\S]{0,260}(?:provider|Ollama)/iu,
  );
  assert.match(readme, /Codex host|Codex integration/iu);
  assert.match(readme, /direct provider|Ollama/iu);
});

test("preserves the canonical change story, capability map, and caveats", () => {
  const cliGuide = details["docs/CLI.md"];

  for (const command of [
    "readme",
    "api",
    "changelog",
    "diagram",
    "annotate",
    "plan",
    "update",
    "watch",
    "check",
    "score",
  ]) {
    assert.match(readme, new RegExp(`\\b${command}\\b`, "u"));
  }
  assert.match(readme, /createUser\(email\)\s*->\s*createUser\(email, role\)/u);
  assert.match(readme, /README\.md[\s\S]{0,180}docs\/API\.md/u);
  for (const step of [
    "Analyze the change",
    "Focus the update",
    "Review before writing",
  ]) {
    assert.match(readme, new RegExp(step, "u"));
  }
  assert.match(
    readme,
    /`aidoc check` is an AST-backed co-change guard, not semantic proof\./u,
  );
  assert.match(
    readme,
    /`aidoc score` is AST-derived documentation coverage, not prose quality\./u,
  );
  assert.match(readme, /^\|\s*One-shot generation pattern\s*\|/mu);
  assert.match(
    cliGuide,
    /`readme`, `api`, `diagram`, and `annotate`[\s\S]{0,180}AST/iu,
  );
  assert.match(
    cliGuide,
    /`changelog`[\s\S]{0,180}(?:normalized )?Git commit metadata/iu,
  );
  assert.match(
    cliGuide,
    /AIDOC_BASE_REF[\s\S]{0,220}origin\/main[\s\S]{0,180}HEAD~1/iu,
  );
  assert.doesNotMatch(
    readme,
    /parse failure[\s\S]{0,120}generation path[\s\S]{0,120}before provider construction/iu,
  );
  for (const command of [
    "Codex MCP",
    "Claude MCP",
    "GitHub Action",
    "Ollama",
  ]) {
    assert.match(readme, new RegExp(command, "iu"));
  }
});

test("states supported languages, limits, safety boundaries, and feedback paths", () => {
  for (const language of ["TypeScript", "JavaScript", "Python"]) {
    assert.match(readme, new RegExp(language, "u"));
  }
  assert.match(readme, /unsupported|current limits|known limits/iu);
  assert.match(
    readme,
    /impact planning[\s\S]{0,180}unsupported[\s\S]{0,140}counted as limits/iu,
  );
  assert.match(readme, /check[\s\S]{0,180}not semantic proof/iu);
  assert.match(readme, /score[\s\S]{0,180}not prose quality/iu);
  assert.match(corpus, /pinned MCP[\s\S]{0,260}(?:Git worktree|repository)/iu);
  assert.match(corpus, /Trust Gate[\s\S]{0,300}(?:strict|redact|warn)/iu);
  assert.match(
    corpus,
    /host-managed MCP[\s\S]{0,260}(?:never writes|does not write)/iu,
  );
  assert.match(corpus, /approved Markdown[\s\S]{0,180}(?:permission|host)/iu);
  assert.match(readme, /CONTRIBUTING\.md/u);
  assert.match(readme, /SECURITY\.md/u);
  assert.match(readme, /issues(?:\/new)?/iu);
});

test("links the authoritative detail documents without unsupported or synthetic claims", () => {
  for (const relativePath of detailPaths) {
    assert.ok(
      readme.includes(`./${relativePath}`),
      `README must link to ${relativePath}`,
    );
  }
  assert.match(
    readme,
    /CLI catalogue|CLI reference|Complete command catalogue/iu,
  );
  assert.match(readme, /GitHub Action/iu);
  assert.match(readme, /Public Beta/iu);
  assert.doesNotMatch(
    corpus,
    /AI-powered documentation generator for codebases|professional documentation|🤖/iu,
  );
  assert.doesNotMatch(
    corpus,
    /(?:trusted by|adopted by|customer testimonial|grant claim|download count|star count|production-ready|hallucination-free|autonomous documentation team)/iu,
  );
  assert.doesNotMatch(corpus, /\u2014/u);
  assert.doesNotMatch(corpus, /^##\s+[^\n]*[\p{Extended_Pictographic}]/gmu);
});
