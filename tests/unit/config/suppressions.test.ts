import { parseSuppressions, matchingSuppression } from "../../../src/config/suppressions";

describe(".staledocsignore suppressions", () => {
  it("parses symbols, source paths, and documentation paths while ignoring comments and invalid lines", () => {
    const result = parseSuppressions(`
# known debt
createUser
Svc.*
src/internal/**
docs/legacy/*.md

not a valid entry
../outside.ts
Other?
src/[private]/**
docs/{old,legacy}/*.md
`);

    expect(result).toEqual({
      symbols: ["Svc.*", "createUser"],
      sourcePaths: ["src/internal/**"],
      docPaths: ["docs/legacy/*.md"],
    });
  });

  it("matches a qualified-name glob only on the intended last segment", () => {
    const parsed = parseSuppressions("Svc.*\n");

    expect(matchingSuppression("Svc.run", parsed.symbols)).toBe("Svc.*");
    expect(matchingSuppression("Other.run", parsed.symbols)).toBeUndefined();
    expect(matchingSuppression("Svc.run.deep", parsed.symbols)).toBeUndefined();
  });

  it("matches the supported path stars and rejects other glob syntax", () => {
    const parsed = parseSuppressions(`
src/internal/**
docs/legacy/*.md
src/file?.ts
src/[private]/**
docs/{old,legacy}/*.md
`);

    expect(matchingSuppression("src/internal/file.ts", parsed.sourcePaths)).toBe(
      "src/internal/**",
    );
    expect(
      matchingSuppression("src/internal/deep/file.ts", parsed.sourcePaths),
    ).toBe("src/internal/**");
    expect(matchingSuppression("src/public/file.ts", parsed.sourcePaths)).toBeUndefined();
    expect(matchingSuppression("docs/legacy/old.md", parsed.docPaths)).toBe(
      "docs/legacy/*.md",
    );
    expect(matchingSuppression("docs/current/old.md", parsed.docPaths)).toBeUndefined();
    expect(
      matchingSuppression("docs/legacy/deep/old.md", parsed.docPaths),
    ).toBeUndefined();
    expect(parsed).toEqual({
      symbols: [],
      sourcePaths: ["src/internal/**"],
      docPaths: ["docs/legacy/*.md"],
    });
  });
});
