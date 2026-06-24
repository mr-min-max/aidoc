import { buildUpdateContext } from "../../../src/core/differ";

describe("buildUpdateContext", () => {
  it("should create context with all fields", () => {
    const ctx = buildUpdateContext(
      "# Old doc",
      ["src/a.ts", "src/b.ts"],
      "some diff",
    );
    expect(ctx.existingDoc).toBe("# Old doc");
    expect(ctx.changedFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(ctx.diffSummary).toBe("some diff");
  });

  it("should generate default diffSummary when not provided", () => {
    const ctx = buildUpdateContext("doc", ["file1.ts"]);
    expect(ctx.diffSummary).toBe("Changed files: file1.ts");
  });

  it("should handle empty changed files", () => {
    const ctx = buildUpdateContext("doc", []);
    expect(ctx.changedFiles).toEqual([]);
    expect(ctx.diffSummary).toBe("Changed files: ");
  });
});
