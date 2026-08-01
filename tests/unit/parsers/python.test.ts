import { PythonParser } from "../../../src/parsers/python";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("PythonParser", () => {
  const parser = new PythonParser();
  const fixturePath = path.resolve(__dirname, "../../fixtures/sample.py");

  it("should parse a Python file", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.filePath).toBe(fixturePath);
    expect(result.language).toBe("python");
  });

  it("should extract exported functions", async () => {
    const result = await parser.parse(fixturePath);
    const funcNames = result.functions.map((f) => f.name);
    expect(funcNames).toContain("greet_user");
    expect(funcNames).toContain("fetch_data");
    // Private functions should not be included
    expect(funcNames).not.toContain("_internal_function");
  });

  it("should extract function parameters and return types", async () => {
    const result = await parser.parse(fixturePath);
    const greet = result.functions.find((f) => f.name === "greet_user");
    expect(greet).toBeDefined();
    expect(greet!.parameters.length).toBe(2);
    expect(greet!.parameters[0].name).toBe("name");
    expect(greet!.parameters[0].type).toBe("str");
    expect(greet!.returnType).toBe("str");
  });

  it("should detect optional parameters", async () => {
    const result = await parser.parse(fixturePath);
    const greet = result.functions.find((f) => f.name === "greet_user");
    expect(greet).toBeDefined();
    // 'greeting' has a default value so should be optional
    const greetingParam = greet!.parameters.find((p) => p.name === "greeting");
    expect(greetingParam).toBeDefined();
    expect(greetingParam!.isOptional).toBe(true);
  });

  it("should detect async functions", async () => {
    const result = await parser.parse(fixturePath);
    const fetchData = result.functions.find((f) => f.name === "fetch_data");
    expect(fetchData).toBeDefined();
    expect(fetchData!.isAsync).toBe(true);
  });

  it("should extract exported classes", async () => {
    const result = await parser.parse(fixturePath);
    const classNames = result.classes.map((c) => c.name);
    expect(classNames).toContain("DataProcessor");
    expect(classNames).toContain("UserService");
  });

  it("should extract class inheritance", async () => {
    const result = await parser.parse(fixturePath);
    const userService = result.classes.find((c) => c.name === "UserService");
    expect(userService).toBeDefined();
    expect(userService!.extends).toBe("DataProcessor");
  });

  it("should extract class methods", async () => {
    const result = await parser.parse(fixturePath);
    const dataProcessor = result.classes.find(
      (c) => c.name === "DataProcessor",
    );
    expect(dataProcessor).toBeDefined();
    expect(dataProcessor!.methods.length).toBeGreaterThanOrEqual(2);
    const methodNames = dataProcessor!.methods.map((m) => m.name);
    expect(methodNames).toContain("__init__");
    expect(methodNames).toContain("process");
  });

  it("should extract existing docstrings", async () => {
    const result = await parser.parse(fixturePath);
    const greet = result.functions.find((f) => f.name === "greet_user");
    expect(greet!.existingDoc).toContain("Creates a greeting message");
  });

  it("should extract imports", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.imports.length).toBeGreaterThanOrEqual(3);
    const sources = result.imports.map((i) => i.source);
    expect(sources).toContain("os");
    expect(sources).toContain("json");
    expect(sources).toContain("typing");
  });

  it("should report supported extensions", () => {
    expect(parser.supportedExtensions).toContain(".py");
  });

  it("should throw on non-existent file", async () => {
    await expect(parser.parse("/nonexistent/file.py")).rejects.toThrow(
      "File not found",
    );
  });

  it("throws a parser-unavailable error when the Python process cannot start", async () => {
    const unavailable = Object.assign(new Error("spawn python3 ENOENT"), {
      code: "ENOENT",
    });
    const unavailableParser = new PythonParser(async () => {
      throw unavailable;
    });

    await expect(unavailableParser.parse(fixturePath)).rejects.toThrow(
      /Python parser unavailable.*python3/i,
    );
  });

  it("accepts a genuinely parsed empty Python source file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-python-empty-"));
    const emptyFile = path.join(root, "empty.py");
    fs.writeFileSync(emptyFile, "");

    try {
      await expect(parser.parse(emptyFile)).resolves.toMatchObject({
        filePath: emptyFile,
        language: "python",
        functions: [],
        classes: [],
        imports: [],
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not expose malformed Python source through parser diagnostics", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-python-error-"));
    const fakeSourceSecret = ["sk", "proj", "Y".repeat(32)].join("-");
    const brokenFile = path.join(root, "broken.py");
    fs.writeFileSync(brokenFile, `def broken(${fakeSourceSecret}:\n`);

    try {
      let thrown: unknown;
      try {
        await parser.parse(brokenFile);
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).not.toContain(fakeSourceSecret);
      expect((thrown as Error).message).toBe("Failed to parse Python source.");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
