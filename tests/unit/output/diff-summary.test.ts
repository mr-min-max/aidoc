import {
  summarizeTextDiff,
  type SafeDiffSummary,
} from "../../../src/output/diff-summary";

function expectSummary(value: SafeDiffSummary): void {
  expect(Object.keys(value).sort()).toEqual([
    "addedLines",
    "changed",
    "newBytes",
    "oldBytes",
    "removedLines",
  ]);
  expect(JSON.stringify(value)).not.toMatch(/secret|prompt|path|sentinel/iu);
}

describe("summarizeTextDiff", () => {
  it("reports unchanged text with byte sizes only", () => {
    const result = summarizeTextDiff("# Title\n", "# Title\n");

    expect(result).toEqual({
      changed: false,
      addedLines: 0,
      removedLines: 0,
      oldBytes: 8,
      newBytes: 8,
    });
    expectSummary(result);
  });

  it.each([
    ["addition", "one\n", "one\ntwo\n", 1, 0],
    ["removal", "one\ntwo\n", "one\n", 0, 1],
    ["replacement", "old\n", "new\n", 1, 1],
  ])(
    "summarizes a %s without returning content",
    (_label, before, after, added, removed) => {
      const result = summarizeTextDiff(before, after);

      expect(result.changed).toBe(true);
      expect(result.addedLines).toBe(added);
      expect(result.removedLines).toBe(removed);
      expectSummary(result);
    },
  );

  it("counts UTF-8 bytes and treats line-ending changes as content changes", () => {
    const result = summarizeTextDiff("Привіт\r\n", "Привіт\n");

    expect(result).toEqual({
      changed: true,
      addedLines: 1,
      removedLines: 1,
      oldBytes: Buffer.byteLength("Привіт\r\n", "utf8"),
      newBytes: Buffer.byteLength("Привіт\n", "utf8"),
    });
    expectSummary(result);
  });

  it("handles large documents without exposing their lines", () => {
    const before = Array.from(
      { length: 5000 },
      (_, index) => `old-${index}`,
    ).join("\n");
    const after = Array.from(
      { length: 5000 },
      (_, index) => `new-${index}`,
    ).join("\n");
    const result = summarizeTextDiff(before, after);

    expect(result.changed).toBe(true);
    expect(result.oldBytes).toBe(Buffer.byteLength(before));
    expect(result.newBytes).toBe(Buffer.byteLength(after));
    expect(result.addedLines).toBe(5000);
    expect(result.removedLines).toBe(5000);
    expectSummary(result);
  });
});
