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
        removed: 0,
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
    ignored: { unsupported: 0, excluded: 0 },
    digest: "c".repeat(64),
    ...overrides,
  };
}

describe("impact-plan output", () => {
  // Break caught: the headline or next action disappears from the concise
  // human projection, or direct evidence is presented as a recommendation.
  it("renders a concise, honestly labelled human summary", () => {
    const output = formatImpactPlan(plan());

    expect(output).toMatch(/^Documentation impact: 3 public API changes\n/);
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
    expect(output).toMatch(/Next: aidoc update$/);
  });

  // Break caught: verbose metadata leaks into ordinary output or fails to show
  // both resolved snapshots when explicitly requested.
  it("adds resolved base and head only in verbose mode", () => {
    const output = formatImpactPlan(plan(), true);

    expect(output).toContain(`Base: main (${"a".repeat(40)})`);
    expect(output).toContain("Head: working-tree");
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
        "Context: 0 / 12000 bytes\n\n" +
        "Next: aidoc update",
    );
  });

  // Break caught: JSON output gains whitespace/log framing or relies on object
  // insertion order instead of canonical command-result serialization.
  it("serializes one canonical JSON command-result object", () => {
    const value = serializePlanCommandResult({ ok: true, plan: plan() });

    expect(value.startsWith('{"ok":true,"plan":{')).toBe(true);
    expect(JSON.parse(value)).toEqual({ ok: true, plan: plan() });
    expect(value).not.toContain("\n");
    expect(value).not.toContain("\u001b[");
  });
});
