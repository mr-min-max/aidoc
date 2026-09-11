import { TypeScriptParser } from "../../../src/parsers/typescript";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("TypeScriptParser", () => {
  const parser = new TypeScriptParser();
  const fixturePath = path.resolve(__dirname, "../../fixtures/sample.ts");

  it("should parse a TypeScript file", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.filePath).toBe(fixturePath);
    expect(result.language).toBe("typescript");
  });

  it("parses captured TypeScript source without reopening its backing path", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "staledocs-typescript-captured-"),
    );
    const backingPath = path.join(root, "captured.ts");
    const source = `
      import { EventEmitter } from "events";
      export interface Api { id: string; }
      export type Result = string;
      export enum Mode { Ready = "ready" }
      /** Captured request docs */
      export function request(value: string): number { return value.length; }
      export class Service {
        run(value: string): number { return value.length; }
      }
    `;
    fs.writeFileSync(backingPath, source);

    try {
      const expected = await parser.parse(backingPath);
      fs.writeFileSync(
        backingPath,
        `export function unrelated(): string { return "backing-path"; }`,
      );
      fs.rmSync(backingPath);

      await expect(parser.parseSource!(backingPath, source)).resolves.toEqual(
        expected,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("should extract exported functions", async () => {
    const result = await parser.parse(fixturePath);
    const funcNames = result.functions.map((f) => f.name);
    expect(funcNames).toContain("greetUser");
    expect(funcNames).toContain("fetchData");
    // internalHelper is NOT exported
    expect(funcNames).not.toContain("internalHelper");
  });

  it("should extract function parameters and return types", async () => {
    const result = await parser.parse(fixturePath);
    const greet = result.functions.find((f) => f.name === "greetUser");
    expect(greet).toBeDefined();
    expect(greet!.parameters.length).toBe(1);
    expect(greet!.parameters[0].name).toBe("user");
    expect(greet!.returnType).toBe("string");
    expect(greet!.isAsync).toBe(false);
  });

  it("should detect async functions", async () => {
    const result = await parser.parse(fixturePath);
    const fetchData = result.functions.find((f) => f.name === "fetchData");
    expect(fetchData).toBeDefined();
    expect(fetchData!.isAsync).toBe(true);
  });

  it("should extract exported classes", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.classes.length).toBe(1);
    expect(result.classes[0].name).toBe("UserService");
    expect(result.classes[0].methods.length).toBeGreaterThanOrEqual(2);
  });

  it("should extract exported interfaces and types", async () => {
    const result = await parser.parse(fixturePath);
    const typeNames = result.types.map((t) => t.name);
    expect(typeNames).toContain("User");
    expect(typeNames).toContain("ServiceConfig");
  });

  it("should extract existing JSDoc comments", async () => {
    const result = await parser.parse(fixturePath);
    const greet = result.functions.find((f) => f.name === "greetUser");
    expect(greet!.existingDoc).toContain("Creates a greeting message");
  });

  it("should extract imports", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.imports.length).toBeGreaterThanOrEqual(1);
    expect(result.imports[0].source).toBe("events");
  });

  it("should report supported extensions", () => {
    expect(parser.supportedExtensions).toContain(".ts");
    expect(parser.supportedExtensions).toContain(".tsx");
    expect(parser.supportedExtensions).toContain(".js");
    expect(parser.supportedExtensions).toContain(".jsx");
    expect(parser.supportedExtensions).toContain(".mts");
    expect(parser.supportedExtensions).toContain(".cts");
    expect(parser.supportedExtensions).toContain(".mjs");
    expect(parser.supportedExtensions).toContain(".cjs");
  });

  it("detects ESM, CommonJS, and script module systems through the AST", async () => {
    const commonjs = await parser.snapshot(
      "lib/request.js",
      "var req = {}; module.exports = req;",
    );
    const nestedCommonjs = await parser.snapshot(
      "lib/nested.cjs",
      "(() => { Object.defineProperty(module.exports, 'name', { value: true }); })();",
    );
    const propertyCommonjs = await parser.snapshot(
      "lib/property.js",
      "module.exports.request = request; exports.response = response;",
    );
    const esm = await parser.snapshot(
      "src/index.js",
      "export const api = true;",
    );
    const typesOnly = await parser.snapshot(
      "src/types.ts",
      "export interface Client { id: string; }",
    );
    const script = await parser.snapshot(
      "scripts/build.js",
      "const value = 1;",
    );

    expect(commonjs).toMatchObject({ moduleSystem: "commonjs", symbols: [] });
    expect(nestedCommonjs).toMatchObject({
      moduleSystem: "commonjs",
      symbols: [],
    });
    expect(propertyCommonjs).toMatchObject({
      moduleSystem: "commonjs",
      symbols: [],
    });
    expect(esm.moduleSystem).toBe("esm");
    expect(typesOnly.moduleSystem).toBe("esm");
    expect(script.moduleSystem).toBe("none");
  });

  it("reuses a single Project instance across parses (performance)", async () => {
    // The Project is a module-level singleton: once constructed, it must not
    // be re-created on subsequent parse() calls, no matter how many files.
    await parser.parse(fixturePath);
    const before = TypeScriptParser.sharedProjectCount;
    await parser.parse(fixturePath);
    await parser.parse(fixturePath);
    const after = TypeScriptParser.sharedProjectCount;
    expect(after).toBe(before); // no new Project created on repeat parses
  });

  it("rejects a recovery AST when the source has syntax diagnostics", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "staledocs-typescript-invalid-"),
    );
    const invalidFile = path.join(root, "invalid.ts");
    fs.writeFileSync(
      invalidFile,
      "export function broken(: string { return 'no'; }\n",
    );

    try {
      await expect(parser.parse(invalidFile)).rejects.toThrow(
        /TypeScript syntax error/i,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects captured syntax diagnostics with a fixed value-free message", async () => {
    const sourceSentinel = ["captured", "typescript", "X".repeat(32)].join("-");

    let thrown: unknown;
    try {
      await parser.parseSource!(
        "src/captured.ts",
        `export function broken(${sourceSentinel}: string { return "secret"; }`,
      );
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("TypeScript syntax error.");
    expect((thrown as Error).message).not.toContain(sourceSentinel);
  });

  it("refreshes a cached source before checking syntax diagnostics", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "staledocs-typescript-refresh-"),
    );
    const sourceFile = path.join(root, "changing.ts");
    fs.writeFileSync(
      sourceFile,
      "export function current(): string { return 'ok'; }\n",
    );

    try {
      await expect(parser.parse(sourceFile)).resolves.toMatchObject({
        functions: [{ name: "current" }],
      });
      fs.writeFileSync(
        sourceFile,
        "export function broken(: string { return 'no'; }\n",
      );

      await expect(parser.parse(sourceFile)).rejects.toThrow(
        /TypeScript syntax error/i,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts a genuinely parsed empty TypeScript source file", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "staledocs-typescript-empty-"),
    );
    const emptyFile = path.join(root, "empty.ts");
    fs.writeFileSync(emptyFile, "");

    try {
      await expect(parser.parse(emptyFile)).resolves.toMatchObject({
        filePath: emptyFile,
        language: "typescript",
        functions: [],
        classes: [],
        types: [],
        variables: [],
        imports: [],
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("enumerates modern exported bindings in both parser paths", async () => {
    const fixture = await parser.parse(
      path.resolve(__dirname, "../../fixtures/modern-exports.ts"),
    );
    expect(fixture.functions.map(({ name }) => name).sort()).toEqual([
      "arrow",
      "decl",
      "default",
      "exposed",
      "fnExpr",
    ]);
    expect(fixture.functions).toHaveLength(5);
    const arrow = fixture.functions.find(({ name }) => name === "arrow");
    expect(arrow).toMatchObject({
      lineRange: [5, 5],
      existingDoc: "Fetches a thing.",
      signature: "arrow(id: string): Promise<string>",
    });
    expect(fixture.variables.map(({ name }) => name).sort()).toEqual([
      "CONFIG",
      "VERSION",
      "counter",
    ]);
    expect(fixture.variables).toHaveLength(3);
    const source = await fs.promises.readFile(
      path.resolve(__dirname, "../../fixtures/modern-exports.ts"),
      "utf8",
    );
    const snapshot = await parser.snapshot(
      "tests/fixtures/modern-exports.ts",
      source,
    );
    expect(
      snapshot.symbols.map(
        ({ kind, qualifiedName }) => `${kind}:${qualifiedName}`,
      ),
    ).toEqual([
      "class:Svc",
      "enum:Mode",
      "function:arrow",
      "function:decl",
      "function:default",
      "function:exposed",
      "function:fnExpr",
      "interface:Opts",
      "method:Svc.run",
      "type:Id",
      "variable:CONFIG",
      "variable:VERSION",
      "variable:counter",
    ]);
    expect(
      snapshot.symbols.some(
        ({ qualifiedName }) => qualifiedName === "internal",
      ),
    ).toBe(false);
  });

  it("tracks modern callable and variable contract versus implementation changes", async () => {
    const base = `export const arrow = async (id: string): Promise<string> => id; export const CONFIG = { retries: 3 };`;
    const parameterChanged = await parser.snapshot(
      "src/modern.ts",
      `export const arrow = async (id: string, locale?: string): Promise<string> => id; export const CONFIG = { retries: 3 };`,
    );
    const bodyChanged = await parser.snapshot(
      "src/modern.ts",
      `export const arrow = async (id: string): Promise<string> => id + "!"; export const CONFIG = { retries: 3 };`,
    );
    const configMembersChanged = await parser.snapshot(
      "src/modern.ts",
      `export const arrow = async (id: string): Promise<string> => id; export const CONFIG = { retries: 3, timeout: 1 };`,
    );
    const configValueChanged = await parser.snapshot(
      "src/modern.ts",
      `export const arrow = async (id: string): Promise<string> => id; export const CONFIG = { retries: 4 };`,
    );
    const original = await parser.snapshot("src/modern.ts", base);
    const arrow = (s: typeof original) =>
      s.symbols.find(({ qualifiedName }) => qualifiedName === "arrow");
    const config = (s: typeof original) =>
      s.symbols.find(({ qualifiedName }) => qualifiedName === "CONFIG");
    expect(arrow(parameterChanged)?.contractFacets.parameters).not.toBe(
      arrow(original)?.contractFacets.parameters,
    );
    expect(arrow(parameterChanged)?.contractFingerprint).not.toBe(
      arrow(original)?.contractFingerprint,
    );
    expect(arrow(bodyChanged)?.contractFingerprint).toBe(
      arrow(original)?.contractFingerprint,
    );
    expect(arrow(bodyChanged)?.implementationFingerprint).not.toBe(
      arrow(original)?.implementationFingerprint,
    );
    expect(config(configMembersChanged)?.contractFacets.members).not.toBe(
      config(original)?.contractFacets.members,
    );
    expect(config(configValueChanged)?.contractFacets.members).toBe(
      config(original)?.contractFacets.members,
    );
    expect(config(configValueChanged)?.contractFingerprint).toBe(
      config(original)?.contractFingerprint,
    );
    expect(config(configValueChanged)?.implementationFingerprint).not.toBe(
      config(original)?.implementationFingerprint,
    );
  });

  it("distinguishes named default declarations from anonymous default expressions", async () => {
    const named = await parser.snapshot(
      "src/named.ts",
      "export default function main(argv: string[]): void {}",
    );
    const anonymous = await parser.snapshot(
      "src/anonymous.ts",
      "export default (argv: string[]) => argv.length;",
    );
    const namedLegacy = await parser.parseSource(
      "src/named.ts",
      "export default function main(argv: string[]): void {}",
    );

    expect(
      named.symbols.map(
        ({ kind, qualifiedName }) => `${kind}:${qualifiedName}`,
      ),
    ).toEqual(["function:main"]);
    expect(
      anonymous.symbols.map(
        ({ kind, qualifiedName }) => `${kind}:${qualifiedName}`,
      ),
    ).toEqual(["function:default"]);
    expect(namedLegacy.functions.map(({ name }) => name)).toEqual(["main"]);
  });

  it("keeps callable modifier tuples and variable contracts exact", async () => {
    const snapshot = await parser.snapshot(
      "src/facets.ts",
      `
        export const arrow = async (id: string): Promise<string> => id;
        export const fnExpr = function* (id: string): Generator<string> { yield id; };
        export let mutable = (id: string): string => id;
        export const ORDERED = { z: 1, a: 2 };
        export default 42;
      `,
    );
    const byName = new Map(
      snapshot.symbols.map((symbol) => [symbol.qualifiedName, symbol]),
    );

    expect(byName.get("arrow")?.contractFacets.modifiers).toBe(
      "2aac82c351965e00c7c57e7ea41e523d7cf4bd0814c19a4e320f8c504f7b9238",
    );
    expect(byName.get("fnExpr")?.contractFacets.modifiers).toBe(
      "3f248569452864596f24ea152f415950a574da02cf962784d1bb9f5283dd165a",
    );
    expect(byName.get("mutable")?.contractFacets.modifiers).toBe(
      "b3d5fa1016dc91ea2e4cbeabf353ec5f22bcc0fe9a2c2b8cb0f99c2bf3e81e3a",
    );
    expect(byName.get("default")).toMatchObject({
      kind: "variable",
      contractFacets: { members: null },
    });

    const reordered = await parser.snapshot(
      "src/facets.ts",
      "export const ORDERED = { a: 2, z: 1 };",
    );
    expect(byName.get("ORDERED")?.contractFacets.members).toBe(
      reordered.symbols[0].contractFacets.members,
    );
    const legacyDefault = await parser.parseSource(
      "src/default-value.ts",
      "export default 42;",
    );
    expect(legacyDefault.variables).toEqual([
      {
        name: "default",
        type: undefined,
        declarationKind: "const",
        isExported: true,
        lineRange: [1, 1],
        existingDoc: undefined,
      },
    ]);
  });

  it("does not enumerate declarations resolved from another module", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "staledocs-reexports-"));
    const dependency = path.join(root, "dependency.ts");
    const entry = path.join(root, "entry.ts");
    fs.writeFileSync(
      dependency,
      "export const callable = () => 1; export const VALUE = 1;",
    );
    fs.writeFileSync(
      entry,
      'export { callable, VALUE } from "./dependency"; export * from "./dependency";',
    );

    try {
      await parser.parse(dependency);
      const parsed = await parser.parse(entry);
      expect(parsed.functions).toEqual([]);
      expect(parsed.variables).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("records sorted static relative reexports without bare specifiers", async () => {
    const fixture = path.resolve(__dirname, "../../fixtures/barrel/index.ts");
    const snapshot = await parser.snapshot(
      fixture,
      await fs.promises.readFile(fixture, "utf8"),
    );
    const plain = await parser.snapshot(
      "src/plain.ts",
      "export const plain = true;",
    );

    expect(snapshot.reexports).toEqual([
      { specifier: "./core/a.js" },
      {
        specifier: "./core/b",
        names: [
          { exported: "DefaultThing", local: "default" },
          { exported: "beta", local: "beta" },
          { exported: "renamed", local: "original" },
        ],
      },
      {
        specifier: "./core/b",
        names: [{ exported: "Shape", local: "Shape" }],
      },
      {
        specifier: "./core/b",
        names: [{ exported: "namespace", local: "*" }],
      },
    ]);
    expect(plain.reexports).toEqual([]);
  });

  it("snapshots TSX arrow exports with a parameter contract facet", async () => {
    const source = await fs.promises.readFile(
      path.resolve(__dirname, "../../fixtures/component.tsx"),
      "utf8",
    );
    const snapshot = await parser.snapshot(
      "tests/fixtures/component.tsx",
      source,
    );
    expect(snapshot.symbols).toHaveLength(1);
    expect(snapshot.symbols[0]).toMatchObject({
      kind: "function",
      qualifiedName: "Button",
      contractFacets: { parameters: expect.any(String) },
    });
  });

  it("keeps score totals unchanged when variable documentation changes", async () => {
    const documented = await parser.parseSource(
      "src/score.ts",
      "/** Config docs */ export const CONFIG = { retries: 3 };",
    );
    const undocumented = await parser.parseSource(
      "src/score.ts",
      "export const CONFIG = { retries: 3 };",
    );
    const { scoreModules } = await import("../../../src/core/score");
    expect(scoreModules([documented]).totalSymbols).toBe(
      scoreModules([undocumented]).totalSymbols,
    );
    expect(scoreModules([documented]).documentedSymbols).toBe(
      scoreModules([undocumented]).documentedSymbols,
    );
  });

  // Break caught: snapshot normalization leaks source values or treats formatting as behavior.
  it("keeps formatted snapshots stable and returns hashes instead of source values", async () => {
    const first = await parser.snapshot(
      "src/api.ts",
      `
        /** public docs */
        export function request(value: string = "alpha"): number {
          return value.length + 1;
        }
      `,
    );
    const formatted = await parser.snapshot(
      "src/api.ts",
      `
      export function request(
        value: string = "alpha"
      ): number { return value.length + 1 }
      `,
    );

    expect(formatted.symbols[0].contractFingerprint).toBe(
      first.symbols[0].contractFingerprint,
    );
    expect(formatted.symbols[0].implementationFingerprint).toBe(
      first.symbols[0].implementationFingerprint,
    );
    expect(formatted.symbols[0].documentationFingerprint).not.toBe(
      first.symbols[0].documentationFingerprint,
    );
    expect(first.symbols[0].signature).toBe(
      'request(value?: string = "alpha"): number',
    );
    expect(first.symbols[0].arity).toEqual({ required: 0, total: 1 });
    expect(JSON.stringify(first)).not.toContain("public docs");
  });

  // Break caught: optional trailing separators are mistaken for contract or implementation changes.
  it("ignores formatting-only trailing commas without erasing array holes", async () => {
    const first = await parser.snapshot(
      "src/format.ts",
      `
      export interface Shape { value: string }
      export function format(value: string): unknown {
        return render({ value }, [value], value);
      }
      export function sparse(): unknown[] { return [1, , 2]; }
      `,
    );
    const trailed = await parser.snapshot(
      "src/format.ts",
      `
      export interface Shape { value: string, }
      export function format(value: string,): unknown {
        return render({ value, }, [value,], value,);
      }
      export function sparse(): unknown[] { return [1, , 2,]; }
      `,
    );
    const holeAdded = await parser.snapshot(
      "src/format.ts",
      `
      export interface Shape { value: string }
      export function format(value: string): unknown {
        return render({ value }, [value], value);
      }
      export function sparse(): unknown[] { return [1, , 2, ,]; }
      `,
    );

    expect(trailed.symbols).toEqual(first.symbols);
    expect(
      holeAdded.symbols.find(({ qualifiedName }) => qualifiedName === "sparse")
        ?.implementationFingerprint,
    ).not.toBe(
      first.symbols.find(({ qualifiedName }) => qualifiedName === "sparse")
        ?.implementationFingerprint,
    );
  });

  // Break caught: a declared callable contract mutation is omitted from its matching facet.
  it("fingerprints declared parameter, default, type, and return contract changes", async () => {
    const baseline = await parser.snapshot(
      "src/api.ts",
      `export function request(value: string = "alpha"): number { return 1; }`,
    );
    const parameterChanged = await parser.snapshot(
      "src/api.ts",
      `export function request(value: string = "alpha", retry?: boolean): number { return 1; }`,
    );
    const defaultChanged = await parser.snapshot(
      "src/api.ts",
      `export function request(value: string = "beta"): number { return 1; }`,
    );
    const typeChanged = await parser.snapshot(
      "src/api.ts",
      `export function request(value: number = 1): number { return 1; }`,
    );
    const returnChanged = await parser.snapshot(
      "src/api.ts",
      `export function request(value: string = "alpha"): string { return "one"; }`,
    );
    const original = baseline.symbols[0];

    for (const changed of [parameterChanged, defaultChanged, typeChanged]) {
      expect(changed.symbols[0].contractFingerprint).not.toBe(
        original.contractFingerprint,
      );
      expect(changed.symbols[0].contractFacets.parameters).not.toBe(
        original.contractFacets.parameters,
      );
      expect(changed.symbols[0].contractFacets.return).toBe(
        original.contractFacets.return,
      );
    }
    expect(returnChanged.symbols[0].contractFingerprint).not.toBe(
      original.contractFingerprint,
    );
    expect(returnChanged.symbols[0].contractFacets.return).not.toBe(
      original.contractFacets.return,
    );
    expect(returnChanged.symbols[0].contractFacets.parameters).toBe(
      original.contractFacets.parameters,
    );
  });

  // Break caught: recursive body exclusion erases block-bodied default expressions from the contract.
  it("keeps block-bodied function defaults in parameter and combined contract hashes", async () => {
    const first = await parser.snapshot(
      "src/default.ts",
      `
      export function configure(
        callback = () => { return "default-one"; }
      ): void {}
      `,
    );
    const changed = await parser.snapshot(
      "src/default.ts",
      `
      export function configure(
        callback = () => { return "default-two"; }
      ): void {}
      `,
    );
    const original = first.symbols[0];
    const updated = changed.symbols[0];

    expect(updated.contractFacets.parameters).not.toBe(
      original.contractFacets.parameters,
    );
    expect(updated.contractFingerprint).not.toBe(original.contractFingerprint);
    expect(updated.implementationFingerprint).toBe(
      original.implementationFingerprint,
    );
    expect(original.signature).toContain("default-one");
    expect(updated.signature).toContain("default-two");
  });

  // Break caught: implementation literals or operators contaminate the declared contract.
  it("changes only implementation fingerprints for function body changes", async () => {
    const baseline = await parser.snapshot(
      "src/api.ts",
      `export function calculate(value: number): number { return value + 1; }`,
    );
    const literalChanged = await parser.snapshot(
      "src/api.ts",
      `export function calculate(value: number): number { return value + 2; }`,
    );
    const operatorChanged = await parser.snapshot(
      "src/api.ts",
      `export function calculate(value: number): number { return value * 1; }`,
    );
    const original = baseline.symbols[0];

    for (const changed of [literalChanged, operatorChanged]) {
      expect(changed.symbols[0].contractFingerprint).toBe(
        original.contractFingerprint,
      );
      expect(changed.symbols[0].contractFacets).toEqual(
        original.contractFacets,
      );
      expect(changed.symbols[0].implementationFingerprint).not.toBe(
        original.implementationFingerprint,
      );
      expect(changed.symbols[0].documentationFingerprint).toBe(
        original.documentationFingerprint,
      );
    }
  });

  // Break caught: removing structural for-loop separators creates AST fingerprint collisions.
  it("distinguishes expressions in different for-loop slots", async () => {
    const conditionFirst = await parser.snapshot(
      "src/loops.ts",
      `
      export function run(first: boolean, second: boolean): void {
        for (; first; second) {}
      }
      `,
    );
    const initializerFirst = await parser.snapshot(
      "src/loops.ts",
      `
      export function run(first: boolean, second: boolean): void {
        for (first; second;) {}
      }
      `,
    );

    expect(initializerFirst.symbols[0].contractFingerprint).toBe(
      conditionFirst.symbols[0].contractFingerprint,
    );
    expect(initializerFirst.symbols[0].implementationFingerprint).not.toBe(
      conditionFirst.symbols[0].implementationFingerprint,
    );
  });

  // Break caught: sorting class implementation parts erases initializer and static-block execution order.
  it("preserves execution order for class initializers and static blocks", async () => {
    const first = await parser.snapshot(
      "src/sequence.ts",
      `
      export class Sequence {
        first = record("instance-first");
        second = record("instance-second");
        static { record("static-first"); }
        static { record("static-second"); }
      }
      `,
    );
    const initializersSwapped = await parser.snapshot(
      "src/sequence.ts",
      `
      export class Sequence {
        second = record("instance-second");
        first = record("instance-first");
        static { record("static-first"); }
        static { record("static-second"); }
      }
      `,
    );
    const staticBlocksSwapped = await parser.snapshot(
      "src/sequence.ts",
      `
      export class Sequence {
        first = record("instance-first");
        second = record("instance-second");
        static { record("static-second"); }
        static { record("static-first"); }
      }
      `,
    );
    const original = first.symbols[0];

    for (const changed of [initializersSwapped, staticBlocksSwapped]) {
      expect(changed.symbols[0].contractFingerprint).toBe(
        original.contractFingerprint,
      );
      expect(changed.symbols[0].implementationFingerprint).not.toBe(
        original.implementationFingerprint,
      );
    }
  });

  // Break caught: runtime callable syntax and private defaults are absent from implementation hashes.
  it("hashes body-bearing callable syntax and private defaults as implementation", async () => {
    const baseline = await parser.snapshot(
      "src/runtime.ts",
      `
      export function execute(value: string): unknown;
      export function execute(value: string): unknown { return value; }
      `,
    );
    const asyncImplementation = await parser.snapshot(
      "src/runtime.ts",
      `
      export function execute(value: string): unknown;
      export async function execute(value: string): Promise<unknown> { return value; }
      `,
    );
    const generatorImplementation = await parser.snapshot(
      "src/runtime.ts",
      `
      export function execute(value: string): unknown;
      export function* execute(value: string): Generator<unknown> { return value; }
      `,
    );
    const restImplementation = await parser.snapshot(
      "src/runtime.ts",
      `
      export function execute(value: string): unknown;
      export function execute(...[value]: [string]): unknown { return value; }
      `,
    );
    const destructuredImplementation = await parser.snapshot(
      "src/runtime.ts",
      `
      export function execute(value: string): unknown;
      export function execute([value]: [string]): unknown { return value; }
      `,
    );
    const original = baseline.symbols[0];

    for (const changed of [
      asyncImplementation,
      generatorImplementation,
      restImplementation,
      destructuredImplementation,
    ]) {
      expect(changed.symbols[0].contractFingerprint).toBe(
        original.contractFingerprint,
      );
      expect(changed.symbols[0].implementationFingerprint).not.toBe(
        original.implementationFingerprint,
      );
    }

    const privateDefault = await parser.snapshot(
      "src/private.ts",
      `
      export class Worker {
        private work(value = "private-default-one"): string { return value; }
      }
      `,
    );
    const privateDefaultChanged = await parser.snapshot(
      "src/private.ts",
      `
      export class Worker {
        private work(value = "private-default-two"): string { return value; }
      }
      `,
    );

    expect(privateDefaultChanged.symbols[0].contractFingerprint).toBe(
      privateDefault.symbols[0].contractFingerprint,
    );
    expect(privateDefaultChanged.symbols[0].implementationFingerprint).not.toBe(
      privateDefault.symbols[0].implementationFingerprint,
    );
    expect(JSON.stringify(privateDefault)).not.toContain("private-default-one");
    expect(JSON.stringify(privateDefaultChanged)).not.toContain(
      "private-default-two",
    );
  });

  // Break caught: hidden decorators and accessor staticness are omitted from runtime shape.
  it("hashes hidden decorators and accessor staticness as implementation", async () => {
    const baseline = await parser.snapshot(
      "src/hidden-runtime.ts",
      `
      declare const firstMethodDecorator: any;
      declare const secondMethodDecorator: any;
      declare const firstAccessorDecorator: any;
      declare const secondAccessorDecorator: any;
      export class Worker {
        @firstMethodDecorator
        private work(value: string): string { return value; }

        @firstAccessorDecorator
        private get secret(): string { return "secret"; }
      }
      `,
    );
    const methodDecoratorChanged = await parser.snapshot(
      "src/hidden-runtime.ts",
      `
      declare const firstMethodDecorator: any;
      declare const secondMethodDecorator: any;
      declare const firstAccessorDecorator: any;
      declare const secondAccessorDecorator: any;
      export class Worker {
        @secondMethodDecorator
        private work(value: string): string { return value; }

        @firstAccessorDecorator
        private get secret(): string { return "secret"; }
      }
      `,
    );
    const accessorDecoratorChanged = await parser.snapshot(
      "src/hidden-runtime.ts",
      `
      declare const firstMethodDecorator: any;
      declare const secondMethodDecorator: any;
      declare const firstAccessorDecorator: any;
      declare const secondAccessorDecorator: any;
      export class Worker {
        @firstMethodDecorator
        private work(value: string): string { return value; }

        @secondAccessorDecorator
        private get secret(): string { return "secret"; }
      }
      `,
    );
    const accessorBecameStatic = await parser.snapshot(
      "src/hidden-runtime.ts",
      `
      declare const firstMethodDecorator: any;
      declare const secondMethodDecorator: any;
      declare const firstAccessorDecorator: any;
      declare const secondAccessorDecorator: any;
      export class Worker {
        @firstMethodDecorator
        private work(value: string): string { return value; }

        @firstAccessorDecorator
        private static get secret(): string { return "secret"; }
      }
      `,
    );
    const original = baseline.symbols[0];

    for (const changed of [
      methodDecoratorChanged,
      accessorDecoratorChanged,
      accessorBecameStatic,
    ]) {
      expect(changed.symbols[0].contractFingerprint).toBe(
        original.contractFingerprint,
      );
      expect(changed.symbols[0].implementationFingerprint).not.toBe(
        original.implementationFingerprint,
      );
    }
  });

  // Break caught: trivia or source positions enter contract, implementation, or dependency hashes.
  it("ignores comments and line movement outside documentation fingerprints", async () => {
    const first = await parser.snapshot(
      "src/api.ts",
      `
      // first ordinary comment
      export function request(value: string): string {
        return value;
      }
      `,
    );
    const moved = await parser.snapshot(
      "src/api.ts",
      `


      export function request(value: string): string { /* moved comment */

        return value
      }
      `,
    );

    expect(moved.symbols[0].contractFingerprint).toBe(
      first.symbols[0].contractFingerprint,
    );
    expect(moved.symbols[0].implementationFingerprint).toBe(
      first.symbols[0].implementationFingerprint,
    );
    expect(moved.dependencyFingerprint).toBe(first.dependencyFingerprint);
  });

  // Break caught: ordinary leading documentation comments are discarded or affect non-doc hashes.
  it("hashes leading comment documentation only as documentation", async () => {
    const first = await parser.snapshot(
      "src/api.ts",
      `
      // public request docs
      export function request(): void {}
      `,
    );
    const changed = await parser.snapshot(
      "src/api.ts",
      `
      // revised request docs
      export function request(): void {}
      `,
    );

    expect(first.symbols[0].documentationFingerprint).not.toBeNull();
    expect(changed.symbols[0].documentationFingerprint).not.toBe(
      first.symbols[0].documentationFingerprint,
    );
    expect(changed.symbols[0].contractFingerprint).toBe(
      first.symbols[0].contractFingerprint,
    );
    expect(changed.symbols[0].implementationFingerprint).toBe(
      first.symbols[0].implementationFingerprint,
    );
    expect(JSON.stringify(first)).not.toContain("public request docs");
    expect(JSON.stringify(changed)).not.toContain("revised request docs");
  });

  // Break caught: public member docs never reach their owning class, interface, or enum snapshot.
  it("aggregates public member documentation into owning declaration hashes", async () => {
    const first = await parser.snapshot(
      "src/member-docs.ts",
      `
      export class Service {
        /** property-doc-one */
        value: string;
        /** constructor-doc-one */
        constructor() {}
        /** accessor-doc-one */
        get status(): string { return this.value; }
      }
      export interface Config {
        /** interface-property-doc-one */
        enabled: boolean;
      }
      export enum Mode {
        /** enum-member-doc-one */
        Active = "active"
      }
      `,
    );
    const changed = await parser.snapshot(
      "src/member-docs.ts",
      `
      export class Service {
        /** property-doc-two */
        value: string;
        /** constructor-doc-two */
        constructor() {}
        /** accessor-doc-two */
        get status(): string { return this.value; }
      }
      export interface Config {
        /** interface-property-doc-two */
        enabled: boolean;
      }
      export enum Mode {
        /** enum-member-doc-two */
        Active = "active"
      }
      `,
    );

    for (const qualifiedName of ["Service", "Config", "Mode"]) {
      const original = first.symbols.find(
        (symbol) => symbol.qualifiedName === qualifiedName,
      );
      const updated = changed.symbols.find(
        (symbol) => symbol.qualifiedName === qualifiedName,
      );
      expect(updated?.contractFingerprint).toBe(original?.contractFingerprint);
      expect(updated?.implementationFingerprint).toBe(
        original?.implementationFingerprint,
      );
      expect(original?.documentationFingerprint).not.toBeNull();
      expect(updated?.documentationFingerprint).not.toBe(
        original?.documentationFingerprint,
      );
    }
    for (const documentation of [
      "property-doc-one",
      "constructor-doc-one",
      "accessor-doc-one",
      "interface-property-doc-one",
      "enum-member-doc-one",
      "property-doc-two",
      "constructor-doc-two",
      "accessor-doc-two",
      "interface-property-doc-two",
      "enum-member-doc-two",
    ]) {
      expect(JSON.stringify(first)).not.toContain(documentation);
      expect(JSON.stringify(changed)).not.toContain(documentation);
    }
  });

  // Break caught: module specifier values leak into symbols or fail to affect dependency identity.
  it("isolates import module specifier changes to the dependency fingerprint", async () => {
    const first = await parser.snapshot(
      "src/api.ts",
      `
      import { dependency } from "./first";
      export function request(): number { return dependency(); }
      `,
    );
    const changed = await parser.snapshot(
      "src/api.ts",
      `
      import { dependency } from "./second";
      export function request(): number { return dependency(); }
      `,
    );

    expect(changed.dependencyFingerprint).not.toBe(first.dependencyFingerprint);
    expect(changed.symbols).toEqual(first.symbols);
    expect(JSON.stringify(first)).not.toContain("./first");
    expect(JSON.stringify(changed)).not.toContain("./second");
  });

  // Break caught: non-public class methods become public symbols or lose class qualification.
  it("emits qualified public methods and omits private, protected, and private-identifier members", async () => {
    const snapshot = await parser.snapshot(
      "src/vault.ts",
      `
      export class Vault {
        open(): string { return "open"; }
        private hidden(): string { return "hidden"; }
        protected guarded(): string { return "guarded"; }
        #secret(): string { return "secret"; }
      }
      `,
    );

    expect(
      snapshot.symbols.map(({ kind, qualifiedName }) => ({
        kind,
        qualifiedName,
      })),
    ).toEqual([
      { kind: "class", qualifiedName: "Vault" },
      { kind: "method", qualifiedName: "Vault.open" },
    ]);
  });

  // Break caught: literal or computed method source text leaks through qualified identities.
  it("uses value-free stable identities for literal and computed method names", async () => {
    const first = await parser.snapshot(
      "src/computed.ts",
      `
      const secretKey = "top-secret-key";
      export class Vault {
        ["secret-literal"](): void {}
        "quoted-secret"(): void {}
        [secretKey + "class-suffix"](): void {}
      }
      export interface Vault {
        ["secret-literal"](): void;
        "quoted-secret"(): void;
        [secretKey + "class-suffix"](): void;
      }
      `,
    );
    const formatted = await parser.snapshot(
      "src/computed.ts",
      `
      const secretKey = "top-secret-key";
      export class Vault {
        [ 'secret\\x2dliteral' ] ( ): void { }
        'quoted\\x2dsecret' ( ): void { }
        [ secretKey + 'class\\x2dsuffix' ] ( ): void { }
      }
      export interface Vault {
        [ 'secret\\x2dliteral' ] ( ): void;
        'quoted\\x2dsecret' ( ): void;
        [ secretKey + 'class\\x2dsuffix' ] ( ): void;
      }
      `,
    );
    const methodNames = first.symbols
      .filter(({ kind }) => kind === "method")
      .map(({ qualifiedName }) => qualifiedName);
    const formattedNames = formatted.symbols
      .filter(({ kind }) => kind === "method")
      .map(({ qualifiedName }) => qualifiedName);

    expect(methodNames).toHaveLength(3);
    expect(new Set(methodNames)).toHaveProperty("size", 3);
    expect(methodNames).toEqual(formattedNames);
    expect(formatted.symbols).toEqual(first.symbols);
    for (const qualifiedName of methodNames) {
      expect(qualifiedName).toMatch(/^Vault\.\[computed:[0-9a-f]{64}\]$/);
    }
    for (const sourceValue of [
      "secret-literal",
      "quoted-secret",
      "top-secret-key",
      "secretKey",
      "class-suffix",
    ]) {
      expect(JSON.stringify(first)).not.toContain(sourceValue);
    }
  });

  // Break caught: equivalent numeric spellings create different hashed method identities.
  it("uses semantic identities for numeric method names", async () => {
    const first = await parser.snapshot(
      "src/numeric-methods.ts",
      `
      export class NumericMethods {
        1(): void {}
        [0x10](): void {}
      }
      `,
    );
    const equivalent = await parser.snapshot(
      "src/numeric-methods.ts",
      `
      export class NumericMethods {
        1.0(): void {}
        [16](): void {}
      }
      `,
    );

    expect(equivalent.symbols).toEqual(first.symbols);
  });

  // Break caught: an exported declaration kind is silently excluded from the snapshot boundary.
  it("emits exported interfaces, types, enums, and classes", async () => {
    const snapshot = await parser.snapshot(
      "src/contracts.ts",
      `
      export interface Api { value: string; }
      export type Result = string | number;
      export enum Mode { Fast = "fast", Safe = "safe" }
      export class Service {}
      `,
    );

    expect(
      snapshot.symbols.map(({ kind, qualifiedName }) => ({
        kind,
        qualifiedName,
      })),
    ).toEqual([
      { kind: "class", qualifiedName: "Service" },
      { kind: "enum", qualifiedName: "Mode" },
      { kind: "interface", qualifiedName: "Api" },
      { kind: "type", qualifiedName: "Result" },
    ]);
    const byName = new Map(
      snapshot.symbols.map((symbol) => [symbol.qualifiedName, symbol]),
    );
    expect(byName.get("Service")).toMatchObject({ signature: "class Service" });
    expect(byName.get("Service")).not.toHaveProperty("arity");
    expect(byName.get("Api")).toMatchObject({ signature: "interface Api" });
    expect(byName.get("Result")).toMatchObject({
      signature: "type Result = string | number",
    });
    expect(byName.get("Mode")).toMatchObject({
      signature: "enum Mode { Fast, Safe }",
    });
  });

  // Break caught: inheritance, public member shape, or modifier syntax is missing from its facet.
  it("tracks inheritance, public members, and modifiers as separate contract facets", async () => {
    const baseline = await parser.snapshot(
      "src/service.ts",
      `export class Service extends Base { value: string; }`,
    );
    const inheritanceChanged = await parser.snapshot(
      "src/service.ts",
      `export class Service extends OtherBase { value: string; }`,
    );
    const memberChanged = await parser.snapshot(
      "src/service.ts",
      `export class Service extends Base { value: number; }`,
    );
    const modifierChanged = await parser.snapshot(
      "src/service.ts",
      `export abstract class Service extends Base { value: string; }`,
    );
    const original = baseline.symbols[0];

    expect(inheritanceChanged.symbols[0].contractFacets.inheritance).not.toBe(
      original.contractFacets.inheritance,
    );
    expect(memberChanged.symbols[0].contractFacets.members).not.toBe(
      original.contractFacets.members,
    );
    expect(modifierChanged.symbols[0].contractFacets.modifiers).not.toBe(
      original.contractFacets.modifiers,
    );
    for (const changed of [
      inheritanceChanged,
      memberChanged,
      modifierChanged,
    ]) {
      expect(changed.symbols[0].contractFingerprint).not.toBe(
        original.contractFingerprint,
      );
    }
  });

  // Break caught: overload declarations create duplicate symbols or depend on source order.
  it("groups and sorts overload declarations into one stable symbol", async () => {
    const first = await parser.snapshot(
      "src/convert.ts",
      `
      export function convert(value: string): string;
      export function convert(value: number): number;
      export function convert(value: string | number): string | number {
        return value;
      }
      `,
    );
    const reordered = await parser.snapshot(
      "src/convert.ts",
      `
      export function convert(value: number): number;
      export function convert(value: string): string;
      export function convert(value: string | number): string | number {
        return value;
      }
      `,
    );

    expect(first.symbols).toHaveLength(1);
    expect(reordered.symbols).toHaveLength(1);
    expect(first.symbols[0].qualifiedName).toBe("convert");
    expect(reordered.symbols[0].contractFingerprint).toBe(
      first.symbols[0].contractFingerprint,
    );
    expect(reordered.symbols[0].contractFacets).toEqual(
      first.symbols[0].contractFacets,
    );
    expect(first.symbols[0].signature).toBe(
      "convert(value: string): string | convert(value: number): number",
    );
    expect(reordered.symbols[0].signature).toBe(
      "convert(value: number): number | convert(value: string): string",
    );
    expect(first.symbols[0].arity).toEqual({ required: 1, total: 1 });
  });

  // Break caught: executable defaults hidden by public overloads disappear from every fingerprint.
  it("tracks overload implementation defaults as implementation-only", async () => {
    const first = await parser.snapshot(
      "src/overloads.ts",
      `
      export function greet(name?: string): string;
      export function greet(name: string = "Alice"): string { return name; }
      export class Service {
        constructor(name?: string);
        constructor(name: string = "Alice") {}
        greet(name?: string): string;
        greet(name: string = "Alice"): string { return name; }
      }
      `,
    );
    const changed = await parser.snapshot(
      "src/overloads.ts",
      `
      export function greet(name?: string): string;
      export function greet(name: string = "Bob"): string { return name; }
      export class Service {
        constructor(name?: string);
        constructor(name: string = "Bob") {}
        greet(name?: string): string;
        greet(name: string = "Bob"): string { return name; }
      }
      `,
    );

    for (const qualifiedName of ["greet", "Service", "Service.greet"]) {
      const original = first.symbols.find(
        (symbol) => symbol.qualifiedName === qualifiedName,
      );
      const updated = changed.symbols.find(
        (symbol) => symbol.qualifiedName === qualifiedName,
      );
      expect(updated?.contractFingerprint).toBe(original?.contractFingerprint);
      expect(updated?.implementationFingerprint).not.toBe(
        original?.implementationFingerprint,
      );
    }
  });

  // Break caught: interface methods cannot receive the stable qualified method identity.
  it("emits grouped interface methods with their own documentation fingerprint", async () => {
    const first = await parser.snapshot(
      "src/provider.ts",
      `
      export interface LLMProvider {
        /** generates provider output */
        generate(input: string): Promise<string>;
        generate(input: Uint8Array): Promise<string>;
      }
      `,
    );
    const reordered = await parser.snapshot(
      "src/provider.ts",
      `
      export interface LLMProvider {
        generate(input: Uint8Array): Promise<string>;
        /** generates provider output */
        generate(input: string): Promise<string>;
      }
      `,
    );
    const methods = first.symbols.filter(({ kind }) => kind === "method");
    const method = methods[0];
    const reorderedMethod = reordered.symbols.find(
      ({ qualifiedName }) => qualifiedName === "LLMProvider.generate",
    );

    expect(methods).toHaveLength(1);
    expect(method.qualifiedName).toBe("LLMProvider.generate");
    expect(method.documentationFingerprint).not.toBeNull();
    expect(reorderedMethod?.contractFingerprint).toBe(
      method.contractFingerprint,
    );
    expect(reorderedMethod?.documentationFingerprint).toBe(
      method.documentationFingerprint,
    );
    expect(JSON.stringify(first)).not.toContain("generates provider output");
  });

  // Break caught: mergeable declarations emit duplicate stable identities or depend on declaration order.
  it("groups and sorts merged interfaces and enums into single symbols", async () => {
    const first = await parser.snapshot(
      "src/merged.ts",
      `
      export interface Api { first: string; }
      export enum Mode { First = "first" }
      export interface Api { second: number; }
      export enum Mode { Second = "second" }
      `,
    );
    const reordered = await parser.snapshot(
      "src/merged.ts",
      `
      export enum Mode { Second = "second" }
      export interface Api { second: number; }
      export enum Mode { First = "first" }
      export interface Api { first: string; }
      `,
    );

    expect(first.symbols).toHaveLength(2);
    expect(first.symbols.map(({ qualifiedName }) => qualifiedName)).toEqual([
      "Mode",
      "Api",
    ]);
    expect(reordered.symbols).toEqual(first.symbols);
    expect(reordered.symbols.map(({ signature }) => signature)).toEqual(
      first.symbols.map(({ signature }) => signature),
    );
  });

  it("renders generic callable, class, interface, and variable signatures", async () => {
    const snapshot = await parser.snapshot(
      "src/signatures.ts",
      `export async function request<T>(value: T, count?: number = 1, ...rest: T[]): Promise<T> { return value; }
export class Service<T> extends Base<T> implements Api<T>, Disposable {}
export interface Options<T> extends BaseOptions<T>, Shared {}
export const CONFIG: Readonly<{ retries: number }> = { retries: 3 };
export const SHAPE = { beta: 2, alpha: 1 };
export const VALUE = compute();`,
    );
    const byName = new Map(
      snapshot.symbols.map((symbol) => [symbol.qualifiedName, symbol]),
    );

    expect(byName.get("request")).toMatchObject({
      signature:
        "async request<T>(value: T, count?: number = 1, ...rest: T[]): Promise<T>",
      arity: { required: 1, total: 3 },
    });
    expect(byName.get("Service")).toMatchObject({
      signature:
        "class Service<T> extends Base<T> implements Api<T>, Disposable",
    });
    expect(byName.get("Options")).toMatchObject({
      signature: "interface Options<T> extends BaseOptions<T>, Shared",
    });
    expect(byName.get("CONFIG")).toMatchObject({
      signature: "const CONFIG: Readonly<{ retries: number }>",
    });
    expect(byName.get("SHAPE")).toMatchObject({
      signature: "const SHAPE = { beta, alpha }",
    });
    expect(byName.get("VALUE")).toMatchObject({
      signature: "const VALUE = ...",
    });
  });

  it("caps TypeScript callable signatures at 400 characters with an ellipsis", async () => {
    const snapshot = await parser.snapshot(
      "src/long.ts",
      `export function request(value: "${"x".repeat(500)}"): void {}`,
    );

    expect(snapshot.symbols[0].signature).toHaveLength(400);
    expect(snapshot.symbols[0].signature.endsWith("...")).toBe(true);
  });

  it("truncates astral signatures by code point without lone surrogates", async () => {
    const snapshot = await parser.snapshot(
      "src/astral.ts",
      `export function request(value: "${"😀".repeat(500)}"): void {}`,
    );
    const signature = snapshot.symbols[0].signature;

    expect(Array.from(signature)).toHaveLength(400);
    expect(signature.endsWith("...")).toBe(true);
    expect(
      Array.from(signature).some((character) => {
        const codePoint = character.codePointAt(0)!;
        return codePoint >= 0xd800 && codePoint <= 0xdfff;
      }),
    ).toBe(false);
  });

  it("widens inferred primitive returns without exposing body literals", async () => {
    const stringSnapshot = await parser.snapshot(
      "src/string.ts",
      `export function createUser(email: string) { return email; }`,
    );
    const objectSnapshot = await parser.snapshot(
      "src/object.ts",
      `export function value() { return { token: "BODY_ONLY_SECRET" } as const; }`,
    );

    expect(stringSnapshot.symbols[0].signature).toBe(
      "createUser(email: string): string",
    );
    expect(objectSnapshot.symbols[0].signature).toBe("value(): unknown");
    expect(JSON.stringify(objectSnapshot)).not.toContain("BODY_ONLY_SECRET");
  });

  // Break caught: merged-interface hashes encode declaration partition boundaries instead of effective shape.
  it("normalizes equivalent merged interfaces across declaration repartitioning", async () => {
    const combined = await parser.snapshot(
      "src/partition.ts",
      `
      export interface Api<T> extends Base<T> {
        first: string;
        second: number;
      }
      `,
    );
    const partitioned = await parser.snapshot(
      "src/partition.ts",
      `
      export interface Api<T> extends Base<T> {
        first: string;
      }
      export interface Api<T> {
        second: number;
      }
      `,
    );

    expect(partitioned.symbols).toEqual(combined.symbols);
    expect(partitioned.dependencyFingerprint).toBe(
      combined.dependencyFingerprint,
    );
  });

  // Break caught: sorting interface type parameters erases their positional meaning.
  it("preserves multi-parameter generic order in interface contracts", async () => {
    const ordered = await parser.snapshot(
      "src/generic-order.ts",
      `
      export interface Pair<Left, Right> {
        map(value: Left): Right;
      }
      `,
    );
    const reordered = await parser.snapshot(
      "src/generic-order.ts",
      `
      export interface Pair<Right, Left> {
        map(value: Left): Right;
      }
      `,
    );
    const original = ordered.symbols.find(
      ({ kind, qualifiedName }) =>
        kind === "interface" && qualifiedName === "Pair",
    );
    const changed = reordered.symbols.find(
      ({ kind, qualifiedName }) =>
        kind === "interface" && qualifiedName === "Pair",
    );

    expect(changed?.contractFacets.members).not.toBe(
      original?.contractFacets.members,
    );
    expect(changed?.contractFingerprint).not.toBe(
      original?.contractFingerprint,
    );
  });

  // Break caught: individual heritage entries retain their original declaration grouping.
  it("normalizes merged interface heritage across declaration repartitioning", async () => {
    const combined = await parser.snapshot(
      "src/heritage.ts",
      `
      export interface Api extends FirstBase, SecondBase {
        value: string;
      }
      `,
    );
    const partitioned = await parser.snapshot(
      "src/heritage.ts",
      `
      export interface Api extends FirstBase {
        value: string;
      }
      export interface Api extends SecondBase {}
      `,
    );

    expect(partitioned.symbols).toEqual(combined.symbols);
  });

  // Break caught: class/interface merging emits duplicate method identities or drops implementation changes.
  it("combines class and interface methods under one qualified identity", async () => {
    const first = await parser.snapshot(
      "src/service.ts",
      `
      export class Service {
        /** class implementation docs */
        run(value: string): string { return value + "first"; }
      }
      export interface Service {
        /** interface contract docs */
        run(value: string): string;
      }
      `,
    );
    const changed = await parser.snapshot(
      "src/service.ts",
      `
      export class Service {
        /** class implementation docs */
        run(value: string): string { return value + "second"; }
      }
      export interface Service {
        /** interface contract docs */
        run(value: string): string;
      }
      `,
    );
    const methods = first.symbols.filter(
      ({ qualifiedName }) => qualifiedName === "Service.run",
    );
    const updated = changed.symbols.find(
      ({ qualifiedName }) => qualifiedName === "Service.run",
    );

    expect(methods).toHaveLength(1);
    expect(methods[0].documentationFingerprint).not.toBeNull();
    expect(updated?.contractFingerprint).toBe(methods[0].contractFingerprint);
    expect(updated?.implementationFingerprint).not.toBe(
      methods[0].implementationFingerprint,
    );
    expect(JSON.stringify(first)).not.toContain("class implementation docs");
    expect(JSON.stringify(first)).not.toContain("interface contract docs");
  });

  // Break caught: JavaScript type inference is mistaken for a declared API contract.
  it("classifies JavaScript inferred return changes as implementation-only", async () => {
    const first = await parser.snapshot(
      "src/value.js",
      `export function value() { return "internal-only"; }`,
    );
    const changed = await parser.snapshot(
      "src/value.js",
      `export function value() { return "changed-only"; }`,
    );

    expect(changed.symbols[0].contractFingerprint).toBe(
      first.symbols[0].contractFingerprint,
    );
    expect(changed.symbols[0].contractFacets.return).toBeUndefined();
    expect(changed.symbols[0].implementationFingerprint).not.toBe(
      first.symbols[0].implementationFingerprint,
    );
    expect(JSON.stringify(first)).not.toContain("internal-only");
    expect(JSON.stringify(changed)).not.toContain("changed-only");
  });

  // Break caught: JSX-bearing extensions are parsed with the wrong script kind.
  it.each([
    [
      "src/view.tsx",
      `export function View(): unknown { return <div>tsx</div>; }`,
    ],
    ["src/view.jsx", `export function View() { return <div>jsx</div>; }`],
  ])("snapshots JSX syntax in %s", async (filePath, source) => {
    const snapshot = await parser.snapshot(filePath, source);

    expect(snapshot).toMatchObject({
      language: "typescript",
      symbols: [{ kind: "function", qualifiedName: "View" }],
    });
  });

  it.each([
    ["src/view.mts", "export function visible(): string { return 'ok'; }"],
    ["src/view.cts", "export function visible(): string { return 'ok'; }"],
    ["src/view.mjs", "export function visible() { return 'ok'; }"],
    ["src/view.cjs", "export function visible() { return 'ok'; }"],
  ])("snapshots modern module extension %s", async (filePath, source) => {
    const snapshot = await parser.snapshot(filePath, source);
    expect(snapshot.symbols).toEqual([
      expect.objectContaining({ qualifiedName: "visible" }),
    ]);
  });

  // Break caught: recovery ASTs cross the snapshot boundary or expose diagnostic details.
  it("rejects snapshot syntax diagnostics with the fixed safe message", async () => {
    await expect(
      parser.snapshot(
        "src/invalid.ts",
        `export function broken(: string { return "secret"; }`,
      ),
    ).rejects.toThrow(/^TypeScript syntax error\.$/);
  });
});
