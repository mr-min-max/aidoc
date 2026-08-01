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

  // Break caught: raw defaults or docstrings cross the snapshot boundary.
  it("returns value-free hashes for an in-memory public function", async () => {
    const snapshot = await parser.snapshot(
      "src/client.py",
      `
def request(value: str = "secret-default") -> int:
    """secret docs"""
    return len(value) + 1
`,
    );

    expect(snapshot).toMatchObject({
      language: "python",
      dependencyFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      symbols: [
        {
          language: "python",
          kind: "function",
          qualifiedName: "request",
          contractFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          implementationFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          documentationFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain("secret-default");
    expect(JSON.stringify(snapshot)).not.toContain("secret docs");
  });

  // Break caught: source positions, comments, or whitespace participate in fingerprints.
  it("keeps snapshots stable across formatting and line movement", async () => {
    const compact = await parser.snapshot(
      "src/client.py",
      `def request(value: str = "stable") -> int:
    """stable docs"""
    return len(value) + 1
`,
    );
    const moved = await parser.snapshot(
      "src/client.py",
      `
# unrelated comment


def request( value: str="stable" )->int:
    """stable docs"""

    return len(value)+1  # formatting only
`,
    );

    expect(moved).toEqual(compact);
  });

  // Break caught: Python code-point symbol order is rejected using JavaScript UTF-16 order.
  it("accepts Python-sorted BMP and supplementary-plane identifiers", async () => {
    const snapshot = await parser.snapshot(
      "src/unicode.py",
      `def \uFA0E():
    return 1

def \u{10400}():
    return 2
`,
    );

    expect(snapshot.symbols.map(({ qualifiedName }) => qualifiedName)).toEqual([
      "\uFA0E",
      "\u{10400}",
    ]);
  });

  // Break caught: Python argument categories collapse into one positional list.
  it("fingerprints positional-only parameter changes", async () => {
    const positionalOnly = await parser.snapshot(
      "src/client.py",
      `def request(value: int, /, label: str) -> int:
    return 1
`,
    );
    const positionalOrKeyword = await parser.snapshot(
      "src/client.py",
      `def request(value: int, label: str) -> int:
    return 1
`,
    );

    expect(positionalOrKeyword.symbols[0].contractFacets.parameters).not.toBe(
      positionalOnly.symbols[0].contractFacets.parameters,
    );
    expect(positionalOrKeyword.symbols[0].contractFingerprint).not.toBe(
      positionalOnly.symbols[0].contractFingerprint,
    );
    expect(positionalOrKeyword.symbols[0].implementationFingerprint).toBe(
      positionalOnly.symbols[0].implementationFingerprint,
    );
  });

  // Break caught: keyword-only parameters are treated as positional parameters.
  it("fingerprints keyword-only parameter changes", async () => {
    const positional = await parser.snapshot(
      "src/client.py",
      `def request(value: int, label: str) -> int:
    return 1
`,
    );
    const keywordOnly = await parser.snapshot(
      "src/client.py",
      `def request(value: int, *, label: str) -> int:
    return 1
`,
    );

    expect(keywordOnly.symbols[0].contractFacets.parameters).not.toBe(
      positional.symbols[0].contractFacets.parameters,
    );
    expect(keywordOnly.symbols[0].implementationFingerprint).toBe(
      positional.symbols[0].implementationFingerprint,
    );
  });

  // Break caught: variadic parameters are absent from the callable contract.
  it("fingerprints variadic parameter changes", async () => {
    const first = await parser.snapshot(
      "src/client.py",
      `def request(*values: bytes, **options: str) -> int:
    return 1
`,
    );
    const changed = await parser.snapshot(
      "src/client.py",
      `def request(*items: bytes, **metadata: str) -> int:
    return 1
`,
    );

    expect(changed.symbols[0].contractFacets.parameters).not.toBe(
      first.symbols[0].contractFacets.parameters,
    );
    expect(changed.symbols[0].contractFingerprint).not.toBe(
      first.symbols[0].contractFingerprint,
    );
  });

  // Break caught: annotations, defaults, or returns do not reach their matching facets.
  it("separates annotation, default, and return contract changes", async () => {
    const baseline = await parser.snapshot(
      "src/client.py",
      `def request(value: str = "first-default") -> int:
    return 1
`,
    );
    const annotationChanged = await parser.snapshot(
      "src/client.py",
      `def request(value: bytes = "first-default") -> int:
    return 1
`,
    );
    const defaultChanged = await parser.snapshot(
      "src/client.py",
      `def request(value: str = "second-default") -> int:
    return 1
`,
    );
    const returnChanged = await parser.snapshot(
      "src/client.py",
      `def request(value: str = "first-default") -> str:
    return 1
`,
    );

    for (const changed of [annotationChanged, defaultChanged]) {
      expect(changed.symbols[0].contractFacets.parameters).not.toBe(
        baseline.symbols[0].contractFacets.parameters,
      );
      expect(changed.symbols[0].contractFacets.return).toBe(
        baseline.symbols[0].contractFacets.return,
      );
      expect(changed.symbols[0].implementationFingerprint).toBe(
        baseline.symbols[0].implementationFingerprint,
      );
    }
    expect(returnChanged.symbols[0].contractFacets.return).not.toBe(
      baseline.symbols[0].contractFacets.return,
    );
    expect(returnChanged.symbols[0].contractFacets.parameters).toBe(
      baseline.symbols[0].contractFacets.parameters,
    );
    for (const sourceValue of ["first-default", "second-default"]) {
      expect(JSON.stringify(baseline)).not.toContain(sourceValue);
      expect(JSON.stringify(defaultChanged)).not.toContain(sourceValue);
    }
  });

  // Break caught: executable body mutations are mistaken for contract changes.
  it("changes only implementation fingerprints for body mutations", async () => {
    const first = await parser.snapshot(
      "src/client.py",
      `def calculate(value: int) -> int:
    return value + 1
`,
    );
    const changed = await parser.snapshot(
      "src/client.py",
      `def calculate(value: int) -> int:
    return value * 2
`,
    );

    expect(changed.symbols[0].contractFacets).toEqual(
      first.symbols[0].contractFacets,
    );
    expect(changed.symbols[0].contractFingerprint).toBe(
      first.symbols[0].contractFingerprint,
    );
    expect(changed.symbols[0].implementationFingerprint).not.toBe(
      first.symbols[0].implementationFingerprint,
    );
  });

  // Break caught: decorators and async syntax are omitted from the modifiers facet.
  it("fingerprints decorators and callable modifiers", async () => {
    const first = await parser.snapshot(
      "src/client.py",
      `@route("first-route")
def request(value: int) -> int:
    return value
`,
    );
    const decoratorChanged = await parser.snapshot(
      "src/client.py",
      `@route("second-route")
def request(value: int) -> int:
    return value
`,
    );
    const asyncChanged = await parser.snapshot(
      "src/client.py",
      `@route("first-route")
async def request(value: int) -> int:
    return value
`,
    );

    for (const changed of [decoratorChanged, asyncChanged]) {
      expect(changed.symbols[0].contractFacets.modifiers).not.toBe(
        first.symbols[0].contractFacets.modifiers,
      );
      expect(changed.symbols[0].contractFingerprint).not.toBe(
        first.symbols[0].contractFingerprint,
      );
      expect(changed.symbols[0].implementationFingerprint).toBe(
        first.symbols[0].implementationFingerprint,
      );
    }
    expect(JSON.stringify(first)).not.toContain("first-route");
    expect(JSON.stringify(decoratorChanged)).not.toContain("second-route");
  });

  // Break caught: valid Python overload declarations become duplicate snapshot identities.
  it("groups Python overloads into deterministic function and method symbols", async () => {
    const first = await parser.snapshot(
      "src/convert.py",
      `from typing import overload

@overload
def convert(value: str) -> str: ...
@overload
def convert(value: int) -> int: ...
def convert(value):
    return value

class Service:
    @overload
    def run(self, value: str) -> str: ...
    @overload
    def run(self, value: int) -> int: ...
    def run(self, value):
        return value
`,
    );
    const reordered = await parser.snapshot(
      "src/convert.py",
      `from typing import overload

@overload
def convert(value: int) -> int: ...
@overload
def convert(value: str) -> str: ...
def convert(value):
    return value

class Service:
    @overload
    def run(self, value: int) -> int: ...
    @overload
    def run(self, value: str) -> str: ...
    def run(self, value):
        return value
`,
    );
    const changed = await parser.snapshot(
      "src/convert.py",
      `from typing import overload

@overload
def convert(value: bytes) -> str: ...
@overload
def convert(value: int) -> int: ...
def convert(value):
    return value

class Service:
    @overload
    def run(self, value: str) -> str: ...
    @overload
    def run(self, value: int) -> int: ...
    def run(self, value):
        return value
`,
    );

    expect(
      first.symbols.map(({ kind, qualifiedName }) => ({ kind, qualifiedName })),
    ).toEqual([
      { kind: "class", qualifiedName: "Service" },
      { kind: "function", qualifiedName: "convert" },
      { kind: "method", qualifiedName: "Service.run" },
    ]);
    expect(reordered).toEqual(first);
    const originalFunction = first.symbols.find(
      ({ kind }) => kind === "function",
    );
    const changedFunction = changed.symbols.find(
      ({ kind }) => kind === "function",
    );
    expect(changedFunction?.contractFacets.parameters).not.toBe(
      originalFunction?.contractFacets.parameters,
    );
    expect(changedFunction?.contractFingerprint).not.toBe(
      originalFunction?.contractFingerprint,
    );
  });

  // Break caught: an overload implementation default is absent from every emitted fingerprint.
  it("fingerprints overload implementation defaults only as implementation details", async () => {
    const first = await parser.snapshot(
      "src/convert.py",
      `from typing import overload

@overload
def convert(value: str) -> str: ...
@overload
def convert(value: int) -> int: ...
def convert(value="first-runtime-default"):
    return value
`,
    );
    const changed = await parser.snapshot(
      "src/convert.py",
      `from typing import overload

@overload
def convert(value: str) -> str: ...
@overload
def convert(value: int) -> int: ...
def convert(value="second-runtime-default"):
    return value
`,
    );

    expect(changed.symbols[0].contractFacets).toEqual(
      first.symbols[0].contractFacets,
    );
    expect(changed.symbols[0].contractFingerprint).toBe(
      first.symbols[0].contractFingerprint,
    );
    expect(changed.symbols[0].implementationFingerprint).not.toBe(
      first.symbols[0].implementationFingerprint,
    );
    for (const sourceValue of [
      "first-runtime-default",
      "second-runtime-default",
    ]) {
      expect(JSON.stringify(first)).not.toContain(sourceValue);
      expect(JSON.stringify(changed)).not.toContain(sourceValue);
    }
  });

  // Break caught: an overload method's body-bearing runtime signature is omitted or made public contract.
  it("fingerprints overload runtime signatures only as implementation details", async () => {
    const first = await parser.snapshot(
      "src/service.py",
      `from typing import overload

class Service:
    @overload
    def run(self, value: str) -> str: ...
    @overload
    def run(self, value: int) -> int: ...
    def run(self, value):
        return value
`,
    );
    const changed = await parser.snapshot(
      "src/service.py",
      `from typing import overload

class Service:
    @overload
    def run(self, value: str) -> str: ...
    @overload
    def run(self, value: int) -> int: ...
    def run(self, value, *, trace=False):
        return value
`,
    );
    const originalClass = first.symbols.find(({ kind }) => kind === "class");
    const changedClass = changed.symbols.find(({ kind }) => kind === "class");
    const originalMethod = first.symbols.find(({ kind }) => kind === "method");
    const changedMethod = changed.symbols.find(({ kind }) => kind === "method");

    expect(changedMethod?.contractFacets).toEqual(
      originalMethod?.contractFacets,
    );
    expect(changedMethod?.contractFingerprint).toBe(
      originalMethod?.contractFingerprint,
    );
    expect(changedMethod?.implementationFingerprint).not.toBe(
      originalMethod?.implementationFingerprint,
    );
    expect(changedClass?.contractFacets).toEqual(originalClass?.contractFacets);
    expect(changedClass?.contractFingerprint).toBe(
      originalClass?.contractFingerprint,
    );
    expect(changedClass?.implementationFingerprint).not.toBe(
      originalClass?.implementationFingerprint,
    );
  });

  // Break caught: same-name property accessors collapse to the setter-only contract.
  it("aggregates property getter and setter contracts", async () => {
    const first = await parser.snapshot(
      "src/service.py",
      `class Service:
    @property
    def value(self) -> int:
        return self._value

    @value.setter
    def value(self, updated: str) -> None:
        self._value = updated
`,
    );
    const getterChanged = await parser.snapshot(
      "src/service.py",
      `class Service:
    @property
    def value(self) -> bytes:
        return self._value

    @value.setter
    def value(self, updated: str) -> None:
        self._value = updated
`,
    );
    const setterChanged = await parser.snapshot(
      "src/service.py",
      `class Service:
    @property
    def value(self) -> int:
        return self._value

    @value.setter
    def value(self, updated: bytes) -> None:
        self._value = updated
`,
    );
    const originalClass = first.symbols.find(({ kind }) => kind === "class");
    const originalMethod = first.symbols.find(({ kind }) => kind === "method");

    for (const changed of [getterChanged, setterChanged]) {
      const changedClass = changed.symbols.find(({ kind }) => kind === "class");
      const changedMethod = changed.symbols.find(
        ({ kind }) => kind === "method",
      );

      expect(changedClass?.contractFacets.members).not.toBe(
        originalClass?.contractFacets.members,
      );
      expect(changedClass?.contractFingerprint).not.toBe(
        originalClass?.contractFingerprint,
      );
      expect(changedClass?.implementationFingerprint).toBe(
        originalClass?.implementationFingerprint,
      );
      expect(changedMethod?.contractFingerprint).not.toBe(
        originalMethod?.contractFingerprint,
      );
      expect(changedMethod?.implementationFingerprint).toBe(
        originalMethod?.implementationFingerprint,
      );
    }
  });

  // Break caught: same-name property accessors collapse to the setter-only implementation.
  it("aggregates property getter and setter implementations", async () => {
    const first = await parser.snapshot(
      "src/service.py",
      `class Service:
    @property
    def value(self) -> str:
        return "first-getter-value"

    @value.setter
    def value(self, updated: str) -> None:
        self._value = "first-setter-value"
`,
    );
    const getterChanged = await parser.snapshot(
      "src/service.py",
      `class Service:
    @property
    def value(self) -> str:
        return "second-getter-value"

    @value.setter
    def value(self, updated: str) -> None:
        self._value = "first-setter-value"
`,
    );
    const setterChanged = await parser.snapshot(
      "src/service.py",
      `class Service:
    @property
    def value(self) -> str:
        return "first-getter-value"

    @value.setter
    def value(self, updated: str) -> None:
        self._value = "second-setter-value"
`,
    );
    const originalClass = first.symbols.find(({ kind }) => kind === "class");
    const originalMethod = first.symbols.find(({ kind }) => kind === "method");

    for (const changed of [getterChanged, setterChanged]) {
      const changedClass = changed.symbols.find(({ kind }) => kind === "class");
      const changedMethod = changed.symbols.find(
        ({ kind }) => kind === "method",
      );

      expect(changedClass?.contractFacets).toEqual(
        originalClass?.contractFacets,
      );
      expect(changedClass?.contractFingerprint).toBe(
        originalClass?.contractFingerprint,
      );
      expect(changedClass?.implementationFingerprint).not.toBe(
        originalClass?.implementationFingerprint,
      );
      expect(changedMethod?.contractFacets).toEqual(
        originalMethod?.contractFacets,
      );
      expect(changedMethod?.contractFingerprint).toBe(
        originalMethod?.contractFingerprint,
      );
      expect(changedMethod?.implementationFingerprint).not.toBe(
        originalMethod?.implementationFingerprint,
      );
    }
    for (const sourceValue of [
      "first-getter-value",
      "second-getter-value",
      "first-setter-value",
      "second-setter-value",
    ]) {
      expect(JSON.stringify(first)).not.toContain(sourceValue);
      expect(JSON.stringify(getterChanged)).not.toContain(sourceValue);
      expect(JSON.stringify(setterChanged)).not.toContain(sourceValue);
    }
  });

  // Break caught: a shadowed earlier method still contributes to its owning class fingerprints.
  it("ignores shadowed repeated methods in method and class fingerprints", async () => {
    const first = await parser.snapshot(
      "src/service.py",
      `class Service:
    def run(self, obsolete: int = 1) -> int:
        return obsolete + 1

    def run(self, value: str) -> str:
        return value.strip()
`,
    );
    const changed = await parser.snapshot(
      "src/service.py",
      `class Service:
    async def run(self, obsolete: bytes = b"shadowed-secret") -> bytes:
        return obsolete

    def run(self, value: str) -> str:
        return value.strip()
`,
    );
    const originalClass = first.symbols.find(({ kind }) => kind === "class");
    const changedClass = changed.symbols.find(({ kind }) => kind === "class");
    const originalMethod = first.symbols.find(({ kind }) => kind === "method");
    const changedMethod = changed.symbols.find(({ kind }) => kind === "method");

    expect(changedMethod).toEqual(originalMethod);
    expect(changedClass).toEqual(originalClass);
    expect(JSON.stringify(changed)).not.toContain("shadowed-secret");
  });

  // Break caught: a valid repeated class identity is rejected as malformed child output.
  it("snapshots the last effective repeated class declaration", async () => {
    const snapshot = await parser.snapshot(
      "src/service.py",
      `class Service:
    def replaced(self) -> int:
        return 1

class Service:
    def current(self) -> int:
        return 2
`,
    );

    expect(
      snapshot.symbols.map(({ kind, qualifiedName }) => ({
        kind,
        qualifiedName,
      })),
    ).toEqual([
      { kind: "class", qualifiedName: "Service" },
      { kind: "method", qualifiedName: "Service.current" },
    ]);
  });

  // Break caught: class bases are omitted from the inheritance facet.
  it("fingerprints class inheritance changes", async () => {
    const first = await parser.snapshot(
      "src/client.py",
      `class Service(Base, Protocol):
    pass
`,
    );
    const changed = await parser.snapshot(
      "src/client.py",
      `class Service(OtherBase, Protocol):
    pass
`,
    );

    expect(changed.symbols[0].kind).toBe("class");
    expect(changed.symbols[0].contractFacets.inheritance).not.toBe(
      first.symbols[0].contractFacets.inheritance,
    );
    expect(changed.symbols[0].contractFingerprint).not.toBe(
      first.symbols[0].contractFingerprint,
    );
    expect(changed.symbols[0].implementationFingerprint).toBe(
      first.symbols[0].implementationFingerprint,
    );
  });

  // Break caught: public class methods lack stable qualified symbol identities.
  it("emits qualified public class methods", async () => {
    const snapshot = await parser.snapshot(
      "src/client.py",
      `class Service:
    def request(self, value: str) -> int:
        """method documentation sentinel"""
        return len(value)
`,
    );

    expect(
      snapshot.symbols.map(({ kind, qualifiedName }) => ({
        kind,
        qualifiedName,
      })),
    ).toEqual([
      { kind: "class", qualifiedName: "Service" },
      { kind: "method", qualifiedName: "Service.request" },
    ]);
    expect(snapshot.symbols[1].documentationFingerprint).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(JSON.stringify(snapshot)).not.toContain(
      "method documentation sentinel",
    );
  });

  // Break caught: a static method parameter named self is mistaken for a bound receiver.
  it("preserves every declared static method parameter in contract hashes", async () => {
    const withSelfParameter = await parser.snapshot(
      "src/client.py",
      `class Service:
    @staticmethod
    def request(self: str, value: int) -> int:
        return value
`,
    );
    const withoutSelfParameter = await parser.snapshot(
      "src/client.py",
      `class Service:
    @staticmethod
    def request(value: int) -> int:
        return value
`,
    );
    const originalClass = withSelfParameter.symbols.find(
      ({ kind }) => kind === "class",
    );
    const changedClass = withoutSelfParameter.symbols.find(
      ({ kind }) => kind === "class",
    );
    const originalMethod = withSelfParameter.symbols.find(
      ({ kind }) => kind === "method",
    );
    const changedMethod = withoutSelfParameter.symbols.find(
      ({ kind }) => kind === "method",
    );

    expect(changedMethod?.contractFacets.parameters).not.toBe(
      originalMethod?.contractFacets.parameters,
    );
    expect(changedMethod?.contractFingerprint).not.toBe(
      originalMethod?.contractFingerprint,
    );
    expect(changedClass?.contractFacets.members).not.toBe(
      originalClass?.contractFacets.members,
    );
  });

  // Break caught: renaming a bound instance receiver creates a false API change.
  it("excludes the bound instance receiver regardless of its local name", async () => {
    const first = await parser.snapshot(
      "src/client.py",
      `class Service:
    def request(receiver, value: int) -> int:
        return value
`,
    );
    const renamed = await parser.snapshot(
      "src/client.py",
      `class Service:
    def request(instance, value: int) -> int:
        return value
`,
    );
    const firstClass = first.symbols.find(({ kind }) => kind === "class");
    const renamedClass = renamed.symbols.find(({ kind }) => kind === "class");
    const firstMethod = first.symbols.find(({ kind }) => kind === "method");
    const renamedMethod = renamed.symbols.find(({ kind }) => kind === "method");

    expect(renamedMethod?.contractFingerprint).toBe(
      firstMethod?.contractFingerprint,
    );
    expect(renamedClass?.contractFacets.members).toBe(
      firstClass?.contractFacets.members,
    );
  });

  // Break caught: starred public assignment targets disappear from class fingerprints.
  it("fingerprints every public name in starred class assignments", async () => {
    const first = await parser.snapshot(
      "src/client.py",
      `class Result:
    head, *tail = values
`,
    );
    const changed = await parser.snapshot(
      "src/client.py",
      `class Result:
    head, *items = values
`,
    );
    const original = first.symbols[0];
    const updated = changed.symbols[0];

    expect(updated.contractFacets.members).not.toBe(
      original.contractFacets.members,
    );
    expect(updated.contractFingerprint).not.toBe(original.contractFingerprint);
    expect(updated.implementationFingerprint).not.toBe(
      original.implementationFingerprint,
    );
    for (const sourceValue of ["values", "tail", "items"]) {
      expect(JSON.stringify(first)).not.toContain(sourceValue);
      expect(JSON.stringify(changed)).not.toContain(sourceValue);
    }
  });

  // Break caught: underscore-prefixed declarations become public symbols.
  it("excludes underscore-prefixed functions, classes, members, and dunder methods", async () => {
    const snapshot = await parser.snapshot(
      "src/client.py",
      `def exposed():
    return 1

def _hidden_function():
    return "hidden-function-value"

class _HiddenClass:
    def visible_inside_private_class(self):
        return "hidden-class-value"

class Visible:
    def public(self):
        return 1

    def _private(self):
        return "private-value"

    def __init__(self):
        self.value = "dunder-init-value"

    def __str__(self):
        return "dunder-str-value"
`,
    );

    expect(
      snapshot.symbols.map(({ kind, qualifiedName }) => ({
        kind,
        qualifiedName,
      })),
    ).toEqual([
      { kind: "class", qualifiedName: "Visible" },
      { kind: "function", qualifiedName: "exposed" },
      { kind: "method", qualifiedName: "Visible.public" },
    ]);
  });

  // Break caught: import module values leak or fail to affect module dependency identity.
  it("isolates import changes to the dependency fingerprint", async () => {
    const first = await parser.snapshot(
      "src/client.py",
      `import first_secret_dependency as dependency
from first_secret_package import Client

def request() -> int:
    return dependency.call()
`,
    );
    const changed = await parser.snapshot(
      "src/client.py",
      `import second_secret_dependency as dependency
from second_secret_package import Client

def request() -> int:
    return dependency.call()
`,
    );

    expect(changed.dependencyFingerprint).not.toBe(first.dependencyFingerprint);
    expect(changed.symbols).toEqual(first.symbols);
    for (const sourceValue of [
      "first_secret_dependency",
      "first_secret_package",
      "second_secret_dependency",
      "second_secret_package",
    ]) {
      expect(JSON.stringify(first)).not.toContain(sourceValue);
      expect(JSON.stringify(changed)).not.toContain(sourceValue);
    }
  });

  // Break caught: imports beneath control flow or private scopes vanish from dependencies.
  it("fingerprints conditional and nested import module specifiers", async () => {
    const first = await parser.snapshot(
      "src/client.py",
      `if TYPE_CHECKING:
    import first_conditional_dependency

class _PrivateService:
    import first_class_dependency

def _private_helper():
    import first_function_dependency

def request() -> int:
    return 1
`,
    );
    const changed = await parser.snapshot(
      "src/client.py",
      `if TYPE_CHECKING:
    import second_conditional_dependency

class _PrivateService:
    import second_class_dependency

def _private_helper():
    import second_function_dependency

def request() -> int:
    return 1
`,
    );

    expect(changed.dependencyFingerprint).not.toBe(first.dependencyFingerprint);
    expect(changed.symbols).toEqual(first.symbols);
    for (const sourceValue of [
      "first_conditional_dependency",
      "first_class_dependency",
      "first_function_dependency",
      "second_conditional_dependency",
      "second_class_dependency",
      "second_function_dependency",
    ]) {
      expect(JSON.stringify(first)).not.toContain(sourceValue);
      expect(JSON.stringify(changed)).not.toContain(sourceValue);
    }
  });

  // Break caught: docstring expressions contaminate contract or implementation hashes.
  it("changes only documentation fingerprints for docstring mutations", async () => {
    const first = await parser.snapshot(
      "src/client.py",
      `def request() -> int:
    """first documentation sentinel"""
    return 1
`,
    );
    const changed = await parser.snapshot(
      "src/client.py",
      `def request() -> int:
    """second documentation sentinel"""
    return 1
`,
    );

    expect(changed.symbols[0].contractFingerprint).toBe(
      first.symbols[0].contractFingerprint,
    );
    expect(changed.symbols[0].implementationFingerprint).toBe(
      first.symbols[0].implementationFingerprint,
    );
    expect(changed.symbols[0].documentationFingerprint).not.toBe(
      first.symbols[0].documentationFingerprint,
    );
    expect(JSON.stringify(first)).not.toContain("first documentation sentinel");
    expect(JSON.stringify(changed)).not.toContain(
      "second documentation sentinel",
    );
  });

  // Break caught: a later class string expression is stripped as an artificial module docstring.
  it("fingerprints non-docstring class string expressions as implementation", async () => {
    const first = await parser.snapshot(
      "src/client.py",
      `class Service:
    """stable class documentation"""
    "first implementation sentinel"
`,
    );
    const changed = await parser.snapshot(
      "src/client.py",
      `class Service:
    """stable class documentation"""
    "second implementation sentinel"
`,
    );

    expect(changed.symbols[0].contractFingerprint).toBe(
      first.symbols[0].contractFingerprint,
    );
    expect(changed.symbols[0].documentationFingerprint).toBe(
      first.symbols[0].documentationFingerprint,
    );
    expect(changed.symbols[0].implementationFingerprint).not.toBe(
      first.symbols[0].implementationFingerprint,
    );
    expect(JSON.stringify(first)).not.toContain(
      "first implementation sentinel",
    );
    expect(JSON.stringify(changed)).not.toContain(
      "second implementation sentinel",
    );
  });

  // Break caught: in-memory syntax diagnostics expose source text.
  it("rejects snapshot syntax errors with a fixed safe message", async () => {
    const sourceSentinel = ["sk", "snapshot", "X".repeat(32)].join("-");

    let thrown: unknown;
    try {
      await parser.snapshot("src/broken.py", `def broken(${sourceSentinel}:\n`);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Failed to parse Python source.");
    expect((thrown as Error).message).not.toContain(sourceSentinel);
    expect((thrown as Error).cause).toEqual(new Error("Python parser failed."));
  });

  // Break caught: snapshot source is placed in argv instead of child stdin.
  it("sends snapshot source through child stdin without placing it in argv", async () => {
    const sourceSentinel = `def request():\n    return "stdin-only-sentinel"\n`;
    let capturedArgs: string[] = [];
    let capturedInput: string | undefined;
    const hash = "0".repeat(64);
    const injectedParser = new PythonParser(async (_command, args, options) => {
      capturedArgs = args;
      capturedInput = (options as typeof options & { input?: string }).input;
      return {
        stdout: JSON.stringify({
          language: "python",
          dependencyFingerprint: hash,
          symbols: [],
        }),
        stderr: "",
      };
    });

    await injectedParser.snapshot("src/client.py", sourceSentinel);

    expect(capturedArgs.slice(2)).toEqual(["snapshot", "src/client.py"]);
    expect(capturedArgs).not.toContain(sourceSentinel);
    expect(capturedArgs.join(" ")).not.toContain("stdin-only-sentinel");
    expect(capturedInput).toBe(sourceSentinel);
  });

  // Break caught: an early-closing real child emits an unhandled stdin EPIPE.
  it("translates default-runner stdin failures without crashing the process", async () => {
    type DefaultRunner = (
      command: string,
      args: string[],
      options: { timeout: number; maxBuffer: number; input?: string },
    ) => Promise<{ stdout: string; stderr: string }>;
    const pythonModule = jest.requireActual(
      "../../../src/parsers/python",
    ) as typeof import("../../../src/parsers/python") & {
      createPythonProcessRunner?: () => DefaultRunner;
    };
    const runnerFactory = pythonModule.createPythonProcessRunner;
    if (runnerFactory === undefined) {
      throw new Error("Default Python process runner factory is unavailable.");
    }
    const defaultRunner = runnerFactory();
    const earlyClosingParser = new PythonParser((_command, _args, options) =>
      defaultRunner("python3", ["-c", "import os; os._exit(0)"], options),
    );
    const sourceSentinel = ["sk", "stdin-lifecycle", "L".repeat(32)].join("-");
    const largeSource = `# ${sourceSentinel}\n${"x".repeat(16 * 1024 * 1024)}`;

    let thrown: unknown;
    try {
      await earlyClosingParser.snapshot("src/client.py", largeSource);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Failed to parse Python source.");
    expect(String(thrown)).not.toContain(sourceSentinel);
    expect(String((thrown as Error).cause)).not.toContain(sourceSentinel);
  });

  // Break caught: malformed child JSON is trusted as a value-free snapshot.
  it("rejects malformed child snapshots without retaining returned sentinels", async () => {
    const hash = "a".repeat(64);
    const sentinel = ["sk", "invalid-child-json", "J".repeat(32)].join("-");
    const validSymbol = {
      language: "python",
      kind: "function",
      qualifiedName: "request",
      contractFacets: {
        parameters: hash,
        modifiers: hash,
      },
      contractFingerprint: hash,
      implementationFingerprint: hash,
      documentationFingerprint: null,
    };
    const validSnapshot = {
      language: "python",
      dependencyFingerprint: hash,
      symbols: [validSymbol],
    };
    const invalidOutputs: Array<[string, unknown]> = [
      ["unexpected root field", { ...validSnapshot, source: sentinel }],
      ["invalid root language", { ...validSnapshot, language: sentinel }],
      [
        "invalid dependency hash",
        { ...validSnapshot, dependencyFingerprint: sentinel },
      ],
      ["non-array symbols", { ...validSnapshot, symbols: sentinel }],
      [
        "duplicate symbol identities",
        { ...validSnapshot, symbols: [validSymbol, { ...validSymbol }] },
      ],
      [
        "unexpected symbol field",
        {
          ...validSnapshot,
          symbols: [{ ...validSymbol, source: sentinel }],
        },
      ],
      [
        "invalid symbol language",
        {
          ...validSnapshot,
          symbols: [{ ...validSymbol, language: sentinel }],
        },
      ],
      [
        "invalid symbol kind",
        {
          ...validSnapshot,
          symbols: [{ ...validSymbol, kind: sentinel }],
        },
      ],
      [
        "unsafe qualified name",
        {
          ...validSnapshot,
          symbols: [{ ...validSymbol, qualifiedName: sentinel }],
        },
      ],
      [
        "non-XID qualified name",
        {
          ...validSnapshot,
          symbols: [{ ...validSymbol, qualifiedName: "\u037A" }],
        },
      ],
      [
        "unexpected facet",
        {
          ...validSnapshot,
          symbols: [
            {
              ...validSymbol,
              contractFacets: {
                ...validSymbol.contractFacets,
                source: sentinel,
              },
            },
          ],
        },
      ],
      [
        "invalid facet hash",
        {
          ...validSnapshot,
          symbols: [
            {
              ...validSymbol,
              contractFacets: {
                ...validSymbol.contractFacets,
                parameters: sentinel,
              },
            },
          ],
        },
      ],
      [
        "invalid combined hash",
        {
          ...validSnapshot,
          symbols: [{ ...validSymbol, contractFingerprint: sentinel }],
        },
      ],
      [
        "invalid implementation hash",
        {
          ...validSnapshot,
          symbols: [{ ...validSymbol, implementationFingerprint: sentinel }],
        },
      ],
      [
        "invalid documentation string",
        {
          ...validSnapshot,
          symbols: [{ ...validSymbol, documentationFingerprint: sentinel }],
        },
      ],
      [
        "invalid documentation type",
        {
          ...validSnapshot,
          symbols: [{ ...validSymbol, documentationFingerprint: 1 }],
        },
      ],
    ];

    for (const [label, output] of invalidOutputs) {
      const invalidParser = new PythonParser(async () => ({
        stdout: JSON.stringify(output),
        stderr: "",
      }));
      let thrown: unknown;
      try {
        await invalidParser.snapshot("src/client.py", "def request(): pass\n");
      } catch (error: unknown) {
        thrown = error;
      }
      if (thrown === undefined) {
        thrown = new Error(`Accepted ${label}: ${sentinel}`);
      }

      expect((thrown as Error).message).toBe("Failed to parse Python source.");
      expect(String(thrown)).not.toContain(sentinel);
      expect(String((thrown as Error).cause)).not.toContain(sentinel);
    }
  });

  // Break caught: child stderr or retained process errors expose in-memory source.
  it("sanitizes snapshot runner failures without retaining source or stderr", async () => {
    const sourceSentinel = ["sk", "runner-source", "R".repeat(32)].join("-");
    const stderrSentinel = ["sk", "runner-stderr", "S".repeat(32)].join("-");
    const failingParser = new PythonParser(async () => {
      throw Object.assign(new Error(`failure: ${sourceSentinel}`), {
        stderr: `traceback: ${stderrSentinel}`,
      });
    });

    let thrown: unknown;
    try {
      await failingParser.snapshot(
        "src/client.py",
        `def request():\n    return "${sourceSentinel}"\n`,
      );
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Failed to parse Python source.");
    expect(String(thrown)).not.toContain(sourceSentinel);
    expect(String(thrown)).not.toContain(stderrSentinel);
    expect(String((thrown as Error).cause)).not.toContain(sourceSentinel);
    expect(String((thrown as Error).cause)).not.toContain(stderrSentinel);
  });
});
