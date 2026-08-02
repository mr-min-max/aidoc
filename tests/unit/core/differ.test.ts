import { buildUpdateContext } from "../../../src/core/differ";
import type { ImpactProviderContext } from "../../../src/impact/types";

const impactPlan: ImpactProviderContext = {
  schemaVersion: "aidoc.impact-context.v1",
  impactDigest: "a".repeat(64),
  summary: {
    totalChanges: 1,
    publicApiChanges: 1,
    potentiallyBreaking: 1,
    reviewRequired: 0,
    informational: 0,
    unmapped: 0,
    byCategory: {
      added: 0,
      removed: 0,
      moved: 0,
      "contract-changed": 1,
      "implementation-changed": 0,
      "documentation-changed": 0,
      "dependency-changed": 0,
    },
  },
  changes: [
    {
      id: "typescript:src/index.ts#function:greet",
      category: "contract-changed",
      risk: "potentially-breaking",
      path: "src/index.ts",
      kind: "function",
      qualifiedName: "greet",
      changedContractFacets: ["parameters"],
    },
  ],
  documentation: [
    {
      changeId: "typescript:src/index.ts#function:greet",
      directReferences: [
        {
          file: "README.md",
          section: "API",
          slug: "api",
          reason: "code-span",
        },
      ],
      recommendations: [],
      unmapped: false,
    },
  ],
  omittedRecords: 0,
};

describe("buildUpdateContext", () => {
  // Break caught: update generation regresses to accepting raw changed-file or
  // diff fields instead of the planner's byte-bounded provider projection.
  it("keeps the existing document and bounded impact plan as separate inputs", () => {
    const context = buildUpdateContext("# Existing\n", impactPlan);

    expect(context).toEqual({
      existingDoc: "# Existing\n",
      impactPlan,
    });
    expect(Object.keys(context).sort()).toEqual(["existingDoc", "impactPlan"]);
  });
});
