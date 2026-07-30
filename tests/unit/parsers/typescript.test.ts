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
});
