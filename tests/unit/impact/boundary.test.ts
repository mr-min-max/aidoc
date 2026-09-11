import {
  diffBoundaries,
  resolveBoundary,
  resolvePythonBoundary,
} from "../../../src/impact/boundary";
import { PythonParser } from "../../../src/parsers/python";
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
  it("diffs exposed and hidden names only for resolved boundaries", () => {
    const report = {
      mode: "entry" as const,
      entries: ["src/index.ts"],
      filesRead: 2,
    };
    const base = {
      report,
      reachable: new Map([["src/api.ts", new Set(["kept", "hidden"])]]),
    };
    const head = {
      report,
      reachable: new Map([["src/api.ts", new Set(["kept", "exposed"])]]),
    };

    expect(diffBoundaries(base, head)).toEqual([
      { path: "src/api.ts", localName: "exposed", kind: "exposed" },
      { path: "src/api.ts", localName: "hidden", kind: "hidden" },
    ]);
    expect(
      diffBoundaries(
        {
          ...base,
          report: {
            mode: "fallback",
            entries: [],
            reason: "no-manifest",
            filesRead: 0,
          },
        },
        head,
      ),
    ).toEqual([]);
  });

  it("resolves Python __all__, relative imports, star imports, and private paths", async () => {
    const pythonParser = new PythonParser();
    const files = {
      "pyproject.toml": '[project]\nname = "pkg"\n',
      "pkg/__init__.py":
        'from .core import run, helper\nfrom .sub import *\nfrom ._internal import leaked\n__all__ = ["run", "subapi"]\n',
      "pkg/core.py": "def run():\n    pass\n\ndef helper():\n    pass\n",
      "pkg/_internal.py": "def leaked():\n    pass\n",
      "pkg/sub/__init__.py": "from .api import subapi\n",
      "pkg/sub/api.py": "def subapi():\n    pass\n",
    };
    const result = await resolvePythonBoundary({
      readFile: async (path) => files[path as keyof typeof files],
      listPackageEntries: async () => ["pkg/__init__.py"],
      snapshot: async (path, source) => pythonParser.snapshot(path, source),
    });

    expect(result.report).toMatchObject({
      mode: "entry",
      entries: ["pkg/__init__.py"],
    });
    expect([...result.reachable.get("pkg/core.py")!]).toEqual(["run"]);
    expect([...result.reachable.get("pkg/sub/api.py")!]).toEqual(["subapi"]);
    expect(result.reachable.has("pkg/_internal.py")).toBe(false);
  });
  it("does not expose unselected names from a reached subpackage initializer", async () => {
    const pythonParser = new PythonParser();
    const files = {
      "pyproject.toml": '[project]\nname = "pkg"\n',
      "pkg/__init__.py": 'from .sub import selected\n__all__ = ["selected"]\n',
      "pkg/sub/__init__.py": "from .api import selected, unrelated\n",
      "pkg/sub/api.py":
        "def selected():\n    pass\n\ndef unrelated():\n    pass\n",
    };
    const result = await resolvePythonBoundary({
      readFile: async (path) => files[path as keyof typeof files],
      listPackageEntries: async () => ["pkg/__init__.py"],
      snapshot: async (path, source) => pythonParser.snapshot(path, source),
    });

    expect([...result.reachable.get("pkg/sub/api.py")!]).toEqual(["selected"]);
  });
  it("keeps star-imported names internal when __all__ omits them", async () => {
    const pythonParser = new PythonParser();
    const files = {
      "pyproject.toml": '[project]\nname = "pkg"\n',
      "pkg/__init__.py":
        'from .extra import *\n\ndef run():\n    pass\n\n__all__ = ["run"]\n',
      "pkg/extra.py": "def leaked():\n    pass\n\ndef other():\n    pass\n",
    };
    const result = await resolvePythonBoundary({
      readFile: async (path) => files[path as keyof typeof files],
      listPackageEntries: async () => ["pkg/__init__.py"],
      snapshot: async (path, source) => pythonParser.snapshot(path, source),
    });

    expect([...result.reachable.get("pkg/__init__.py")!]).toEqual(["run"]);
    expect(result.reachable.has("pkg/extra.py")).toBe(false);
  });

  it("limits Python TOML discovery to configured package roots", async () => {
    const pythonParser = new PythonParser();
    const files = {
      "pyproject.toml":
        '[project]\nname = "distribution"\n[tool.setuptools.packages.find]\nwhere = "python"\n',
      "python/distribution/__init__.py": "def api():\n    pass\n",
      "other/__init__.py": "def unrelated():\n    pass\n",
    };
    const result = await resolvePythonBoundary({
      readFile: async (path) => files[path as keyof typeof files],
      listPackageEntries: async () => [
        "other/__init__.py",
        "python/distribution/__init__.py",
      ],
      snapshot: async (path, source) => pythonParser.snapshot(path, source),
    });

    expect(result.report).toMatchObject({
      mode: "entry",
      entries: ["python/distribution/__init__.py"],
    });
  });

  it("resolves bounded Poetry package include and from metadata", async () => {
    const pythonParser = new PythonParser();
    const files = {
      "pyproject.toml":
        '[tool.poetry]\npackages = [{ include = "pkg", from = "python" }]\n',
      "python/pkg/__init__.py": "def api():\n    pass\n",
      "pkg/__init__.py": "def wrong():\n    pass\n",
    };
    const listed: string[] = [];
    const result = await resolvePythonBoundary({
      readFile: async (path) => files[path as keyof typeof files],
      listPackageEntries: async () => listed,
      snapshot: async (path, source) => pythonParser.snapshot(path, source),
    });
    expect(listed).toEqual([]);
    expect(result.report).toMatchObject({
      mode: "entry",
      entries: ["python/pkg/__init__.py"],
    });
  });
});
