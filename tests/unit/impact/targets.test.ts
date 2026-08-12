import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  projectProviderContextForTarget,
  resolveDocumentationTargets,
  type DocumentationTargetCandidate,
} from "../../../src/impact/targets";
import { RepositoryWriteScope } from "../../../src/security/repository-writer";
import type {
  DocumentationImpact,
  ImpactPlan,
  ImpactProviderContext,
} from "../../../src/impact/types";

const summary = {
  totalChanges: 2,
  publicApiChanges: 2,
  potentiallyBreaking: 0,
  reviewRequired: 2,
  informational: 0,
  unmapped: 0,
  byCategory: {
    added: 0,
    removed: 0,
    moved: 0,
    "contract-changed": 2,
    "implementation-changed": 0,
    "documentation-changed": 0,
    "dependency-changed": 0,
  },
} as const;

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "aidoc-impact-targets-"));
  execFileSync("git", ["init", "-q", "--initial-branch", "main"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "README.md"), "# README\n");
  writeFileSync(join(root, "docs", "API.md"), "# API\n");
  writeFileSync(join(root, "notes.txt"), "not markdown\n");
  return root;
}

function change(id: string, kind: "function" | "class" = "function") {
  return {
    scope: "symbol" as const,
    id,
    category: "contract-changed" as const,
    risk: "review-required" as const,
    language: "typescript" as const,
    path: "src/index.ts",
    kind,
    qualifiedName: id,
    digest: `${id}`.padEnd(64, "a").slice(0, 64),
  };
}

function reference(file: string, section: string) {
  return {
    file,
    section,
    slug: section.toLowerCase().replaceAll(" ", "-"),
    reason: "code-span" as const,
  };
}

function plan(
  documentation: DocumentationImpact[],
  changes = [change("change-1"), change("change-2", "class")],
): ImpactPlan {
  return {
    schemaVersion: "aidoc.impact-plan.v1",
    base: { type: "git", label: "main", commit: "a".repeat(40) },
    head: { type: "working-tree", label: "working-tree" },
    summary: {
      ...summary,
      totalChanges: changes.length,
      publicApiChanges: changes.length,
      unmapped: documentation.filter((item) => item.unmapped).length,
    },
    changes,
    documentation,
    context: {
      maxBytes: 12000,
      usedBytes: 300,
      totalRecords: changes.length,
      includedRecords: changes.length,
      omittedRecords: 0,
      impactDigest: "b".repeat(64),
    },
    ignored: { unsupported: 0, excluded: 0 },
    digest: "c".repeat(64),
  };
}

function providerContext(
  documentation: DocumentationImpact[],
  changes = [change("change-1"), change("change-2", "class")],
): ImpactProviderContext {
  return {
    schemaVersion: "aidoc.impact-context.v1",
    impactDigest: "b".repeat(64),
    summary: { ...summary },
    changes: changes.map(
      ({ scope: _scope, language: _language, digest: _digest, ...item }) =>
        item,
    ),
    documentation,
    omittedRecords: 3,
  };
}

async function openScope(root: string): Promise<RepositoryWriteScope> {
  return RepositoryWriteScope.open(root);
}

describe("documentation target resolution", () => {
  let root: string;

  beforeEach(() => {
    root = repository();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("collects sorted unique mapped Markdown targets and aggregates reasons", async () => {
    const scope = await openScope(root);
    const result = await resolveDocumentationTargets({
      plan: plan([
        {
          changeId: "change-1",
          directReferences: [reference("docs/API.md", "API")],
          recommendations: [reference("README.md", "API")],
          unmapped: false,
        },
        {
          changeId: "change-2",
          directReferences: [reference("./README.md", "Overview")],
          recommendations: [reference("README.md", "API")],
          unmapped: false,
        },
      ]),
      scope,
    });

    expect(result.map(({ path }) => path)).toEqual([
      "README.md",
      "docs/API.md",
    ]);
    expect(result[0]?.reasons).toEqual(["direct-reference", "recommendation"]);
    expect(result[0]?.sections).toEqual(["API", "Overview"]);
    expect(result.every(({ prepared }) => prepared.existingText !== null)).toBe(
      true,
    );
  });

  it("reports no documentation impact for an empty plan", async () => {
    const empty = plan([], []);

    expect(empty.summary.totalChanges).toBe(0);
    const scope = await openScope(root);
    expect(await resolveDocumentationTargets({ plan: empty, scope })).toEqual(
      [],
    );
  });

  it("accepts Markdown extension case-insensitively", async () => {
    writeFileSync(join(root, "docs", "Guide.MD"), "# Guide\n");
    const scope = await openScope(root);

    const result = await resolveDocumentationTargets({
      plan: plan([
        {
          changeId: "change-1",
          directReferences: [reference("docs/Guide.MD", "Guide")],
          recommendations: [],
          unmapped: false,
        },
      ]),
      scope,
    });

    expect(result.map(({ path }) => path)).toEqual(["docs/Guide.MD"]);
  });

  it("skips missing automatic mapped files", async () => {
    const scope = await openScope(root);

    const result = await resolveDocumentationTargets({
      plan: plan([
        {
          changeId: "change-1",
          directReferences: [reference("docs/Missing.md", "Missing")],
          recommendations: [],
          unmapped: false,
        },
      ]),
      scope,
    });

    expect(result).toEqual([]);
  });

  it("uses the README fallback when mapped files are missing but public impact is unmapped", async () => {
    const scope = await openScope(root);

    const result = await resolveDocumentationTargets({
      plan: plan([
        {
          changeId: "change-1",
          directReferences: [reference("docs/Missing.md", "Missing")],
          recommendations: [],
          unmapped: false,
        },
        {
          changeId: "change-2",
          directReferences: [],
          recommendations: [],
          unmapped: true,
        },
      ]),
      scope,
    });

    expect(result.map(({ path }) => path)).toEqual(["README.md"]);
    expect(result[0]?.reasons).toEqual(["unmapped-public-change-fallback"]);
  });

  it("rejects an existing non-Markdown mapped target", async () => {
    const scope = await openScope(root);

    await expect(
      resolveDocumentationTargets({
        plan: plan([
          {
            changeId: "change-1",
            directReferences: [reference("notes.txt", "Notes")],
            recommendations: [],
            unmapped: false,
          },
        ]),
        scope,
      }),
    ).rejects.toMatchObject({ code: "TRUST_INVALID_TARGET_TYPE" });
  });

  it("deduplicates explicit targets by their prepared display path", async () => {
    const scope = await openScope(root);

    const result = await resolveDocumentationTargets({
      plan: plan([]),
      scope,
      explicitTargets: ["README.md", "./README.md"],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      path: "README.md",
      reasons: ["explicit"],
      sections: [],
    });
  });

  it("rejects an explicit target outside the repository", async () => {
    const scope = await openScope(root);

    await expect(
      resolveDocumentationTargets({
        plan: plan([]),
        scope,
        explicitTargets: ["../outside.md"],
      }),
    ).rejects.toMatchObject({ code: "TRUST_INVALID_PATH" });
  });

  it("uses an existing README only for an unmapped public change", async () => {
    const scope = await openScope(root);
    const result = await resolveDocumentationTargets({
      plan: plan([
        {
          changeId: "change-1",
          directReferences: [],
          recommendations: [],
          unmapped: true,
        },
      ]),
      scope,
      explicitTargets: undefined,
    });

    expect(result.map(({ path }) => path)).toEqual(["README.md"]);
    expect(result[0]?.reasons).toEqual(["unmapped-public-change-fallback"]);
  });

  it("does not invent a README fallback when it is absent", async () => {
    rmSync(join(root, "README.md"));
    const scope = await openScope(root);

    const result = await resolveDocumentationTargets({
      plan: plan([
        {
          changeId: "change-1",
          directReferences: [],
          recommendations: [],
          unmapped: true,
        },
      ]),
      scope,
    });

    expect(result).toEqual([]);
  });

  it("projects only the selected target's documentation context", () => {
    const documentation = [
      {
        changeId: "change-1",
        directReferences: [reference("README.md", "Overview")],
        recommendations: [reference("docs/API.md", "API")],
        unmapped: false,
      },
      {
        changeId: "change-2",
        directReferences: [reference("docs/API.md", "Classes")],
        recommendations: [],
        unmapped: false,
      },
    ];
    const target: DocumentationTargetCandidate = {
      path: "docs/API.md",
      reasons: ["direct-reference"],
      sections: ["API", "Classes"],
    };

    const projected = projectProviderContextForTarget(
      providerContext(documentation),
      target,
    );

    expect(projected).toMatchObject({
      schemaVersion: "aidoc.impact-context.v1",
      impactDigest: "b".repeat(64),
      summary,
      omittedRecords: 3,
    });
    expect(projected.changes.map(({ id }) => id)).toEqual([
      "change-1",
      "change-2",
    ]);
    expect(projected.documentation).toEqual([
      {
        changeId: "change-1",
        directReferences: [],
        recommendations: [reference("docs/API.md", "API")],
        unmapped: false,
      },
      {
        changeId: "change-2",
        directReferences: [reference("docs/API.md", "Classes")],
        recommendations: [],
        unmapped: false,
      },
    ]);
  });

  it("projects unmapped public changes to the README fallback", () => {
    const documentation = [
      {
        changeId: "change-1",
        directReferences: [],
        recommendations: [],
        unmapped: true,
      },
      {
        changeId: "change-2",
        directReferences: [],
        recommendations: [],
        unmapped: true,
      },
    ];

    const projected = projectProviderContextForTarget(
      providerContext(documentation),
      {
        path: "README.md",
        reasons: ["unmapped-public-change-fallback"],
        sections: [],
      },
    );

    expect(projected.changes.map(({ id }) => id)).toEqual([
      "change-1",
      "change-2",
    ]);
    expect(projected.documentation).toEqual(documentation);
  });

  it("preserves the complete bounded context for an explicit unmapped target", async () => {
    writeFileSync(join(root, "docs", "Guide.md"), "# Guide\n");
    const scope = await openScope(root);
    const resolved = await resolveDocumentationTargets({
      plan: plan([
        {
          changeId: "change-1",
          directReferences: [reference("docs/API.md", "API")],
          recommendations: [],
          unmapped: false,
        },
        {
          changeId: "change-2",
          directReferences: [],
          recommendations: [],
          unmapped: true,
        },
      ]),
      scope,
      explicitTargets: ["docs/Guide.md"],
    });
    const context = providerContext([
      {
        changeId: "change-1",
        directReferences: [reference("docs/API.md", "API")],
        recommendations: [],
        unmapped: false,
      },
      {
        changeId: "change-2",
        directReferences: [],
        recommendations: [],
        unmapped: true,
      },
    ]);

    expect(resolved[0]).toMatchObject({
      path: "docs/Guide.md",
      reasons: ["explicit"],
    });
    expect(projectProviderContextForTarget(context, resolved[0]!)).toEqual(
      context,
    );
    expect(
      projectProviderContextForTarget(context, resolved[0]!).changes,
    ).toHaveLength(2);
    expect(
      projectProviderContextForTarget(context, resolved[0]!).documentation,
    ).toHaveLength(2);
  });
});
