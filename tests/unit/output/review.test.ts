import {
  renderReviewMarkdown,
  renderReviewText,
  serializeReviewReport,
  type ReviewReport,
} from "../../../src/output/review";

function report(overrides: Partial<ReviewReport> = {}): ReviewReport {
  return {
    schemaVersion: "aidoc.review.v1",
    base: { type: "git", label: "main", commit: "a".repeat(40) },
    head: { type: "working-tree", label: "working-tree" },
    summary: {
      publicApiChanges: 1,
      breaking: 1,
      staleDocuments: 1,
      coChangedDocuments: 0,
      unmappedSymbols: 0,
      suppressed: 0,
    },
    changes: [
      {
        id: "change",
        qualifiedName: "createUser",
        kind: "function",
        category: "contract-changed",
        risk: "potentially-breaking",
        path: "src/user.ts",
        before: "createUser(email: string): string",
        after: "createUser(email: string, role: string): string",
        changedContractFacets: ["parameters"],
      },
    ],
    documents: [
      {
        path: "README.md",
        status: "stale",
        sections: [{ section: "API", slug: "api", symbols: ["createUser"] }],
      },
    ],
    unmapped: [],
    suppressed: [],
    verdict: "breaking",
    ...overrides,
  };
}

describe("review output", () => {
  it("renders the locked deterministic full Markdown comment", () => {
    const full = report({
      summary: {
        publicApiChanges: 3,
        breaking: 1,
        staleDocuments: 2,
        coChangedDocuments: 1,
        unmappedSymbols: 1,
        suppressed: 0,
      },
      changes: [
        {
          id: "helper-export",
          qualifiedName: "helperExport",
          kind: "function",
          category: "added",
          risk: "informational",
          path: "src/z-helper.ts",
          after: "helperExport(): void",
        },
        {
          id: "user-service-create",
          qualifiedName: "UserService.create",
          kind: "method",
          category: "contract-changed",
          risk: "review-required",
          path: "src/user.ts",
          before: "create(email: string): Promise<string>",
          after: "create(email: string, role: string): Promise<string>",
          changedContractFacets: ["parameters"],
        },
        report().changes[0],
      ],
      documents: [
        {
          path: "docs/API.md",
          status: "stale",
          sections: [
            {
              section: "createUser",
              slug: "createuser",
              symbols: ["UserService.create", "createUser"],
            },
          ],
        },
        {
          path: "CHANGELOG.md",
          status: "co-changed",
          sections: [
            {
              section: "Unreleased",
              slug: "unreleased",
              symbols: ["createUser"],
            },
          ],
        },
        {
          path: "README.md",
          status: "stale",
          sections: [{ section: "API", slug: "api", symbols: ["createUser"] }],
        },
      ],
      unmapped: ["helperExport"],
    });

    expect(renderReviewMarkdown(full)).toBe(
      "<!-- staledocs-review -->\n" +
        "### StaleDocs: documentation impact\n\n" +
        "**3 public API changes**, 1 potentially breaking. **2 documentation sections** mention changed symbols and were not updated in this PR.\n\n" +
        "| Symbol | Change | Before | After |\n" +
        "| --- | --- | --- | --- |\n" +
        "| `createUser` | parameters (breaking) | `createUser(email: string): string` | `createUser(email: string, role: string): string` |\n" +
        "| `UserService.create` | parameters | `create(email: string): Promise<string>` | `create(email: string, role: string): Promise<string>` |\n" +
        "| `helperExport` | added |  | `helperExport(): void` |\n\n" +
        "**Needs a documentation update**\n" +
        "- `README.md` > API: `createUser`\n" +
        "- `docs/API.md` > createUser: `UserService.create`, `createUser`\n\n" +
        "**Updated in this PR**\n" +
        "- `CHANGELOG.md`\n\n" +
        "**Not mentioned in any documentation:** `helperExport`\n\n" +
        '<sub>Deterministic AST analysis; no model was used. Suppress a symbol with `.staledocsignore`. <a href="https://github.com/mr-min-max/staledocs">StaleDocs</a></sub>',
    );
  });

  it("uses the exact compact zero-change comment", () => {
    expect(
      renderReviewMarkdown(
        report({
          summary: { ...report().summary, publicApiChanges: 0, breaking: 0 },
          changes: [],
          documents: [],
          verdict: "clean",
        }),
      ),
    ).toBe(
      "<!-- staledocs-review -->\n### StaleDocs: documentation impact\nNo public API changes in this pull request.",
    );
  });

  it("escapes pipes, sorts changes, and truncates the changes table", () => {
    const changes = ["zeta", "alpha", "middle"].map((qualifiedName, index) => ({
      ...report().changes[0],
      id: `change-${index}`,
      qualifiedName,
      before: "f(x: A | B): void",
      after: "f(x: A | B, y: C): void",
    }));
    const rendered = renderReviewMarkdown(
      report({
        changes,
        summary: { ...report().summary, publicApiChanges: 3 },
      }),
      2,
    );
    expect(rendered).toContain("A \\| B");
    expect(rendered.indexOf("`alpha`")).toBeLessThan(
      rendered.indexOf("`middle`"),
    );
    expect(rendered).not.toContain("`zeta`");
    expect(rendered).toContain("+1 more");
  });

  it("caps each named Markdown list at twenty entries", () => {
    const staleDocuments = Array.from({ length: 21 }, (_, index) => ({
      path: `docs/stale-${String(index).padStart(2, "0")}.md`,
      status: "stale" as const,
      sections: [
        {
          section: `Section ${index}`,
          slug: `section-${index}`,
          symbols: [`stale${index}`],
        },
      ],
    }));
    const updatedDocuments = Array.from({ length: 21 }, (_, index) => ({
      path: `docs/updated-${String(index).padStart(2, "0")}.md`,
      status: "co-changed" as const,
      sections: [
        {
          section: "API",
          slug: "api",
          symbols: ["createUser"],
        },
      ],
    }));
    const unmapped = Array.from(
      { length: 21 },
      (_, index) => `unmapped${String(index).padStart(2, "0")}`,
    );
    const rendered = renderReviewMarkdown(
      report({
        documents: [...updatedDocuments.reverse(), ...staleDocuments.reverse()],
        unmapped: unmapped.reverse(),
      }),
    );

    expect(rendered).toContain("- `docs/stale-19.md`");
    expect(rendered).not.toContain("- `docs/stale-20.md`");
    expect(rendered).toContain("- `docs/updated-19.md`");
    expect(rendered).not.toContain("- `docs/updated-20.md`");
    expect(rendered).toContain("`unmapped19`");
    expect(rendered).not.toContain("`unmapped20`");
    expect(rendered.match(/\+1 more/gu)).toHaveLength(3);
  });

  it("renders entry and fallback boundary details in Markdown and text", () => {
    const entry = report({
      summary: { ...report().summary, internalChanges: 2 },
      boundary: {
        typescript: {
          mode: "entry",
          entries: ["src/index.ts"],
          filesRead: 12,
        },
      },
    });
    const fallback = report({
      summary: { ...report().summary, publicApiChanges: 0, breaking: 0 },
      changes: [],
      documents: [],
      verdict: "clean",
      boundary: {
        typescript: {
          mode: "fallback",
          entries: [],
          reason: "no-manifest",
          filesRead: 0,
        },
      },
    });

    expect(renderReviewMarkdown(entry)).toContain(
      "Public boundary (TypeScript): `src/index.ts`. 2 internal changes not shown.",
    );
    expect(renderReviewText(entry)).toContain(
      "Public boundary (TypeScript): `src/index.ts`. 2 internal changes not shown.",
    );
    expect(renderReviewMarkdown(fallback)).toContain(
      "Public boundary (TypeScript): not resolved (no-manifest); every export is treated as public.",
    );
  });

  it("renders text without a Markdown table and canonical JSON", () => {
    expect(renderReviewText(report())).not.toContain("| Symbol |");
    expect(JSON.parse(serializeReviewReport(report())).schemaVersion).toBe(
      "aidoc.review.v1",
    );
  });
});
