import {
  indexDocumentation,
  mapDocumentationImpact,
  type DocumentationFile,
} from "../../../src/impact/documentation";
import type { SymbolChange } from "../../../src/impact/types";

const digest = "a".repeat(64);

function change(overrides: Partial<SymbolChange> = {}): SymbolChange {
  return {
    scope: "symbol",
    id: "typescript:src/service.ts#Service.open",
    category: "implementation-changed",
    risk: "informational",
    language: "typescript",
    path: "src/service.ts",
    kind: "method",
    qualifiedName: "Service.open",
    digest,
    ...overrides,
  };
}

describe("documentation indexing", () => {
  it("creates stable GitHub-style slugs for ATX, Setext, and duplicate headings", () => {
    const sections = indexDocumentation([
      {
        path: "docs/API.md",
        content: [
          "# Public API!",
          "first",
          "",
          "Public API!",
          "===========",
          "second",
          "",
          "## Café & tea `code` #",
          "third",
        ].join("\n"),
      },
    ]);

    expect(
      sections.map(({ file, heading, slug, body }) => ({
        file,
        heading,
        slug,
        body,
      })),
    ).toEqual([
      {
        file: "docs/API.md",
        heading: "Café & tea `code`",
        slug: "café--tea-code",
        body: "third",
      },
      {
        file: "docs/API.md",
        heading: "Public API!",
        slug: "public-api",
        body: "first",
      },
      {
        file: "docs/API.md",
        heading: "Public API!",
        slug: "public-api-1",
        body: "second",
      },
    ]);
  });

  it("normalizes safe documentation paths and ignores absolute or escaping paths", () => {
    expect(
      indexDocumentation([
        { path: "docs\\API.md", content: "# API\nSafe" },
        { path: "/tmp/private.md", content: "# Secret\nprivate" },
        { path: "../private.md", content: "# Secret\nprivate" },
      ]).map(({ file }) => file),
    ).toEqual(["docs/API.md"]);
  });

  it("keeps headings inside a bare fenced block out of the section index", () => {
    const sections = indexDocumentation([
      {
        path: "docs/examples.md",
        content: [
          "# Examples",
          "```",
          "# This is code",
          "```",
          "",
          "# After",
          "Done.",
        ].join("\n"),
      },
    ]);

    expect(sections.map(({ heading }) => heading)).toEqual([
      "After",
      "Examples",
    ]);
    expect(sections.find(({ heading }) => heading === "Examples")?.body).toBe(
      "```\n# This is code\n```",
    );
  });

  it("keeps duplicate suffixes unique when a literal suffixed heading follows", () => {
    const sections = indexDocumentation([
      {
        path: "docs/duplicates.md",
        content: "# Topic\n# Topic\n# Topic-1",
      },
    ]);

    expect(sections.map(({ slug }) => slug)).toEqual([
      "topic",
      "topic-1",
      "topic-1-1",
    ]);
  });
});

describe("documentation impact mapping", () => {
  it("accepts only code spans, fenced code, exact source links, and eligible headings as direct evidence", () => {
    const files: DocumentationFile[] = [
      {
        path: "docs/API.md",
        content: [
          "# Plain prose",
          "Service.open is mentioned here but is not evidence.",
          "",
          "## Inline example",
          "Call `Service.open()` to begin.",
          "",
          "## Fenced example",
          "```ts",
          "Service.open({ safe: true })",
          "```",
          "",
          "## Source",
          "[implementation](../src/service.ts#L12)",
          "",
          "## Service.open reference",
          "Heading evidence.",
        ].join("\n"),
      },
    ];

    const [impact] = mapDocumentationImpact([change()], files);

    expect(impact.directReferences).toEqual([
      {
        file: "docs/API.md",
        section: "Fenced example",
        slug: "fenced-example",
        reason: "code-span",
      },
      {
        file: "docs/API.md",
        section: "Inline example",
        slug: "inline-example",
        reason: "code-span",
      },
      {
        file: "docs/API.md",
        section: "Service.open reference",
        slug: "serviceopen-reference",
        reason: "heading",
      },
      {
        file: "docs/API.md",
        section: "Source",
        slug: "source",
        reason: "source-link",
      },
    ]);
    expect(impact.directReferences).not.toContainEqual(
      expect.objectContaining({ section: "Plain prose" }),
    );
  });

  it.each(["run", "main", "open", "get", "set", "api"])(
    "does not treat the generic or short heading name %s as evidence",
    (qualifiedName) => {
      const [impact] = mapDocumentationImpact(
        [change({ qualifiedName })],
        [{ path: "docs/guide.md", content: `# ${qualifiedName}\nProse` }],
      );

      expect(impact).toEqual({
        changeId: change({ qualifiedName }).id,
        directReferences: [],
        recommendations: [],
        unmapped: true,
      });
    },
  );

  it("requires exact qualified names and exact normalized link targets", () => {
    const [impact] = mapDocumentationImpact(
      [change({ qualifiedName: "Service.open" })],
      [
        {
          path: "docs/guide.md",
          content: [
            "# Service.openExtra",
            "`Service.openExtra()`",
            "[nearby](../src/service.tsx)",
          ].join("\n"),
        },
      ],
    );

    expect(impact.directReferences).toEqual([]);
    expect(impact.unmapped).toBe(true);
  });

  it("counts heading links but ignores link-like code and image destinations", () => {
    const [impact] = mapDocumentationImpact(
      [change({ qualifiedName: "Unrelated.symbol" })],
      [
        {
          path: "docs/links.md",
          content: [
            "# Fake code",
            "`[source](../src/service.ts)`",
            "",
            "# Fake image",
            "![source](../src/service.ts)",
            "",
            "# Real [source](../src/service.ts#L20)",
            "Relevant section.",
          ].join("\n"),
        },
      ],
    );

    expect(impact.directReferences).toEqual([
      {
        file: "docs/links.md",
        section: "Real [source](../src/service.ts#L20)",
        slug: "real-sourcesrcservicetsl20",
        reason: "source-link",
      },
    ]);
  });

  it("keeps API, changelog, entrypoint, and architecture recommendations separate from evidence", () => {
    const changes = [
      change({
        id: "added",
        category: "added",
        path: "src/widget.ts",
        qualifiedName: "Widget.create",
      }),
      change({
        id: "breaking",
        category: "removed",
        risk: "potentially-breaking",
        path: "src/legacy.ts",
        qualifiedName: "Legacy.remove",
      }),
      change({
        id: "entrypoint",
        category: "contract-changed",
        path: "src/index.ts",
        qualifiedName: "createClient",
      }),
      change({
        id: "dependency",
        scope: "module",
        category: "dependency-changed",
        path: "src/runtime.ts",
        kind: "module",
        qualifiedName: undefined,
      }),
    ];
    const files: DocumentationFile[] = [
      { path: "CHANGELOG.md", content: "# Changelog\nRelease notes." },
      { path: "README.md", content: "# AiDoc\nGetting started." },
      { path: "docs/API.md", content: "# API Reference\nPublic surface." },
      {
        path: "docs/architecture.md",
        content: "# Architecture\nSystem boundaries.",
      },
    ];

    const impacts = new Map(
      mapDocumentationImpact(changes, files).map((impact) => [
        impact.changeId,
        impact,
      ]),
    );

    expect(impacts.get("added")?.recommendations).toEqual([
      expect.objectContaining({
        file: "docs/API.md",
        slug: "api-reference",
        reason: "api-documentation",
      }),
    ]);
    expect(impacts.get("breaking")?.recommendations).toEqual([
      expect.objectContaining({ reason: "changelog" }),
      expect.objectContaining({ reason: "api-documentation" }),
    ]);
    expect(impacts.get("entrypoint")?.recommendations).toEqual([
      expect.objectContaining({ reason: "entrypoint", file: "README.md" }),
      expect.objectContaining({ reason: "api-documentation" }),
    ]);
    expect(impacts.get("dependency")?.recommendations).toEqual([
      expect.objectContaining({
        reason: "architecture",
        file: "docs/architecture.md",
      }),
    ]);
    for (const impact of impacts.values()) {
      expect(impact.directReferences).toEqual([]);
      expect(impact.unmapped).toBe(false);
    }
  });

  it("deduplicates and sorts references without exposing bodies, credentials, or absolute paths", () => {
    const credential = ["sk", "proj", "S".repeat(40)].join("-");
    const [impact] = mapDocumentationImpact(
      [change({ qualifiedName: "Service.open" })],
      [
        {
          path: "docs/usage.md",
          content: [
            "# Usage",
            "`Service.open()` and again `Service.open()`.",
            credential,
            "[source](../src/service.ts)",
            "[source again](../src/./service.ts#details)",
          ].join("\n"),
        },
        {
          path: "/Users/alice/private.md",
          content: "# Service.open\n`Service.open()`",
        },
      ],
    );
    const serialized = JSON.stringify(impact);

    expect(impact.directReferences).toEqual([
      {
        file: "docs/usage.md",
        section: "Usage",
        slug: "usage",
        reason: "code-span",
      },
      {
        file: "docs/usage.md",
        section: "Usage",
        slug: "usage",
        reason: "source-link",
      },
    ]);
    expect(serialized).not.toContain(credential);
    expect(serialized).not.toContain("/Users/alice");
    expect(serialized).not.toContain("Service.open()");
  });

  it("redacts a credential before deriving an exposed section slug", () => {
    const credential = ["sk", "proj", "T".repeat(40)].join("-");
    const [impact] = mapDocumentationImpact(
      [change({ id: "addition", category: "added" })],
      [
        {
          path: "docs/API.md",
          content: `# API ${credential}\nPublic surface.`,
        },
      ],
    );

    const serialized = JSON.stringify(impact).toLowerCase();
    expect(serialized).not.toContain(credential.toLowerCase());
    expect(impact.recommendations).toHaveLength(1);
  });
});
