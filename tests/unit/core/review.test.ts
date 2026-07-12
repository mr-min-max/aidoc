import {
  reviewDocImpact,
  renderReviewMarkdown,
} from "../../../src/core/review.js";
import { ParsedModule } from "../../../src/parsers/types.js";

function mod(overrides: Partial<ParsedModule>): ParsedModule {
  return {
    filePath: "src/example.ts",
    language: "typescript",
    functions: [],
    classes: [],
    types: [],
    imports: [],
    ...overrides,
  };
}

function fn(name: string, exported = true, doc?: string) {
  return {
    name,
    parameters: [],
    returnType: "void",
    isAsync: false,
    isExported: exported,
    lineRange: [1, 2] as [number, number],
    existingDoc: doc,
    signature: `${name}()`,
  };
}

describe("reviewDocImpact", () => {
  it("flags exported symbols that are absent from the docs", () => {
    const modules = [
      mod({ functions: [fn("createWidget", true, "Makes a widget.")] }),
    ];
    const result = reviewDocImpact(modules, {
      docText: "# Project\n\nNothing relevant here.",
      docLabel: "README.md",
    });

    expect(result.exportedSymbols).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.issues[0].symbol).toBe("createWidget");
    expect(result.issues[0].reasons).toContain("not referenced in README.md");
  });

  it("counts symbols referenced in the docs as documented", () => {
    const modules = [
      mod({ functions: [fn("createWidget", true, "Makes a widget.")] }),
    ];
    const result = reviewDocImpact(modules, {
      docText: "Call `createWidget()` to make a widget.",
      docLabel: "README.md",
    });

    expect(result.referencedInDoc).toBe(1);
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("flags a missing inline doc comment unless disabled", () => {
    const modules = [mod({ functions: [fn("createWidget", true, undefined)] })];

    const withInline = reviewDocImpact(modules, {
      docText: "createWidget is great",
      docLabel: "README.md",
    });
    expect(withInline.issues[0].reasons).toContain(
      "missing inline doc comment",
    );

    const withoutInline = reviewDocImpact(modules, {
      docText: "createWidget is great",
      docLabel: "README.md",
      requireInlineDoc: false,
    });
    expect(withoutInline.ok).toBe(true);
  });

  it("ignores non-exported symbols", () => {
    const modules = [
      mod({ functions: [fn("internalHelper", false, undefined)] }),
    ];
    const result = reviewDocImpact(modules, {
      docText: "",
      docLabel: "README.md",
    });
    expect(result.exportedSymbols).toBe(0);
    expect(result.ok).toBe(true);
  });

  it("matches whole words only (avoids substring false positives)", () => {
    const modules = [mod({ functions: [fn("parse", true, "docs")] })];
    const result = reviewDocImpact(modules, {
      docText: "This mentions parseConfig but not the bare symbol.",
      docLabel: "README.md",
    });
    // "parse" is a substring of "parseConfig" but not a whole word -> not referenced.
    expect(result.issues[0].reasons).toContain("not referenced in README.md");
  });
});

describe("renderReviewMarkdown", () => {
  it("reports a clean bill of health when there are no issues", () => {
    const result = reviewDocImpact(
      [mod({ functions: [fn("createWidget", true, "doc")] })],
      { docText: "createWidget", docLabel: "README.md" },
    );
    const md = renderReviewMarkdown(result);
    expect(md).toContain("No documentation gaps detected");
  });

  it("groups issues by file", () => {
    const result = reviewDocImpact(
      [mod({ filePath: "src/a.ts", functions: [fn("alpha", true, "doc")] })],
      { docText: "", docLabel: "README.md" },
    );
    const md = renderReviewMarkdown(result);
    expect(md).toContain("`src/a.ts`");
    expect(md).toContain("**alpha**");
  });

  it("handles the no-changes case", () => {
    const result = reviewDocImpact([], { docText: "", docLabel: "README.md" });
    const md = renderReviewMarkdown(result);
    expect(md).toContain("No changed source files");
  });
});
