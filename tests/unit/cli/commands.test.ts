import { readmeCommand } from "../../../src/cli/commands/readme";
import { apiCommand } from "../../../src/cli/commands/api";
import { changelogCommand } from "../../../src/cli/commands/changelog";
import { diagramCommand } from "../../../src/cli/commands/diagram";
import {
  hasGenerationInput,
  toWriteDocOptions,
} from "../../../src/cli/context";
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
