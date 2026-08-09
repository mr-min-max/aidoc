import { displayDiff } from "../../../src/output/diff-display";

describe("displayDiff", () => {
  it("prints a unified patch for changed documentation", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    try {
      displayDiff("README.md", "# Old\n", "# New\n");

      const output = log.mock.calls.flat().join("\n");
      expect(output).toContain("--- a/README.md");
      expect(output).toContain("+++ b/README.md");
      expect(output).toContain("-# Old");
      expect(output).toContain("+# New");
    } finally {
      log.mockRestore();
    }
  });
});
