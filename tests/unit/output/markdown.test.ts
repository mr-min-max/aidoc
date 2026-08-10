import {
  validateChangelogEntry,
  validateGeneratedContent,
  validateMarkdown,
  validateMermaidSource,
  readExistingMarkdown,
} from "../../../src/output/markdown";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Markdown Output", () => {
  it("should validate correct markdown", () => {
    const result = validateMarkdown(
      "# Title\n\nSome content\n\n## Section\n\nMore content",
    );
    expect(result.isValid).toBe(true);
  });

  it("should warn on markdown without heading", () => {
    const result = validateMarkdown("Just some text without heading");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("heading");
  });

  it("should detect unclosed code blocks", () => {
    const result = validateMarkdown("# Title\n\n```js\ncode");
    expect(result.warnings.some((w) => w.includes("code blocks"))).toBe(true);
  });

  it("reads existing markdown for a read-only preview", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-test-"));
    const outPath = path.join(tmpDir, "test.md");
    fs.writeFileSync(outPath, "# Test\n\nContent");
    try {
      expect(readExistingMarkdown(outPath)).toBe("# Test\n\nContent");
      expect(readExistingMarkdown(path.join(tmpDir, "missing.md"))).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe("Generated provider output", () => {
  it("rejects blank content before a command wraps it", () => {
    const result = validateGeneratedContent(" \n\t");

    expect(result.isValid).toBe(false);
    expect(result.warnings).toContain("Generated provider output is blank");
  });

  it("requires the requested Keep a Changelog version heading", () => {
    const result = validateChangelogEntry(
      "## [2.0.0] - 2026-07-31\n\n### Fixed\n\n- Wrong release",
      "1.2.3",
    );

    expect(result.isValid).toBe(false);
    expect(result.warnings.join(" ")).toContain("## [1.2.3]");
  });

  it("accepts a changelog entry with the requested version heading", () => {
    const result = validateChangelogEntry(
      "## [1.2.3] - 2026-07-31\n\n### Fixed\n\n- Correct release",
      "1.2.3",
    );

    expect(result).toEqual({ isValid: true, warnings: [] });
  });

  it.each([
    ["prose", "Here is your diagram:\ngraph TD\n  A --> B"],
    ["a provider fence", "```mermaid\ngraph TD\n  A --> B\n```"],
    ["a missing direction", "flowchart\n  A --> B"],
  ])("rejects Mermaid source that starts with %s", (_case, source) => {
    const result = validateMermaidSource(source);

    expect(result.isValid).toBe(false);
  });

  it.each(["graph TD\n  A --> B", "\nflowchart LR\n  A --> B"])(
    "accepts supported Mermaid roots",
    (source) => {
      expect(validateMermaidSource(source)).toEqual({
        isValid: true,
        warnings: [],
      });
    },
  );
});
