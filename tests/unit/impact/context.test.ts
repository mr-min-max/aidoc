import { canonicalStringify } from "../../../src/impact/canonical";
import { buildImpactContext } from "../../../src/impact/context";
import type {
  ChangeCategory,
  DocumentationImpact,
  ImpactSummary,
  SymbolChange,
} from "../../../src/impact/types";

const digest = (character: string): string => character.repeat(64);

const categories: ChangeCategory[] = [
  "added",
  "removed",
  "moved",
  "contract-changed",
  "implementation-changed",
  "documentation-changed",
  "dependency-changed",
];

function change(
  category: ChangeCategory,
  name: string,
  overrides: Partial<SymbolChange> = {},
): SymbolChange {
  return {
    scope: category === "dependency-changed" ? "module" : "symbol",
    id: `typescript:src/${name}.ts#function:${name}`,
    category,
    risk:
      category === "removed"
        ? "potentially-breaking"
        : category === "contract-changed"
          ? "review-required"
          : "informational",
    language: "typescript",
    path: `src/${name}.ts`,
    kind: category === "dependency-changed" ? "module" : "function",
    qualifiedName: category === "dependency-changed" ? undefined : name,
    digest: digest(name.charAt(0) || "a"),
    ...overrides,
  };
}

function summary(changes: SymbolChange[]): ImpactSummary {
  const byCategory = Object.fromEntries(
    categories.map((category) => [category, 0]),
  ) as Record<ChangeCategory, number>;
  for (const item of changes) byCategory[item.category] += 1;
  return {
    totalChanges: changes.length,
    publicApiChanges: changes.filter(({ scope }) => scope === "symbol").length,
    potentiallyBreaking: changes.filter(
      ({ risk }) => risk === "potentially-breaking",
    ).length,
    reviewRequired: changes.filter(({ risk }) => risk === "review-required")
      .length,
    informational: changes.filter(({ risk }) => risk === "informational")
      .length,
    unmapped: 0,
    byCategory,
  };
}

function documentation(changeId: string): DocumentationImpact {
  return {
    changeId,
    directReferences: [
      {
        file: "docs/API.md",
        section: "Public API",
        slug: "public-api",
        reason: "api-documentation",
      },
    ],
    recommendations: [],
    unmapped: false,
  };
}

function build(
  changes: SymbolChange[],
  maxBytes = 1048576,
  docs: DocumentationImpact[] = [],
) {
  return buildImpactContext({
    impactDigest: digest("f"),
    summary: summary(changes),
    changes,
    documentation: docs,
    maxBytes,
  });
}

function collectKeysAndStrings(
  value: unknown,
  keys: string[] = [],
  strings: string[] = [],
): { keys: string[]; strings: string[] } {
  if (typeof value === "string") strings.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectKeysAndStrings(item, keys, strings);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectKeysAndStrings(child, keys, strings);
    }
  }
  return { keys, strings };
}

function validInput(
  changes: SymbolChange[] = [],
  docs: DocumentationImpact[] = [],
): Parameters<typeof buildImpactContext>[0] {
  return {
    impactDigest: digest("f"),
    summary: summary(changes),
    changes,
    documentation: docs,
    maxBytes: 1048576,
  };
}

function expectInvalidContextPayload(
  input: Parameters<typeof buildImpactContext>[0],
  forbidden?: string,
): void {
  let thrown: unknown;
  try {
    buildImpactContext(input);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toMatchObject({
    code: "PLAN_PARSE_FAILED",
    message: "The impact context payload is invalid.",
  });
  if (forbidden !== undefined) {
    expect(String(thrown)).not.toContain(forbidden);
  }
}

describe("impact provider context budgeting", () => {
  it("orders complete records by category priority and path/kind/name ties", () => {
    const changes = [
      change("documentation-changed", "docs"),
      change("implementation-changed", "implementation"),
      change("dependency-changed", "dependency"),
      change("added", "addition-z"),
      change("added", "addition-a"),
      change("moved", "move"),
      change("contract-changed", "contract"),
      change("removed", "removal"),
    ];
    const docs = changes.map(({ id }) => documentation(id)).reverse();

    const { providerContext, report } = build(changes, 1048576, docs);

    expect(
      providerContext.changes.map(({ category, qualifiedName }) => [
        category,
        qualifiedName,
      ]),
    ).toEqual([
      ["removed", "removal"],
      ["contract-changed", "contract"],
      ["moved", "move"],
      ["added", "addition-a"],
      ["added", "addition-z"],
      ["dependency-changed", undefined],
      ["implementation-changed", "implementation"],
      ["documentation-changed", "docs"],
    ]);
    expect(
      providerContext.documentation.map(({ changeId }) => changeId),
    ).toEqual(providerContext.changes.map(({ id }) => id));
    expect(report).toMatchObject({
      totalRecords: 8,
      includedRecords: 8,
      omittedRecords: 0,
    });
  });

  it("uses exact canonical UTF-8 bytes at a boundary without slicing JSON", () => {
    const changes = [
      change("removed", "Привет-😀"),
      change("contract-changed", "контракт-🧭", {
        changedContractFacets: ["return", "parameters"],
      }),
      change("added", "добавление-🚀"),
    ];
    const docs = changes.map(({ id }) => documentation(id));
    const roomy = build(changes, 1048576, docs);
    const exactBytes = Buffer.byteLength(
      canonicalStringify(roomy.providerContext),
      "utf8",
    );

    const exact = build(changes, exactBytes, docs);
    const smaller = build(changes, exactBytes - 1, docs);

    expect(exact.providerContext).toEqual(roomy.providerContext);
    expect(exact.report.usedBytes).toBe(exactBytes);
    expect(exact.report.usedBytes).toBeLessThanOrEqual(exact.report.maxBytes);
    expect(smaller.report.usedBytes).toBeLessThanOrEqual(exactBytes - 1);
    expect(smaller.providerContext).not.toEqual(exact.providerContext);
    expect(() =>
      JSON.parse(canonicalStringify(smaller.providerContext)),
    ).not.toThrow();
    expect(canonicalStringify(build(changes, exactBytes - 1, docs))).toBe(
      canonicalStringify(smaller),
    );
  });

  it("preserves the full summary and digest while reporting omitted records", () => {
    const changes = Array.from({ length: 20 }, (_, index) =>
      change("added", `record-${index.toString().padStart(2, "0")}`),
    );
    const expectedSummary = summary(changes);

    const { providerContext, report } = build(changes, 1024);

    expect(providerContext.impactDigest).toBe(digest("f"));
    expect(providerContext.summary).toEqual(expectedSummary);
    expect(report.impactDigest).toBe(digest("f"));
    expect(report.totalRecords).toBe(20);
    expect(report.includedRecords).toBe(providerContext.changes.length);
    expect(report.omittedRecords).toBe(20 - providerContext.changes.length);
    expect(providerContext.omittedRecords).toBe(report.omittedRecords);
    expect(report.omittedRecords).toBeGreaterThan(0);
    expect(report.usedBytes).toBe(
      Buffer.byteLength(canonicalStringify(providerContext), "utf8"),
    );
  });

  it("replaces an oversized identifier with the exact fixed compact shape", () => {
    const hugeName = `never-slice-${"Ж😀".repeat(3000)}`;
    const oversized = change("removed", hugeName, { digest: digest("9") });

    const { providerContext, report } = build([oversized], 1024, [
      documentation(oversized.id),
    ]);

    expect(providerContext.changes).toEqual([
      {
        id: digest("9"),
        category: "removed",
        risk: "potentially-breaking",
        kind: "function",
        compacted: true,
      },
    ]);
    expect(providerContext.documentation).toEqual([
      expect.objectContaining({ changeId: digest("9") }),
    ]);
    expect(canonicalStringify(providerContext)).not.toContain("never-slice");
    expect(report).toMatchObject({
      totalRecords: 1,
      includedRecords: 1,
      omittedRecords: 0,
    });
  });

  it("projects allowlisted fields and recursively excludes source-shaped values", () => {
    const secret = ["sk", "proj", "A".repeat(32)].join("-");
    const unsafePath = "/Users/example/project/.worktrees/release-integrity";
    const gitError = "fatal: bad revision private-ref";
    const item = change("contract-changed", "safe", {
      id: `typescript:${unsafePath}#function:${secret}`,
      path: unsafePath,
      qualifiedName: secret,
      changedContractFacets: ["return"],
    }) as SymbolChange & Record<string, unknown>;
    Object.assign(item, {
      source: secret,
      diff: gitError,
      body: unsafePath,
      signature: secret,
      literal: gitError,
      docstring: unsafePath,
    });
    const doc = documentation(item.id) as DocumentationImpact &
      Record<string, unknown>;
    Object.assign(doc, { body: secret, source: unsafePath, diff: gitError });
    Object.assign(doc.directReferences[0] as object, {
      file: unsafePath,
      section: gitError,
      slug: secret,
      body: secret,
      signature: gitError,
    });
    const inputSummary = summary([item]) as ImpactSummary &
      Record<string, unknown>;
    Object.assign(inputSummary, { source: secret, body: unsafePath });
    const poisonedFacet = change("contract-changed", "otherwise-safe", {
      changedContractFacets: ["return", secret as "return"],
    });

    const { providerContext } = buildImpactContext({
      impactDigest: digest("f"),
      summary: { ...inputSummary, totalChanges: 2, publicApiChanges: 2 },
      changes: [item, poisonedFacet],
      documentation: [doc],
      maxBytes: 12000,
    });
    const inspected = collectKeysAndStrings(providerContext);

    for (const forbiddenKey of [
      "source",
      "diff",
      "body",
      "signature",
      "literal",
      "docstring",
    ]) {
      expect(inspected.keys).not.toContain(forbiddenKey);
    }
    for (const forbiddenValue of [secret, unsafePath, gitError]) {
      expect(inspected.strings).not.toContain(forbiddenValue);
    }
  });

  it("rejects a non-hash impact digest without copying it into either envelope", () => {
    const sentinel = ["sk", "proj", "D".repeat(32)].join("-");
    const input = validInput();
    input.impactDigest = sentinel;

    expectInvalidContextPayload(input, sentinel);
  });

  it.each([
    "totalChanges",
    "publicApiChanges",
    "potentiallyBreaking",
    "reviewRequired",
    "informational",
    "unmapped",
  ] as const)(
    "rejects a poisoned summary %s count with a fixed value-free failure",
    (field) => {
      const sentinel = ["sk", "proj", "S".repeat(32)].join("-");
      const input = validInput();
      (input.summary as unknown as Record<string, unknown>)[field] = sentinel;

      expectInvalidContextPayload(input, sentinel);
    },
  );

  it.each(categories)(
    "rejects a poisoned summary byCategory.%s count independently",
    (category) => {
      const sentinel = ["sk", "proj", "B".repeat(32)].join("-");
      const input = validInput();
      (input.summary.byCategory as unknown as Record<string, unknown>)[
        category
      ] = sentinel;

      expectInvalidContextPayload(input, sentinel);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    "rejects the invalid runtime count %p",
    (invalidCount) => {
      const input = validInput();
      input.summary.totalChanges = invalidCount;

      expectInvalidContextPayload(input);
    },
  );

  it.each([
    {
      label: "category",
      poison: (item: SymbolChange, sentinel: string) => {
        (item as unknown as Record<string, unknown>).category = sentinel;
      },
    },
    {
      label: "risk",
      poison: (item: SymbolChange, sentinel: string) => {
        (item as unknown as Record<string, unknown>).risk = sentinel;
      },
    },
    {
      label: "kind",
      poison: (item: SymbolChange, sentinel: string) => {
        (item as unknown as Record<string, unknown>).kind = sentinel;
      },
    },
    {
      label: "compact digest",
      poison: (item: SymbolChange, sentinel: string) => {
        item.path = "/absolute/path/forcing/compact";
        item.digest = sentinel;
      },
    },
  ])(
    "omits a record with a poisoned $label while preserving a valid sibling",
    ({ poison }) => {
      const sentinel = ["sk", "proj", "R".repeat(32)].join("-");
      const poisoned = change("added", "poisoned");
      const sibling = change("removed", "valid-sibling");
      poison(poisoned, sentinel);

      const result = build([poisoned, sibling]);
      const serialized = canonicalStringify(result);

      expect(serialized).not.toContain(sentinel);
      expect(result.providerContext.changes).toEqual([
        expect.objectContaining({ qualifiedName: "valid-sibling" }),
      ]);
      expect(result.report).toMatchObject({
        totalRecords: 2,
        includedRecords: 1,
        omittedRecords: 1,
      });
    },
  );

  it.each([
    {
      label: "id absolute path",
      poison: (item: SymbolChange, value: string) => {
        item.id = `typescript:${value}#function:poisoned`;
      },
      value: "/Users/private/worktree/src/poisoned.ts",
    },
    {
      label: "path absolute path",
      poison: (item: SymbolChange, value: string) => {
        item.path = value;
      },
      value: "/Users/private/worktree/src/poisoned.ts",
    },
    {
      label: "qualified name absolute path",
      poison: (item: SymbolChange, value: string) => {
        item.qualifiedName = value;
      },
      value: "/Users/private/worktree/src/poisoned.ts",
    },
    {
      label: "qualified name Git diagnostic",
      poison: (item: SymbolChange, value: string) => {
        item.qualifiedName = value;
      },
      value: "fatal: bad revision private-ref",
    },
  ])(
    "compacts a record with a poisoned $label without losing a valid sibling",
    ({ poison, value }) => {
      const poisoned = change("added", "poisoned", { digest: digest("9") });
      const sibling = change("removed", "valid-sibling");
      poison(poisoned, value);

      const result = build([poisoned, sibling]);
      const serialized = canonicalStringify(result);

      expect(serialized).not.toContain(value);
      expect(result.providerContext.changes).toEqual([
        expect.objectContaining({ qualifiedName: "valid-sibling" }),
        {
          id: digest("9"),
          category: "added",
          risk: "informational",
          kind: "function",
          compacted: true,
        },
      ]);
      expect(result.report).toMatchObject({
        totalRecords: 2,
        includedRecords: 2,
        omittedRecords: 0,
      });
    },
  );

  it("drops a documentation impact with a non-boolean unmapped value only", () => {
    const sentinel = ["sk", "proj", "U".repeat(32)].join("-");
    const item = change("added", "documented");
    const poisoned = documentation(item.id);
    (poisoned as unknown as Record<string, unknown>).unmapped = sentinel;
    const sibling = documentation(item.id);
    sibling.directReferences[0].section = "Valid sibling reference";
    sibling.directReferences[0].slug = "valid-sibling-reference";

    const result = build([item], 1048576, [poisoned, sibling]);
    const serialized = canonicalStringify(result);

    expect(serialized).not.toContain(sentinel);
    expect(result.providerContext.documentation).toEqual([
      expect.objectContaining({
        unmapped: false,
        directReferences: [
          expect.objectContaining({ section: "Valid sibling reference" }),
        ],
      }),
    ]);
  });

  it.each([
    {
      label: "file absolute path",
      field: "file",
      value: "/Users/private/worktree/docs/API.md",
    },
    {
      label: "section absolute path",
      field: "section",
      value: "/Users/private/worktree/docs/API.md",
    },
    {
      label: "section Git diagnostic",
      field: "section",
      value: "fatal: bad revision private-ref",
    },
    {
      label: "slug absolute path",
      field: "slug",
      value: "/Users/private/worktree/docs/API.md",
    },
    {
      label: "slug Git diagnostic",
      field: "slug",
      value: "fatal: bad revision private-ref",
    },
    {
      label: "reason enum",
      field: "reason",
      value: ["sk", "proj", "E".repeat(32)].join("-"),
    },
  ] as const)(
    "drops a poisoned documentation reference $label but keeps its sibling",
    ({ field, value }) => {
      const item = change("added", "documented");
      const doc = documentation(item.id);
      const validSibling = {
        file: "docs/SAFE.md",
        section: "Safe reference",
        slug: "safe-reference",
        reason: "api-documentation" as const,
      };
      doc.directReferences.push(validSibling);
      (doc.directReferences[0] as unknown as Record<string, unknown>)[field] =
        value;

      const result = build([item], 1048576, [doc]);
      const serialized = canonicalStringify(result);

      expect(serialized).not.toContain(value);
      expect(result.providerContext.documentation).toEqual([
        expect.objectContaining({ directReferences: [validSibling] }),
      ]);
    },
  );

  it.each(["directReferences", "recommendations"] as const)(
    "validates poisoned strings in %s independently",
    (collection) => {
      const value = "fatal: bad revision private-ref";
      const item = change("added", "documented");
      const doc = documentation(item.id);
      const validSibling = {
        file: "docs/SAFE.md",
        section: "Safe reference",
        slug: "safe-reference",
        reason: "api-documentation" as const,
      };
      doc[collection] = [
        {
          file: "docs/POISONED.md",
          section: value,
          slug: "poisoned",
          reason: "api-documentation",
        },
        validSibling,
      ];

      const result = build([item], 1048576, [doc]);
      const serialized = canonicalStringify(result);

      expect(serialized).not.toContain(value);
      expect(result.providerContext.documentation[0][collection]).toEqual([
        validSibling,
      ]);
    },
  );

  it("rejects budgets that cannot be a validated mandatory envelope", () => {
    expect(() => build([], 1023)).toThrow(
      expect.objectContaining({ code: "PLAN_INVALID_CONTEXT_BUDGET" }),
    );
    expect(build([], 1024).providerContext.changes).toEqual([]);
  });
});
