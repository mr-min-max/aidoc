import { readmeCommand } from "../../../src/cli/commands/readme";
import { apiCommand } from "../../../src/cli/commands/api";
import { changelogCommand } from "../../../src/cli/commands/changelog";
import { diagramCommand } from "../../../src/cli/commands/diagram";
import { annotateCommand } from "../../../src/cli/commands/annotate";
import { updateCommand } from "../../../src/cli/commands/update";
import { MockGenerator } from "../../../src/cli/mock-generator";
import { defaultConfig } from "../../../src/config/loader";
import {
  RepositoryWriteError,
  TrustViolationError,
} from "../../../src/security/types";
import { RepositoryWriteScope } from "../../../src/security/repository-writer";
import {
  hasGenerationInput,
  toWriteDocOptions,
} from "../../../src/cli/context";
import * as commandContext from "../../../src/cli/context";
import * as analyzer from "../../../src/core/analyzer";
import * as impactPlanner from "../../../src/impact/planner";
import type { ImpactPlanningResult } from "../../../src/impact/types";
import * as path from "path";
import { Project, SyntaxKind } from "ts-morph";

function updatePlanningResult(): ImpactPlanningResult {
  const summary = {
    totalChanges: 1,
    publicApiChanges: 1,
    potentiallyBreaking: 0,
    reviewRequired: 1,
    informational: 0,
    unmapped: 1,
    byCategory: {
      added: 0,
      removed: 0,
      moved: 0,
      "contract-changed": 1,
      "implementation-changed": 0,
      "documentation-changed": 0,
      "dependency-changed": 0,
    },
  };
  const change = {
    scope: "symbol" as const,
    id: "typescript:src/index.ts#function:greet",
    category: "contract-changed" as const,
    risk: "review-required" as const,
    language: "typescript" as const,
    path: "src/index.ts",
    kind: "function" as const,
    qualifiedName: "greet",
    changedContractFacets: ["parameters" as const],
    digest: "a".repeat(64),
  };
  const documentation = [
    {
      changeId: change.id,
      directReferences: [],
      recommendations: [],
      unmapped: true,
    },
  ];
  const impactDigest = "b".repeat(64);
  return {
    plan: {
      schemaVersion: "aidoc.impact-plan.v1",
      base: { type: "git", label: "HEAD~1", commit: "c".repeat(40) },
      head: { type: "working-tree", label: "working-tree" },
      summary,
      changes: [change],
      documentation,
      context: {
        maxBytes: 12000,
        usedBytes: 512,
        totalRecords: 1,
        includedRecords: 1,
        omittedRecords: 0,
        impactDigest,
      },
      ignored: { unsupported: 0, excluded: 0 },
      digest: impactDigest,
    },
    providerContext: {
      schemaVersion: "aidoc.impact-context.v1",
      impactDigest,
      summary,
      changes: [
        {
          id: change.id,
          category: change.category,
          risk: change.risk,
          path: change.path,
          kind: change.kind,
          qualifiedName: change.qualifiedName,
          changedContractFacets: change.changedContractFacets,
        },
      ],
      documentation,
      omittedRecords: 0,
    },
  };
}

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
      toWriteDocOptions({ yes: true, dryRun: false, strictOutput: true }),
    ).toEqual({
      auto: true,
      dryRun: false,
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
  it("rejects an unsafe source target before provider transport", async () => {
    const generator = new MockGenerator();
    const generate = jest.spyOn(generator, "generateJsDoc");
    const loadContext = jest
      .spyOn(commandContext, "loadCommandContext")
      .mockResolvedValue({
        config: defaultConfig,
        cwd: process.cwd(),
        generator,
        isMock: true,
      });
    const unsafe = path.resolve("src/unsafe.ts");
    const analyze = jest.spyOn(analyzer, "analyzeCodebase").mockResolvedValue([
      {
        filePath: unsafe,
        language: "typescript",
        functions: [
          {
            name: "unsafe",
            parameters: [],
            returnType: "void",
            isAsync: false,
            isExported: true,
            lineRange: [1, 1],
            signature: "export function unsafe(): void",
          },
        ],
        classes: [],
        types: [],
        imports: [],
      },
    ]);
    const prepare = jest
      .fn()
      .mockRejectedValue(new RepositoryWriteError("TRUST_PATH_OUTSIDE_ROOT"));
    const open = jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({ prepare } as unknown as RepositoryWriteScope);
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const exit = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    try {
      await annotateCommand.parseAsync(["--all"], { from: "user" });

      expect(open).toHaveBeenCalledTimes(1);
      expect(prepare).toHaveBeenCalledWith(unsafe);
      expect(generate).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(2);
    } finally {
      generate.mockRestore();
      loadContext.mockRestore();
      analyze.mockRestore();
      open.mockRestore();
      consoleError.mockRestore();
      exit.mockRestore();
    }
  });

  it("contains no direct filesystem read or write bypass", () => {
    const project = new Project({
      tsConfigFilePath: path.resolve("tsconfig.json"),
    });
    const source = project.getSourceFileOrThrow(
      path.resolve("src/cli/commands/annotate.ts"),
    );
    const directCalls = source
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .map((call) => call.getExpression().getText())
      .filter((expression) =>
        ["fs.readFileSync", "fs.writeFileSync"].includes(expression),
      );

    expect(directCalls).toEqual([]);
  });

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
    const prepare = jest.fn().mockResolvedValue({
      displayPath: "src/example.ts",
      existingText: "export function example(): void {}\n",
      replaceText: jest.fn().mockResolvedValue(undefined),
    });
    const open = jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({ prepare } as unknown as RepositoryWriteScope);
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
      open.mockRestore();
      consoleError.mockRestore();
      exit.mockRestore();
    }
  });

  it("uses a fixed diagnostic when a command error message getter throws", async () => {
    const hostileSecret = ["sk", "proj", "C".repeat(32)].join("-");
    const hostileError = new Error("unused");
    Object.defineProperty(hostileError, "message", {
      get: () => {
        throw new Error(hostileSecret);
      },
    });
    const loadContext = jest
      .spyOn(commandContext, "loadCommandContext")
      .mockRejectedValue(hostileError);
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const exit = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    try {
      await expect(
        annotateCommand.parseAsync(["--all"], { from: "user" }),
      ).resolves.toBe(annotateCommand);
      expect(consoleError).toHaveBeenCalledWith("Unknown error.");
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      loadContext.mockRestore();
      consoleError.mockRestore();
      exit.mockRestore();
    }
  });
});

describe("generation command Trust Gate exits", () => {
  it.each([
    ["readme", readmeCommand],
    ["api", apiCommand],
    ["changelog", changelogCommand],
    ["diagram", diagramCommand],
    ["update", updateCommand],
    ["annotate", annotateCommand],
  ])(
    "maps a strict %s policy rejection to exit status 2",
    async (_, command) => {
      const plan =
        command === updateCommand
          ? jest
              .spyOn(impactPlanner, "createImpactPlan")
              .mockResolvedValue(updatePlanningResult())
          : undefined;
      const loadContext = jest
        .spyOn(commandContext, "loadCommandContext")
        .mockRejectedValue(new TrustViolationError([]));
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const exit = jest
        .spyOn(process, "exit")
        .mockImplementation((() => undefined) as never);

      try {
        await command.parseAsync([], { from: "user" });
        expect(exit).toHaveBeenCalledWith(2);
      } finally {
        plan?.mockRestore();
        loadContext.mockRestore();
        consoleError.mockRestore();
        exit.mockRestore();
      }
    },
  );

  it("maps an ordinary generation failure to exit status 1", async () => {
    const loadContext = jest
      .spyOn(commandContext, "loadCommandContext")
      .mockRejectedValue(new Error("provider unavailable"));
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const exit = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    try {
      await readmeCommand.parseAsync([], { from: "user" });
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      loadContext.mockRestore();
      consoleError.mockRestore();
      exit.mockRestore();
    }
  });
});
