import { readmeCommand } from "../../../src/cli/commands/readme";
import { apiCommand } from "../../../src/cli/commands/api";
import { changelogCommand } from "../../../src/cli/commands/changelog";
import { diagramCommand } from "../../../src/cli/commands/diagram";
import { annotateCommand } from "../../../src/cli/commands/annotate";
import { MockGenerator } from "../../../src/cli/mock-generator";
import { defaultConfig } from "../../../src/config/loader";
import {
  hasGenerationInput,
  toWriteDocOptions,
} from "../../../src/cli/context";
import * as commandContext from "../../../src/cli/context";
import * as analyzer from "../../../src/core/analyzer";
import * as path from "path";
import { Project, SyntaxKind } from "ts-morph";

describe("Action-compatible generation commands", () => {
  it.each([
    ["readme", readmeCommand],
    ["api", apiCommand],
    ["changelog", changelogCommand],
    ["diagram", diagramCommand],
  ])("%s exposes non-interactive strict writes", (_name, command) => {
    expect(command.options.some((option) => option.long === "--yes")).toBe(
      true,
    );
    expect(
      command.options.some((option) => option.long === "--strict-output"),
    ).toBe(true);
  });

  it("maps CI flags to the existing write boundary", () => {
    expect(
      toWriteDocOptions(
        { yes: true, dryRun: false, strictOutput: true },
        "README.md",
      ),
    ).toEqual({
      auto: true,
      dryRun: false,
      label: "README.md",
      strict: true,
    });
  });

  it("turns missing generation input into a strict CI failure", () => {
    expect(() =>
      hasGenerationInput(
        false,
        { strictOutput: true },
        "No supported source files found",
      ),
    ).toThrow(/No supported source files/);
    expect(
      hasGenerationInput(false, {}, "No supported source files found"),
    ).toBe(false);
  });

  it.each(["readme", "api", "changelog", "diagram"])(
    "%s forwards command flags through the shared write adapter",
    (name) => {
      const project = new Project({
        tsConfigFilePath: path.resolve("tsconfig.json"),
      });
      const source = project.getSourceFileOrThrow(
        path.resolve(`src/cli/commands/${name}.ts`),
      );
      const forwardsOptions = source
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .some(
          (call) =>
            call.getExpression().getText() === "toWriteDocOptions" &&
            call.getArguments()[0]?.getText() === "options",
        );
      expect(forwardsOptions).toBe(true);
      expect(
        source
          .getDescendantsOfKind(SyntaxKind.CallExpression)
          .some(
            (call) => call.getExpression().getText() === "hasGenerationInput",
          ),
      ).toBe(true);
    },
  );
});

describe("annotate command diagnostics", () => {
  it("reports malformed annotation JSON without the raw provider response", async () => {
    const fakeKey = ["sk", "proj", "A".repeat(32)].join("-");
    const generator = new MockGenerator();
    const generate = jest
      .spyOn(generator, "generateJsDoc")
      .mockResolvedValue(`not valid JSON ${fakeKey}`);
    const loadContext = jest
      .spyOn(commandContext, "loadCommandContext")
      .mockResolvedValue({
        config: defaultConfig,
        cwd: process.cwd(),
        generator,
        isMock: true,
      });
    const analyze = jest.spyOn(analyzer, "analyzeCodebase").mockResolvedValue([
      {
        filePath: path.resolve("src/example.ts"),
        language: "typescript",
        functions: [
          {
            name: "example",
            parameters: [],
            returnType: "void",
            isAsync: false,
            isExported: true,
            lineRange: [1, 1],
            signature: "export function example(): void",
          },
        ],
        classes: [],
        types: [],
        imports: [],
      },
    ]);
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const exit = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    try {
      await annotateCommand.parseAsync(["--all"], { from: "user" });

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(
        "LLM returned malformed JSON for annotations. Try again or use --mock.",
      );
      expect(String(consoleError.mock.calls[0]?.[0])).not.toContain(fakeKey);
    } finally {
      generate.mockRestore();
      loadContext.mockRestore();
      analyze.mockRestore();
      consoleError.mockRestore();
      exit.mockRestore();
    }
  });
});
