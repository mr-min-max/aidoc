import { execFileSync } from "node:child_process";
import * as fs from "fs";
import * as path from "path";

const { load } = require("js-yaml") as {
  load(source: string): unknown;
};

interface DependabotUpdate {
  "package-ecosystem": string;
  directory: string;
  schedule: {
    interval: string;
    day?: string;
    time?: string;
    timezone?: string;
  };
  "open-pull-requests-limit": number;
  labels: string[];
  groups?: Record<
    string,
    { "dependency-type": string; "update-types": string[] }
  >;
}

interface DependabotConfig {
  version: number;
  updates: DependabotUpdate[];
  registries?: unknown;
}

describe("public beta repository configuration", () => {
  it("bounds weekly npm and Actions dependency updates", () => {
    const source = fs.readFileSync(
      path.resolve(".github/dependabot.yml"),
      "utf8",
    );
    const dependabot = load(source) as DependabotConfig;

    expect(dependabot).toEqual({
      version: 2,
      updates: [
        {
          "package-ecosystem": "npm",
          directory: "/",
          schedule: {
            interval: "weekly",
            day: "monday",
            time: "09:00",
            timezone: "Europe/Kiev",
          },
          "open-pull-requests-limit": 5,
          labels: ["dependencies"],
          groups: {
            "production-minor-and-patch": {
              "dependency-type": "production",
              "update-types": ["minor", "patch"],
            },
          },
        },
        {
          "package-ecosystem": "github-actions",
          directory: "/",
          schedule: {
            interval: "weekly",
            day: "monday",
            time: "09:15",
            timezone: "Europe/Kiev",
          },
          "open-pull-requests-limit": 3,
          labels: ["dependencies"],
        },
      ],
    });
    expect(dependabot.registries).toBeUndefined();
  });

  it("keeps private publication material outside tracked Git", () => {
    expect(() =>
      execFileSync("git", ["check-ignore", "--quiet", ".private/probe"], {
        cwd: path.resolve("."),
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("verifies the current candidate revision in the public-beta gate", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve("package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:public-beta"]).toBe(
      "npm run verify:release && npm run test:public-beta && node scripts/public-beta-preflight.mjs --json --candidate-ref HEAD",
    );
  });

  it("routes usage questions to a structured issue form", () => {
    const questionPath = path.resolve(".github/ISSUE_TEMPLATE/question.yml");
    expect(fs.existsSync(questionPath)).toBe(true);

    const support = fs.readFileSync(path.resolve("SUPPORT.md"), "utf8");
    const issueConfig = load(
      fs.readFileSync(
        path.resolve(".github/ISSUE_TEMPLATE/config.yml"),
        "utf8",
      ),
    ) as { blank_issues_enabled?: boolean; contact_links?: unknown[] };
    const question = load(fs.readFileSync(questionPath, "utf8")) as {
      name?: string;
      labels?: string[];
      body?: unknown[];
    };

    expect(issueConfig).toEqual({ blank_issues_enabled: false });
    expect(question.name).toMatch(/question|support/i);
    expect(question.labels).toContain("question");
    expect(question.body?.length).toBeGreaterThan(0);
    expect(support).toContain(
      "https://github.com/mr-min-max/aidoc/issues/new?template=question.yml",
    );
    expect(support).not.toContain("/discussions");
  });

  it("locks verification and tagging to one immutable main commit", () => {
    const runbook = fs.readFileSync(path.resolve("docs/RELEASING.md"), "utf8");
    const capture = 'release_sha="$(git rev-parse origin/main)" &&';
    const freeze = "readonly release_sha &&";
    const verify =
      'node scripts/verify-release-candidate.mjs --main-ref origin/main --candidate-ref HEAD --tag v0.2.0-beta.4 --expected-sha "$release_sha"';
    const registryCheck = "node scripts/verify-npm-unpublished.mjs";
    const markVerified = 'release_verified_sha="$release_sha" &&';
    const requireVerified =
      'test "${release_verified_sha:-}" = "$release_sha" &&';
    const tag = 'git tag -a v0.2.0-beta.4 "$release_sha" -m "v0.2.0-beta.4"';

    expect(runbook).toContain("same trusted shell session");
    expect(runbook).toMatch(
      /`v0\.2\.0-beta\.3`[\s\S]{0,320}(?:must not|do not)[\s\S]{0,160}(?:move|repoint|reuse|rerun)/i,
    );
    expect(runbook).toContain(
      "npm view @mr-min-max/aidoc-gen@0.2.0-beta.4 version --json",
    );
    expect(runbook).toContain("aidoc-gen@0.2.0-beta.3");
    expect(runbook.split(registryCheck)).toHaveLength(4);
    expect(runbook).toContain("git fetch origin main &&");
    expect(runbook).toContain(capture);
    expect(runbook).toContain(freeze);
    expect(runbook.split(verify)).toHaveLength(5);
    expect(runbook).toContain(`${verify} &&`);
    expect(runbook).toContain('test -z "$(git status --porcelain=v1)" &&');
    expect(runbook).toContain(markVerified);
    expect(runbook).toContain("readonly release_verified_sha");
    expect(runbook).toContain(requireVerified);
    expect(runbook).toContain(`${tag} &&`);

    const captureIndex = runbook.indexOf(capture);
    const gateIndex = runbook.indexOf("npm run verify:release");
    const markVerifiedIndex = runbook.indexOf(markVerified);
    const requireVerifiedIndex = runbook.indexOf(requireVerified);
    const recheckIndex = runbook.lastIndexOf(`${verify} &&`);
    const preMarkerVerifyIndex = runbook.lastIndexOf(
      `${verify} &&`,
      markVerifiedIndex,
    );
    const preMarkerCleanIndex = runbook.lastIndexOf(
      'test -z "$(git status --porcelain=v1)" &&',
      markVerifiedIndex,
    );
    const preMarkerRegistryIndex = runbook.lastIndexOf(
      `${registryCheck} &&`,
      markVerifiedIndex,
    );
    const tagIndex = runbook.indexOf(tag);
    const preTagRegistryIndex = runbook.lastIndexOf(
      `${registryCheck} &&`,
      tagIndex,
    );
    expect(captureIndex).toBeGreaterThanOrEqual(0);
    expect(gateIndex).toBeGreaterThan(captureIndex);
    expect(preMarkerVerifyIndex).toBeGreaterThan(gateIndex);
    expect(preMarkerRegistryIndex).toBeGreaterThan(preMarkerVerifyIndex);
    expect(preMarkerCleanIndex).toBeGreaterThan(preMarkerRegistryIndex);
    expect(markVerifiedIndex).toBeGreaterThan(gateIndex);
    expect(requireVerifiedIndex).toBeGreaterThan(markVerifiedIndex);
    expect(recheckIndex).toBeGreaterThan(gateIndex);
    expect(preTagRegistryIndex).toBeGreaterThan(requireVerifiedIndex);
    expect(preTagRegistryIndex).toBeGreaterThan(recheckIndex);
    expect(tagIndex).toBeGreaterThan(preTagRegistryIndex);
  });

  it("aligns the scoped beta.4 package identity and focused hybrid verification surface", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve("package.json"), "utf8"),
    ) as { name: string; version: string; scripts: Record<string, string> };
    const packageLock = JSON.parse(
      fs.readFileSync(path.resolve("package-lock.json"), "utf8"),
    ) as {
      name: string;
      version: string;
      packages: Record<string, { name?: string; version?: string }>;
    };

    expect(packageJson.name).toBe("@mr-min-max/aidoc-gen");
    expect(packageJson.version).toBe("0.2.0-beta.4");
    expect(packageLock.name).toBe(packageJson.name);
    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages[""]?.name).toBe(packageJson.name);
    expect(packageLock.packages[""]?.version).toBe(packageJson.version);
    expect(packageJson.scripts).toMatchObject({
      "test:provider-contracts": "jest tests/unit/providers --runInBand",
      "test:codex-plugin": "node tests/e2e/codex-plugin-smoke.mjs",
      "test:hybrid-beta": "node --test tests/e2e/hybrid-beta-demo.test.mjs",
      "test:npm-unpublished": "node --test tests/e2e/npm-unpublished.test.mjs",
      "test:npm-published":
        "node --test tests/e2e/npm-published.test.mjs && node scripts/verify-npm-published.mjs",
    });
    expect(packageJson.scripts["test:public-beta"]).toContain(
      "npm run test:npm-published",
    );
    expect(packageJson.scripts["test:public-beta"]).not.toContain(
      "npm run test:npm-unpublished",
    );
    for (const command of [
      "npm run test:provider-contracts",
      "npm run test:codex-plugin",
      "npm run test:hybrid-beta",
    ]) {
      expect(packageJson.scripts["verify:release"]).toContain(command);
    }

    for (const currentSurface of [
      "README.md",
      "ROADMAP.md",
      "CHANGELOG.md",
      ".github/ISSUE_TEMPLATE/bug_report.yml",
      ".github/ISSUE_TEMPLATE/feature_request.yml",
    ]) {
      const source = fs.readFileSync(path.resolve(currentSurface), "utf8");
      expect(source).toContain("0.2.0-beta.4");
      expect(source).not.toContain("0.2.0-beta.2");
    }

    const mcpServer = fs.readFileSync(
      path.resolve("src/mcp/server.ts"),
      "utf8",
    );
    expect(mcpServer).toContain("aidoc --mcp");
    expect(mcpServer).not.toContain("npx aidoc-gen");
  });

  it("documents the published beta.4 hybrid access boundaries and supported installation paths", () => {
    const documentationPaths = [
      "README.md",
      "docs/PUBLIC_BETA.md",
      "docs/integrations/codex.md",
      "docs/integrations/claude.md",
      "docs/releases/v0.2.0-beta.4.md",
    ];
    const documentation = Object.fromEntries(
      documentationPaths.map((file) => [
        file,
        fs.readFileSync(path.resolve(file), "utf8"),
      ]),
    );
    const roadmap = fs.readFileSync(path.resolve("ROADMAP.md"), "utf8");
    const corpus = Object.values(documentation).join("\n");
    const readme = documentation["README.md"];
    const codexGuide = documentation["docs/integrations/codex.md"];
    const quickStartStart = readme.indexOf("## 🚀 Quick Start");
    const quickStartEnd = readme.indexOf("### Three honest beta paths");
    const mcpToolsStart = readme.indexOf("### Available MCP Tools");
    const mcpToolsEnd = readme.indexOf("## 🔐 Planning security and limits");
    const mcpScopeStart = readme.indexOf("### Pinned MCP repository scope");
    const mcpScopeEnd = readme.indexOf(
      "Read [Codex integration]",
      mcpScopeStart,
    );
    const trustGateStart = readme.indexOf("## 🛡️ Trust Gate beta");
    const trustGateEnd = readme.indexOf("## 🛠️ Commands", trustGateStart);
    expect(quickStartStart).toBeGreaterThanOrEqual(0);
    expect(quickStartEnd).toBeGreaterThan(quickStartStart);
    expect(mcpToolsStart).toBeGreaterThanOrEqual(0);
    expect(mcpToolsEnd).toBeGreaterThan(mcpToolsStart);
    expect(mcpScopeStart).toBeGreaterThanOrEqual(0);
    expect(mcpScopeEnd).toBeGreaterThan(mcpScopeStart);
    expect(trustGateStart).toBeGreaterThanOrEqual(0);
    expect(trustGateEnd).toBeGreaterThan(trustGateStart);
    const quickStart = readme.slice(quickStartStart, quickStartEnd);
    const mcpTools = readme.slice(mcpToolsStart, mcpToolsEnd);
    const mcpScope = readme.slice(mcpScopeStart, mcpScopeEnd);
    const trustGate = readme.slice(trustGateStart, trustGateEnd);
    const trustGateNormalized = trustGate.replace(/\s+/gu, " ").trim();
    const directTrustGate = trustGateNormalized.split(
      "The host-managed MCP prepare/validate workflow",
    )[0];

    for (const command of ["aidoc", "aidoc plan", "aidoc update"]) {
      expect(corpus).toContain(command);
    }
    expect(corpus).toMatch(
      /automatic(?:ally)?[\s\S]{0,180}(?:safe|explicit|ambiguous|guess)/i,
    );
    expect(corpus).toMatch(/ChatGPT[\s\S]{0,180}(?:official Codex|local MCP)/i);
    expect(corpus).toMatch(
      /ChatGPT web[\s\S]{0,180}(?:does not|not|cannot|unsupported)/i,
    );
    expect(corpus).toMatch(/Claude (?:Desktop|Code)[\s\S]{0,180}local MCP/i);
    expect(corpus).toMatch(
      /AiDoc[\s\S]{0,80}receives no Claude[\s\S]{0,80}(?:token|OAuth)/i,
    );
    expect(corpus).toMatch(
      /consumer subscriptions?[\s\S]{0,160}(?:separate|distinct)[\s\S]{0,160}(?:API|billing)/i,
    );

    for (const provider of [
      "openai",
      "anthropic",
      "deepseek",
      "qwen",
      "openai-compatible",
      "ollama",
    ]) {
      expect(corpus).toContain(provider);
    }
    for (const variable of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "DEEPSEEK_API_KEY",
      "DASHSCOPE_API_KEY",
      "AIDOC_COMPAT_API_KEY",
    ]) {
      expect(corpus).toContain(variable);
    }
    expect(corpus).toMatch(
      /Ollama[\s\S]{0,180}(?:local|explicit)[\s\S]{0,120}model/i,
    );
    expect(corpus).toMatch(
      /Ollama[\s\S]{0,260}(?:discover|detect)[\s\S]{0,160}(?:installed|choose|select)[\s\S]{0,120}model/i,
    );
    expect(corpus).toMatch(
      /direct provider mode[\s\S]{0,180}(?:never|no)[\s\S]{0,80}(?:fallback|falls? back)/i,
    );
    expect(corpus).toMatch(
      /Qwen[\s\S]{0,180}(?:PAYG|pay-as-you-go)[\s\S]{0,180}(?:API|custom)/i,
    );
    expect(corpus).toMatch(
      /Trust Gate[\s\S]{0,260}(?:input|output|redact|block)/i,
    );
    expect(corpus).toMatch(
      /does not control[\s\S]{0,160}(?:context window|model|sandbox|permission)/i,
    );
    expect(trustGateNormalized).toContain(
      "For direct/general provider flows, configured `strict` blocks findings, configured `redact` replaces detected values with typed placeholders, and configured `warn` preserves the detected text while reporting findings.",
    );
    expect(trustGateNormalized).toContain(
      "The host-managed MCP prepare/validate workflow has a stricter privacy floor: configured `warn` and `redact` both use effective redaction before host generation or return, while the result still reports the configured policy.",
    );
    expect(directTrustGate).not.toMatch(
      /configured `warn`[^.]{0,120}(?:redact|redacts)/i,
    );

    expect(mcpTools).toMatch(
      /provider-free[\s\S]{0,220}(?:plan_documentation_impact|prepare_documentation_update)[\s\S]{0,320}validate_documentation_draft[\s\S]{0,180}check_docs_freshness/i,
    );
    expect(mcpTools).toMatch(
      /legacy\/direct[\s\S]{0,160}provider-backed[\s\S]{0,160}generation tools below are separate:[\s\S]{0,160}generate_readme[\s\S]{0,120}generate_api_docs[\s\S]{0,120}generate_diagram[\s\S]{0,220}(?:provider credential|API billing)/i,
    );
    expect(corpus).toMatch(
      /MCP[\s\S]{0,220}(?:pinned|restricted to|startup)[\s\S]{0,160}Git worktree/i,
    );
    expect(corpus).toMatch(
      /one MCP server[\s\S]{0,220}(?:another\s+repository|another\s+server|each\s+repository)/i,
    );
    expect(corpus).toMatch(
      /(?:successful|returned|result)[\s\S]{0,180}repository-relative[\s\S]{0,100}path/i,
    );
    expect(corpus).toMatch(
      /(?:external|traversal)[\s\S]{0,220}(?:\.git|Git metadata)[\s\S]{0,180}symlink[\s\S]{0,180}(?:deny|fail closed|rejected)/i,
    );
    expect(corpus).toMatch(
      /MCP[\s\S]{0,240}(?:bounded )?(?:declarative|JSON|YAML)[\s\S]{0,220}(?:reject|never execute|does not execute)[\s\S]{0,120}(?:JavaScript|JS|TypeScript|TS|CJS|MJS)/i,
    );
    expect(corpus).toMatch(
      /direct CLI[\s\S]{0,180}(?:unchanged|cosmiconfig|dotenv)/i,
    );
    expect(corpus).toMatch(
      /hard links?[\s\S]{0,180}indistinguishable[\s\S]{0,180}(?:race|repository)/i,
    );
    expect(corpus).toMatch(
      /(?:privileged|same-host)[\s\S]{0,180}race[\s\S]{0,180}(?:checks|sandbox)/i,
    );
    expect(corpus).toMatch(/not an (?:operating-system|OS) sandbox/i);
    expect(corpus).not.toMatch(
      /MCP directory allowlisting[\s\S]{0,80}unimplemented/i,
    );
    expect(mcpScope).toMatch(/startup cwd[\s\S]{0,260}another\s+repository/i);
    expect(mcpScope).toMatch(/declarative[\s\S]{0,180}executable JavaScript/i);
    expect(mcpScope).toMatch(/not an operating-system sandbox/i);
    expect(roadmap).toContain("Pinned MCP read scope");
    expect(roadmap).not.toContain("MCP directory allowlisting");
    expect(quickStart).toMatch(
      /bare `aidoc`[\s\S]{0,220}provider-free plan[\s\S]{0,300}(?:direct-provider|host-managed MCP)/i,
    );
    expect(quickStart).not.toMatch(
      /bare `aidoc`[\s\S]{0,260}(?:credential-free|without a model credential)[\s\S]{0,180}update/i,
    );

    expect(corpus).not.toMatch(
      /(?:prepare_documentation_update|host-managed|prepare\/validate)[\s\S]{0,240}(?:warn|redact)[\s\S]{0,180}(?:original detected|raw secret|raw value|cross the provider)/i,
    );
    expect(codexGuide).toContain("codex mcp add aidoc -- aidoc --mcp");
    expect(codexGuide).toContain("codex mcp list");
    expect(codexGuide).toContain("codex mcp remove aidoc");

    for (const setupLine of [
      "npm install -g @mr-min-max/aidoc-gen@beta",
      "npm install",
      "npm run build",
      "npm link",
      "aidoc --version",
      "npm unlink -g @mr-min-max/aidoc-gen",
      "codex mcp add aidoc -- aidoc --mcp",
      "codex mcp list",
      "codex mcp remove aidoc",
    ]) {
      expect(corpus).toContain(setupLine);
    }
    expect(corpus).toMatch(
      /(?:published|released)[\s\S]{0,120}(?:to npm|on npm|GitHub prerelease)/i,
    );
    expect(corpus).not.toMatch(
      /^npm install -g @mr-min-max\/aidoc-gen(?:@latest)?$/mu,
    );
    expect(corpus).not.toMatch(
      /(?:already|is|was|has been)\s+installed\s+(?:from|through)\s+(?:the\s+)?marketplace/i,
    );
    expect(corpus).not.toMatch(
      /ChatGPT web[\s\S]{0,160}(?:supports|can use|is available|use local)/i,
    );
  });

  it("keeps the beta.4 post-publication state truthful and removes the one-time repair path", () => {
    const runbook = fs.readFileSync(path.resolve("docs/RELEASING.md"), "utf8");
    const readme = fs.readFileSync(path.resolve("README.md"), "utf8");
    const publicBeta = fs.readFileSync(
      path.resolve("docs/PUBLIC_BETA.md"),
      "utf8",
    );
    const releaseNote = fs.readFileSync(
      path.resolve("docs/releases/v0.2.0-beta.4.md"),
      "utf8",
    );

    expect(
      fs.existsSync(
        path.resolve(".github/workflows/repair-beta4-dist-tag.yml"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.resolve("tests/unit/release/dist-tag-repair-workflow.test.ts"),
      ),
    ).toBe(false);
    expect(runbook).toMatch(
      /every npm package[\s\S]{0,120}(?:has|must have)[\s\S]{0,80}`latest`/i,
    );
    expect(runbook).toContain("npm install -g @mr-min-max/aidoc-gen@beta");
    expect(runbook).toContain("node scripts/verify-npm-published.mjs");
    expect(runbook).not.toContain(
      "npm dist-tag rm @mr-min-max/aidoc-gen latest",
    );
    expect(runbook).toMatch(
      /npm maintainer[\s\S]{0,180}approved privacy alias[\s\S]{0,180}(?:personal|private) email/i,
    );
    expect(readme).toContain("npm install -g @mr-min-max/aidoc-gen@beta");
    expect(publicBeta).toContain("npm install -g @mr-min-max/aidoc-gen@beta");
    expect(releaseNote).toContain(
      "https://github.com/mr-min-max/aidoc/releases/tag/v0.2.0-beta.4",
    );
    expect(releaseNote).toMatch(/published[\s\S]{0,80}npm/i);
  });
});
