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
      path.join(os.tmpdir(), "aidoc-typescript-invalid-"),
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

  it("refreshes a cached source before checking syntax diagnostics", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "aidoc-typescript-refresh-"),
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
      path.join(os.tmpdir(), "aidoc-typescript-empty-"),
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
        imports: [],
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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
    expect(JSON.stringify(first)).not.toContain("alpha");
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
