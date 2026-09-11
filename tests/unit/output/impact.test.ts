import type { ImpactPlan } from "../../../src/impact/types";
import {
  formatImpactPlan,
  serializePlanCommandResult,
} from "../../../src/output/impact";

function plan(overrides: Partial<ImpactPlan> = {}): ImpactPlan {
  return {
    schemaVersion: "aidoc.impact-plan.v1",
    base: { type: "git", label: "main", commit: "a".repeat(40) },
    head: { type: "working-tree", label: "working-tree" },
    summary: {
      totalChanges: 3,
      publicApiChanges: 3,
      potentiallyBreaking: 1,
      reviewRequired: 1,
      informational: 1,
      unmapped: 1,
      byCategory: {
        added: 0,
        exposed: 0,
        removed: 0,
        hidden: 0,
        moved: 0,
        "contract-changed": 1,
        "implementation-changed": 1,
        "documentation-changed": 1,
        "dependency-changed": 0,
      },
    },
    changes: [],
    documentation: [
      {
        changeId: "change-1",
        directReferences: [
          {
            file: "docs/API.md",
            section: "LLMProvider",
            slug: "llmprovider",
            reason: "api-documentation",
          },
        ],
        recommendations: [
          {
            file: "CHANGELOG.md",
            section: "Unreleased",
            slug: "unreleased",
            reason: "changelog",
          },
        ],
        unmapped: false,
      },
    ],
    context: {
      maxBytes: 12000,
      usedBytes: 812,
      totalRecords: 3,
      includedRecords: 3,
      omittedRecords: 0,
      impactDigest: "b".repeat(64),
    },
    ignored: { unsupported: 0, excluded: 0, suppressed: 0 },
    digest: "c".repeat(64),
    ...overrides,
  };
}

describe("impact-plan output", () => {
  // Break caught: the headline or next action disappears from the concise
  // human projection, or direct evidence is presented as a recommendation.
  it("renders a concise, honestly labelled human summary", () => {
    const output = formatImpactPlan(plan());

    expect(output).toMatch(
      /^Documentation impact: 3 public API changes \(1 informational\)\n/,
    );
    expect(output).toContain("! 1 potentially breaking change");
    expect(output).toContain(
      "Direct documentation references:\n  docs/API.md -> LLMProvider",
    );
    expect(output).toContain(
      "Recommended documentation:\n  CHANGELOG.md -> Unreleased",
    );
    expect(output).toContain(
      "1 changed symbol is not mapped to documentation.",
    );
    expect(output).toContain("Context: 812 / 12000 bytes");
    expect(output).not.toContain("Base:");
    expect(output).not.toContain("Head:");
    expect(output).toContain("Targets:\n  CHANGELOG.md\n  docs/API.md");
    expect(output).toMatch(/Next: staledocs update$/);
  });

  it("prints suppression detail only when changes were suppressed", () => {
    expect(formatImpactPlan(plan())).not.toContain(
      "changes suppressed by .staledocsignore",
    );
    expect(
      formatImpactPlan(
        plan({
          ignored: { unsupported: 0, excluded: 0, suppressed: 2 },
        }),
      ),
    ).toContain("2 changes suppressed by .staledocsignore");
  });

  // Break caught: a working-tree descriptor displays its anchor label as though
  // it were an immutable head instead of naming the current working tree.
  it("renders working-tree and immutable snapshot labels truthfully", () => {
    const workingTreePlan = plan({
      head: { type: "working-tree", label: "HEAD" },
    });
    const workingOutput = formatImpactPlan(workingTreePlan, true);

    expect(workingOutput).toContain(`Base: main (${"a".repeat(40)})`);
    expect(workingOutput).toContain("Head: working-tree");
    expect(workingOutput).not.toContain("Head: HEAD");

    const immutableOutput = formatImpactPlan(
      plan({
        head: {
          type: "git",
          label: "release-candidate",
          commit: "d".repeat(40),
        },
      }),
      true,
    );
    expect(immutableOutput).toContain(
      `Head: release-candidate (${"d".repeat(40)})`,
    );
  });

  it("prints before and after signatures only in verbose output", () => {
    const change = {
      scope: "symbol" as const,
      id: "typescript:src/index.ts#function:transform",
      category: "contract-changed" as const,
      risk: "potentially-breaking" as const,
      language: "typescript" as const,
      path: "src/index.ts",
      kind: "function" as const,
      qualifiedName: "transform",
      before: "transform(value: string): string",
      after: "transform(value: string, count: number): string",
      digest: "d".repeat(64),
    };
    const withChange = plan({ changes: [change] });

    expect(formatImpactPlan(withChange)).not.toContain("before:");
    const verbose = formatImpactPlan(withChange, true);
    expect(verbose).toContain("Change: transform (contract-changed)");
    expect(verbose).toContain("  before: transform(value: string): string");
    expect(verbose).toContain(
      "  after:  transform(value: string, count: number): string",
    );
  });

  // Break caught: zero impact still emits noisy empty sections or suggests
  // that work is required.
  it("keeps zero-impact output short and actionable", () => {
    const empty = plan({
      summary: {
        ...plan().summary,
        totalChanges: 0,
        publicApiChanges: 0,
        potentiallyBreaking: 0,
        reviewRequired: 0,
        informational: 0,
        unmapped: 0,
      },
      documentation: [],
      context: { ...plan().context, usedBytes: 0, totalRecords: 0 },
    });

    expect(formatImpactPlan(empty)).toBe(
      "Documentation impact: 0 public API changes\n" +
        "No documentation updates are indicated.\n" +
        "Context: 0 / 12000 bytes",
    );
  });

  // Break caught: an implementation-only change with no mapped section silently
  // disappears from the report instead of being listed as unmapped.
  it("lists an unmapped implementation-only change with explicit-target guidance", () => {
    const implementation = {
      scope: "symbol" as const,
      id: "typescript:src/index.ts#function:transform",
      category: "implementation-changed" as const,
      risk: "informational" as const,
      language: "typescript" as const,
      path: "src/index.ts",
      kind: "function" as const,
      qualifiedName: "transform",
      digest: "d".repeat(64),
    };
    const implementationOnly = plan({
      summary: {
        ...plan().summary,
        totalChanges: 1,
        publicApiChanges: 0,
        potentiallyBreaking: 0,
        reviewRequired: 0,
        informational: 1,
        unmapped: 1,
        byCategory: {
          ...plan().summary.byCategory,
          "contract-changed": 0,
          "implementation-changed": 1,
          "documentation-changed": 0,
        },
      },
      changes: [implementation],
      documentation: [
        {
          changeId: implementation.id,
          directReferences: [],
          recommendations: [],
          unmapped: true,
        },
      ],
    });

    expect(formatImpactPlan(implementationOnly)).toBe(
      "Documentation impact: 0 public API changes (1 informational)\n" +
        "\n" +
        "1 changed symbol is not mapped to documentation.\n" +
        "Context: 812 / 12000 bytes\n" +
        "\n" +
        "No safe automatic documentation target was found.\n" +
        "Use --target <file> to choose an existing Markdown file.",
    );
  });

  // Break caught: module-level dependency changes are mistaken for no impact
  // merely because they do not count as public API symbol changes.
  it("renders documentation impact for dependency-only changes", () => {
    const dependencyOnly = plan({
      summary: {
        ...plan().summary,
        totalChanges: 3,
        publicApiChanges: 0,
        potentiallyBreaking: 0,
        reviewRequired: 3,
        informational: 0,
        unmapped: 1,
        byCategory: {
          ...plan().summary.byCategory,
          "contract-changed": 0,
          "implementation-changed": 0,
          "documentation-changed": 0,
          "dependency-changed": 3,
        },
      },
      documentation: [
        {
          changeId: "dependency-direct",
          directReferences: [
            {
              file: "docs/Dependencies.md",
              section: "Runtime packages",
              slug: "runtime-packages",
              reason: "source-link",
            },
          ],
          recommendations: [],
          unmapped: false,
        },
        {
          changeId: "dependency-recommended",
          directReferences: [],
          recommendations: [
            {
              file: "docs/Architecture.md",
              section: "Dependencies",
              slug: "dependencies",
              reason: "architecture",
            },
          ],
          unmapped: false,
        },
        {
          changeId: "dependency-unmapped",
          directReferences: [],
          recommendations: [],
          unmapped: true,
        },
      ],
    });

    const output = formatImpactPlan(dependencyOnly);

    expect(output).toMatch(/^Documentation impact: 0 public API changes\n/u);
    expect(output).not.toContain("No documentation updates are indicated.");
    expect(output).toContain(
      "Direct documentation references:\n" +
        "  docs/Dependencies.md -> Runtime packages",
    );
    expect(output).toContain(
      "Recommended documentation:\n" + "  docs/Architecture.md -> Dependencies",
    );
    expect(output).toContain(
      "1 changed symbol is not mapped to documentation.",
    );
    expect(output).toContain("Context: 812 / 12000 bytes");
    expect(output).toMatch(/Next: staledocs update$/u);
  });

  it("renders one target and explicit-target guidance", () => {
    expect(
      formatImpactPlan(plan(), false, {
        targets: [
          {
            path: "docs/API.md",
            reasons: ["direct-reference"],
            sections: ["LLMProvider"],
          },
        ],
        requiresExplicitTarget: false,
      }),
    ).toContain("Target: docs/API.md");

    const noSafeTarget = formatImpactPlan(
      plan({
        documentation: [
          {
            changeId: "change-1",
            directReferences: [
              {
                file: "docs/Missing.md",
                section: "Missing",
                slug: "missing",
                reason: "source-link",
              },
            ],
            recommendations: [],
            unmapped: false,
          },
        ],
      }),
      false,
      { targets: [], requiresExplicitTarget: true },
    );
    expect(noSafeTarget).toContain("Use --target <file>");
    expect(noSafeTarget).not.toContain("Next: staledocs update");
  });

  it("renders public boundary details only in verbose output", () => {
    const boundaryPlan = plan({
      boundary: {
        typescript: {
          mode: "entry",
          entries: ["src/index.ts"],
          filesRead: 12,
        },
      },
    });

    expect(formatImpactPlan(boundaryPlan)).not.toContain(
      "Boundary (TypeScript)",
    );
    expect(formatImpactPlan(boundaryPlan, true)).toContain(
      "Boundary (TypeScript): entry src/index.ts (12 files read)",
    );
  });

  // Break caught: JSON output gains whitespace/log framing or relies on object
  // insertion order instead of canonical command-result serialization.
  it("serializes one canonical JSON command-result object", () => {
    const workingTreePlan = plan({
      head: { type: "working-tree", label: "HEAD" },
    });
    const value = serializePlanCommandResult({
      ok: true,
      plan: workingTreePlan,
    });

    expect(value.startsWith('{"ok":true,"plan":{')).toBe(true);
    expect(JSON.parse(value)).toEqual({ ok: true, plan: workingTreePlan });
    expect(JSON.parse(value).plan.head).toEqual({
      type: "working-tree",
      label: "HEAD",
    });
    expect(value).not.toContain("\n");
    expect(value).not.toContain("\u001b[");
  });
});
