import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import prompts from "prompts";
import {
  annotateCommand,
  applyAcceptedAnnotations,
} from "../../../src/cli/commands/annotate";
import { MockGenerator } from "../../../src/cli/mock-generator";
import { defaultConfig } from "../../../src/config/loader";
import * as commandContext from "../../../src/cli/context";
import * as analyzer from "../../../src/core/analyzer";
import * as diffDisplay from "../../../src/output/diff-display";
import {
  RepositoryWriteScope,
  type PreparedRepositoryTarget,
} from "../../../src/security/repository-writer";
import type { FunctionInfo, ParsedModule } from "../../../src/parsers/types";

jest.mock("prompts", () => jest.fn());

const prompt = prompts as unknown as jest.MockedFunction<typeof prompts>;

describe("applyAcceptedAnnotations", () => {
  it("applies annotations in descending original line order", () => {
    expect(
      applyAcceptedAnnotations("first();\nsecond();\n", [
        { name: "first", line: 1, jsdoc: "/** First. */" },
        { name: "second", line: 2, jsdoc: "/** Second. */" },
      ]),
    ).toBe("/** First. */\nfirst();\n/** Second. */\nsecond();\n");
  });

  it("preserves source indentation and CRLF newlines", () => {
    expect(
      applyAcceptedAnnotations("  first();\r\n", [
        {
          name: "first",
          line: 1,
          jsdoc: "/**\n * First.\n */",
        },
      ]),
    ).toBe("  /**\r\n   * First.\r\n   */\r\n  first();\r\n");
  });

  it("uses symbol names to deterministically break same-line ties", () => {
    const source = "export const alpha = () => 1, beta = () => 2;\n";
    const alpha = { name: "alpha", line: 1, jsdoc: "/** Alpha. */" };
    const beta = { name: "beta", line: 1, jsdoc: "/** Beta. */" };
    const expected =
      "/** Beta. */\n/** Alpha. */\n" +
      "export const alpha = () => 1, beta = () => 2;\n";

    expect(applyAcceptedAnnotations(source, [alpha, beta])).toBe(expected);
    expect(applyAcceptedAnnotations(source, [beta, alpha])).toBe(expected);
  });
});

function undocumentedFunction(name: string, line: number): FunctionInfo {
  return {
    name,
    parameters: [],
    returnType: "void",
    isAsync: false,
    isExported: true,
    lineRange: [line, line],
    signature: `export function ${name}(): void`,
  };
}

function parsedModule(
  filePath: string,
  functions: FunctionInfo[],
): ParsedModule {
  return {
    filePath,
    language: "typescript",
    functions,
    classes: [],
    types: [],
    imports: [],
  };
}

function preparedTarget(
  displayPath: string,
  existingText: string,
): PreparedRepositoryTarget & { replaceText: jest.Mock } {
  return {
    displayPath,
    existingText,
    replaceText: jest.fn().mockResolvedValue(undefined),
  };
}

describe("annotate command repository writes", () => {
  const roots: string[] = [];

  afterEach(() => {
    jest.restoreAllMocks();
    prompt.mockReset();
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function fixture(): {
    cwd: string;
    firstFile: string;
    secondFile: string;
    firstSource: string;
    secondSource: string;
    modules: ParsedModule[];
  } {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-annotate-"));
    roots.push(cwd);
    const firstFile = path.join(cwd, "src", "one", "index.ts");
    const secondFile = path.join(cwd, "src", "two", "index.ts");
    const firstSource =
      "export function first(): void {}\n" +
      "export function second(): void {}\n";
    const secondSource = "export function third(): void {}\n";
    fs.mkdirSync(path.dirname(firstFile), { recursive: true });
    fs.mkdirSync(path.dirname(secondFile), { recursive: true });
    fs.writeFileSync(firstFile, firstSource);
    fs.writeFileSync(secondFile, secondSource);
    return {
      cwd,
      firstFile,
      secondFile,
      firstSource,
      secondSource,
      modules: [
        parsedModule(firstFile, [
          undocumentedFunction("first", 1),
          undocumentedFunction("second", 2),
        ]),
        parsedModule(secondFile, [undocumentedFunction("third", 1)]),
      ],
    };
  }

  function mockContext(
    cwd: string,
    generator: MockGenerator,
  ): jest.SpyInstance {
    return jest
      .spyOn(commandContext, "loadCommandContext")
      .mockResolvedValue({
        config: defaultConfig,
        cwd,
        generator,
        isMock: true,
      });
  }

  function suppressOutput(): void {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    jest
      .spyOn(diffDisplay, "displayDiff")
      .mockImplementation(() => undefined);
  }

  it("prepares every unique source file before provider transport", async () => {
    const { cwd, firstFile, secondFile, firstSource, secondSource, modules } =
      fixture();
    const first = preparedTarget(path.join("src", "one", "index.ts"), firstSource);
    const second = preparedTarget(
      path.join("src", "two", "index.ts"),
      secondSource,
    );
    const events: string[] = [];
    const prepare = jest.fn(async (rawTarget: string) => {
      events.push(`prepare:${rawTarget}`);
      if (rawTarget === firstFile) return first;
      if (rawTarget === secondFile) return second;
      throw new Error("unexpected target");
    });
    const open = jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({ prepare } as unknown as RepositoryWriteScope);
    const generator = new MockGenerator();
    const generate = jest
      .spyOn(generator, "generateJsDoc")
      .mockImplementation(async () => {
        events.push("generate");
        return "[]";
      });
    mockContext(cwd, generator);
    jest.spyOn(analyzer, "analyzeCodebase").mockResolvedValue(modules);
    suppressOutput();

    await annotateCommand.parseAsync(["--all"], { from: "user" });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      `prepare:${firstFile}`,
      `prepare:${secondFile}`,
      "generate",
    ]);
  });

  it("collects per-symbol decisions and replaces each accepted file once", async () => {
    const { cwd, firstFile, secondFile, firstSource, secondSource, modules } =
      fixture();
    const first = preparedTarget(path.join("src", "one", "index.ts"), firstSource);
    const second = preparedTarget(
      path.join("src", "two", "index.ts"),
      secondSource,
    );
    const targets = new Map([
      [firstFile, first],
      [secondFile, second],
    ]);
    const prepare = jest.fn(async (rawTarget: string) => targets.get(rawTarget)!);
    const open = jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({ prepare } as unknown as RepositoryWriteScope);
    const generator = new MockGenerator();
    jest.spyOn(generator, "generateJsDoc").mockResolvedValue(
      JSON.stringify([
        { name: "first", jsdoc: "/** First. */" },
        { name: "second", jsdoc: "/** Second. */" },
        { name: "third", jsdoc: "/** Third. */" },
      ]),
    );
    mockContext(cwd, generator);
    jest.spyOn(analyzer, "analyzeCodebase").mockResolvedValue(modules);
    prompt
      .mockResolvedValueOnce({ apply: true })
      .mockResolvedValueOnce({ apply: false })
      .mockResolvedValueOnce({ apply: true });
    suppressOutput();

    await annotateCommand.parseAsync(["--all"], { from: "user" });

    expect(open).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(3);
    expect(first.replaceText).toHaveBeenCalledTimes(1);
    expect(first.replaceText).toHaveBeenCalledWith(
      "/** First. */\n" + firstSource,
    );
    expect(second.replaceText).toHaveBeenCalledTimes(1);
    expect(second.replaceText).toHaveBeenCalledWith(
      "/** Third. */\n" + secondSource,
    );
  });

  it("performs no replacement when every symbol is rejected", async () => {
    const { cwd, firstFile, firstSource, modules } = fixture();
    const first = preparedTarget(path.join("src", "one", "index.ts"), firstSource);
    const prepare = jest.fn().mockResolvedValue(first);
    const open = jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({ prepare } as unknown as RepositoryWriteScope);
    const generator = new MockGenerator();
    jest.spyOn(generator, "generateJsDoc").mockResolvedValue(
      JSON.stringify([
        { name: "first", jsdoc: "/** First. */" },
        { name: "second", jsdoc: "/** Second. */" },
      ]),
    );
    mockContext(cwd, generator);
    jest
      .spyOn(analyzer, "analyzeCodebase")
      .mockResolvedValue([modules[0]]);
    prompt.mockResolvedValue({ apply: false });
    suppressOutput();

    await annotateCommand.parseAsync(["--all"], { from: "user" });

    expect(open).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(firstFile);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(first.replaceText).not.toHaveBeenCalled();
  });

  it("keeps same-basename external dry-run snapshots isolated", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-annotate-"));
    const firstRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "aidoc-annotate-external-one-"),
    );
    const secondRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "aidoc-annotate-external-two-"),
    );
    roots.push(cwd, firstRoot, secondRoot);
    const firstFile = path.join(firstRoot, "index.ts");
    const secondFile = path.join(secondRoot, "index.ts");
    const firstSource = "export function first(): void {}\n";
    const secondSource = "export function second(): void {}\n";
    fs.writeFileSync(firstFile, firstSource);
    fs.writeFileSync(secondFile, secondSource);
    const generator = new MockGenerator();
    jest.spyOn(generator, "generateJsDoc").mockResolvedValue(
      JSON.stringify([
        { name: "first", jsdoc: "/** First. */" },
        { name: "second", jsdoc: "/** Second. */" },
      ]),
    );
    mockContext(cwd, generator);
    jest.spyOn(analyzer, "analyzeCodebase").mockResolvedValue([
      parsedModule(firstFile, [undocumentedFunction("first", 1)]),
      parsedModule(secondFile, [undocumentedFunction("second", 1)]),
    ]);
    const open = jest.spyOn(RepositoryWriteScope, "open");
    suppressOutput();

    await annotateCommand.parseAsync(["--all", "--dry-run"], {
      from: "user",
    });

    expect(open).not.toHaveBeenCalled();
    expect(diffDisplay.displayDiff).toHaveBeenNthCalledWith(
      1,
      "index.ts",
      firstSource,
      "/** First. */\n" + firstSource,
    );
    expect(diffDisplay.displayDiff).toHaveBeenNthCalledWith(
      2,
      "index.ts",
      secondSource,
      "/** Second. */\n" + secondSource,
    );
  });

  it("keeps dry-run scope-free, read-only, and mutation-free", async () => {
    const { cwd, firstFile, firstSource, modules } = fixture();
    const generator = new MockGenerator();
    jest.spyOn(generator, "generateJsDoc").mockResolvedValue(
      JSON.stringify([{ name: "first", jsdoc: "/** First. */" }]),
    );
    mockContext(cwd, generator);
    jest
      .spyOn(analyzer, "analyzeCodebase")
      .mockResolvedValue([modules[0]]);
    const open = jest.spyOn(RepositoryWriteScope, "open");
    suppressOutput();

    await annotateCommand.parseAsync(["--all", "--dry-run"], {
      from: "user",
    });

    expect(open).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
    expect(fs.readFileSync(firstFile, "utf8")).toBe(firstSource);
    expect(
      fs.readdirSync(path.dirname(firstFile)).filter((name) =>
        name.startsWith(".aidoc-write-"),
      ),
    ).toEqual([]);
  });
});
