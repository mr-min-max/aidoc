import { resolveBoundary } from "../../../src/impact/boundary";
import { TypeScriptParser } from "../../../src/parsers/typescript";

const parser = new TypeScriptParser();

function boundaryInput(
  files: Record<string, string>,
  configuredEntries?: string[],
) {
  return resolveBoundary({
    readFile: async (path) => files[path],
    listPackageJson: async () =>
      Object.keys(files).filter((path) => path.endsWith("package.json")),
    snapshot: async (path, source) => parser.snapshot(path, source),
    ...(configuredEntries === undefined ? {} : { configuredEntries }),
  });
}

describe("public boundary resolution", () => {
  it("discovers build-mapped workspace entries and follows static reexports", async () => {
    const result = await boundaryInput({
      "package.json": JSON.stringify({
        exports: { ".": { types: "./dist/index.d.ts" } },
        workspaces: ["modules/*"],
      }),
      "src/index.ts":
        'export * from "./core/a.js"; export { beta as shown } from "./core/b"; export * as ns from "./namespace";',
      "src/core/a.ts": "export const alpha = 1; export default 2;",
      "src/core/b.ts": "export const beta = 2; export const hidden = 3;",
      "src/namespace.ts": "export const nested = 4;",
      "modules/extra/package.json": JSON.stringify({ main: "lib/index.js" }),
      "modules/extra/src/index.ts": 'export { extra } from "./extra";',
      "modules/extra/src/extra.ts": "export const extra = 5;",
    });

    expect(result.report).toMatchObject({
      mode: "entry",
      entries: ["modules/extra/src/index.ts", "src/index.ts"],
    });
    expect([...result.reachable.get("src/core/a.ts")!].sort()).toEqual([
      "alpha",
    ]);
    expect([...result.reachable.get("src/core/b.ts")!]).toEqual(["beta"]);
    expect([...result.reachable.get("src/namespace.ts")!]).toEqual(["nested"]);
    expect([...result.reachable.get("modules/extra/src/extra.ts")!]).toEqual([
      "extra",
    ]);
  });

  it("accepts configured modern module extensions", async () => {
    for (const extension of ["mts", "cts", "mjs", "cjs"]) {
      const path = `src/index.${extension}`;
      const result = await boundaryInput(
        { [path]: "export const visible = true;" },
        [path],
      );
      expect(result.report).toMatchObject({ mode: "entry", entries: [path] });
      expect(result.reachable.get(path)?.has("visible")).toBe(true);
    }
  });

  it.each([
    [{}, "no-manifest"],
    [{ "package.json": JSON.stringify({ name: "lib" }) }, "no-entry-field"],
    [
      { "package.json": JSON.stringify({ main: "dist/missing.js" }) },
      "entry-not-found",
    ],
    [
      { "package.json": JSON.stringify({ exports: { browser: 42 } }) },
      "unsupported-entry",
    ],
  ] as const)(
    "falls back loudly for unresolved metadata",
    async (files, reason) => {
      const result = await boundaryInput(files);
      expect(result.report).toMatchObject({ mode: "fallback", reason });
      expect(result.reachable.size).toBe(0);
    },
  );

  it("falls back when the file or depth bound is exceeded", async () => {
    const files = {
      "package.json": JSON.stringify({ main: "src/index.ts" }),
      "src/index.ts": 'export * from "./one";',
      "src/one.ts": 'export * from "./two";',
      "src/two.ts": "export const two = 2;",
    };
    const fileLimited = await resolveBoundary({
      readFile: async (path) => files[path as keyof typeof files],
      listPackageJson: async () => ["package.json"],
      snapshot: async (path, source) => parser.snapshot(path, source),
      limits: { maxFiles: 2, maxDepth: 12 },
    });
    const depthLimited = await resolveBoundary({
      readFile: async (path) => files[path as keyof typeof files],
      listPackageJson: async () => ["package.json"],
      snapshot: async (path, source) => parser.snapshot(path, source),
      limits: { maxFiles: 20, maxDepth: 1 },
    });

    expect(fileLimited.report).toMatchObject({
      mode: "fallback",
      reason: "limit-exceeded",
      filesRead: 2,
    });
    expect(depthLimited.report).toMatchObject({
      mode: "fallback",
      reason: "limit-exceeded",
    });
  });
});
