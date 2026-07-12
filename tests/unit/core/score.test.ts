import { scoreModules, bucket } from "../../../src/core/score";
import { ParsedModule } from "../../../src/parsers/types";

const mod = (overrides: Partial<ParsedModule>): ParsedModule => ({
  filePath: "x.ts",
  language: "typescript",
  functions: [],
  classes: [],
  types: [],
  imports: [],
  ...overrides,
});

describe("scoreModules", () => {
  it("scores 100 when all exported symbols are documented", () => {
    const m = mod({
      functions: [
        {
          name: "f",
          parameters: [],
          isAsync: false,
          isExported: true,
          lineRange: [1, 1],
          signature: "",
          existingDoc: "doc",
        } as any,
      ],
      classes: [
        {
          name: "C",
          implements: [],
          methods: [],
          properties: [],
          isExported: true,
          lineRange: [1, 1],
          existingDoc: "doc",
        } as any,
      ],
    });
    expect(scoreModules([m]).score).toBe(100);
  });

  it("scores 0 when nothing is documented", () => {
    const m = mod({
      functions: [
        {
          name: "f",
          parameters: [],
          isAsync: false,
          isExported: true,
          lineRange: [1, 1],
          signature: "",
        } as any,
      ],
    });
    expect(scoreModules([m]).score).toBe(0);
  });

  it("ignores non-exported symbols", () => {
    const m = mod({
      functions: [
        {
          name: "f",
          parameters: [],
          isAsync: false,
          isExported: false,
          lineRange: [1, 1],
          signature: "",
        } as any,
      ],
    });
    // no exportable symbols -> vacuously fully documented
    expect(scoreModules([m]).score).toBe(100);
  });

  it("counts undocumented methods against the class", () => {
    const m = mod({
      classes: [
        {
          name: "C",
          implements: [],
          isExported: true,
          lineRange: [1, 5],
          existingDoc: "doc",
          properties: [],
          methods: [
            {
              name: "a",
              parameters: [],
              isAsync: false,
              isExported: true,
              lineRange: [1, 1],
              signature: "",
              visibility: "public",
              isStatic: false,
            },
            {
              name: "b",
              parameters: [],
              isAsync: false,
              isExported: true,
              lineRange: [2, 2],
              signature: "",
              visibility: "public",
              isStatic: false,
              existingDoc: "doc",
            },
          ],
        } as any,
      ],
    });
    // Class documented + 1 of 2 methods documented = 2 of 3 symbols -> 67
    expect(scoreModules([m]).score).toBe(67);
  });

  it("ignores private methods because they are not public documentation surface", () => {
    const m = mod({
      classes: [
        {
          name: "C",
          implements: [],
          isExported: true,
          lineRange: [1, 5],
          existingDoc: "doc",
          properties: [],
          methods: [
            {
              name: "helper",
              parameters: [],
              isAsync: false,
              isExported: true,
              lineRange: [2, 2],
              signature: "",
              visibility: "private",
              isStatic: false,
            },
          ],
        } as any,
      ],
    });
    expect(scoreModules([m]).score).toBe(100);
  });

  it("flags stub docs as low-quality", () => {
    const m = mod({
      functions: [
        {
          name: "f",
          parameters: [],
          isAsync: false,
          isExported: true,
          lineRange: [1, 1],
          signature: "",
          existingDoc: "TODO",
        } as any,
      ],
    });
    const result = scoreModules([m]);
    expect(result.score).toBe(100); // presence-based score unaffected
    expect(result.lowQualityCount).toBe(1);
  });
});

describe("bucket", () => {
  it("returns the right band", () => {
    expect(bucket(0)).toBe("poor");
    expect(bucket(39)).toBe("poor");
    expect(bucket(40)).toBe("fair");
    expect(bucket(69)).toBe("fair");
    expect(bucket(70)).toBe("good");
    expect(bucket(100)).toBe("good");
  });
});
