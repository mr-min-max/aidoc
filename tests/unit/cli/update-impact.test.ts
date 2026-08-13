import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as commandContext from "../../../src/cli/context";
import {
  executeUpdateCommand,
  updateCommand,
} from "../../../src/cli/commands/update";
import { defaultConfig } from "../../../src/config/loader";
import * as impactPlanner from "../../../src/impact/planner";
import * as targetResolver from "../../../src/impact/targets";
import type {
  ImpactPlan,
  ImpactPlanningResult,
  ImpactProviderContext,
} from "../../../src/impact/types";
import * as providerRegistry from "../../../src/providers/registry";
import * as providerSelection from "../../../src/providers/selection";
import type { ProviderPrompter } from "../../../src/providers/selection";
import {
  selectUpdateTargets,
  type UpdateSelectionRuntime,
} from "../../../src/cli/update-target-selection";
import type { ResolvedDocumentationTarget } from "../../../src/impact/targets";
import {
  RepositoryWriteError,
  TrustViolationError,
} from "../../../src/security/types";
import { RepositoryWriteScope } from "../../../src/security/repository-writer";

const byCategory = {
  added: 0,
  removed: 0,
  moved: 0,
  "contract-changed": 1,
  "implementation-changed": 0,
  "documentation-changed": 0,
  "dependency-changed": 0,
} as const;

function planningResult(hasImpact: boolean): ImpactPlanningResult {
  const change = {
    scope: "symbol" as const,
    id: "typescript:src/index.ts#function:greet",
    category: "contract-changed" as const,
    risk: "potentially-breaking" as const,
    language: "typescript" as const,
    path: "src/index.ts",
    kind: "function" as const,
    qualifiedName: "greet",
    changedContractFacets: ["parameters" as const],
    digest: "b".repeat(64),
  };
  const documentation = hasImpact
    ? [
        {
          changeId: change.id,
          directReferences: [
            {
              file: "README.md",
              section: "API",
              slug: "api",
              reason: "code-span" as const,
            },
          ],
          recommendations: [],
          unmapped: false,
        },
      ]
    : [];
  const summary = {
    totalChanges: hasImpact ? 1 : 0,
    publicApiChanges: hasImpact ? 1 : 0,
    potentiallyBreaking: hasImpact ? 1 : 0,
    reviewRequired: 0,
    informational: 0,
    unmapped: 0,
    byCategory: hasImpact
      ? byCategory
      : { ...byCategory, "contract-changed": 0 },
  };
  const providerContext: ImpactProviderContext = {
    schemaVersion: "aidoc.impact-context.v1",
    impactDigest: "c".repeat(64),
    summary,
    changes: hasImpact
      ? [
          {
            id: change.id,
            category: change.category,
            risk: change.risk,
            path: change.path,
            kind: change.kind,
            qualifiedName: change.qualifiedName,
            changedContractFacets: change.changedContractFacets,
          },
        ]
      : [],
    documentation,
    omittedRecords: 0,
  };
  const plan: ImpactPlan = {
    schemaVersion: "aidoc.impact-plan.v1",
    base: { type: "git", label: "HEAD~1", commit: "d".repeat(40) },
    head: { type: "working-tree", label: "working-tree" },
    summary,
    changes: hasImpact ? [change] : [],
    documentation,
    context: {
      maxBytes: 12000,
      usedBytes: 512,
      totalRecords: hasImpact ? 1 : 0,
      includedRecords: hasImpact ? 1 : 0,
      omittedRecords: 0,
      impactDigest: providerContext.impactDigest,
    },
    ignored: { unsupported: 0, excluded: 0 },
    digest: providerContext.impactDigest,
  };
  return { plan, providerContext };
}

function providerPrompter(
  overrides: Partial<ProviderPrompter> = {},
): ProviderPrompter {
  return {
    chooseProvider: jest.fn().mockResolvedValue(null),
    chooseOllamaModel: jest.fn().mockResolvedValue(null),
    configureQwen: jest.fn().mockResolvedValue(null),
    confirmBoundary: jest.fn().mockResolvedValue(false),
    rememberSelection: jest.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe("update impact flow", () => {
  let root: string;
  let consoleLog: jest.SpyInstance;
  let _consoleError: jest.SpyInstance;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "aidoc-update-cli-"));
    writeFileSync(join(root, "README.md"), "# Existing\n");
    consoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
    _consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  // Break caught: provider bootstrap happens before deterministic planning and
  // a fatal parse/planning failure can still reach credentials or the LLM.
  it("returns failure without loading provider context when planning fails", async () => {
    jest
      .spyOn(impactPlanner, "createImpactPlan")
      .mockRejectedValue(new Error("planning failed"));
    const loadContext = jest.spyOn(commandContext, "loadCommandContext");
    const createProvider = jest.spyOn(providerRegistry, "createProvider");

    expect(await executeUpdateCommand({}, root)).toBe(1);

    expect(loadContext).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
  });

  // Break caught: a complete zero-impact plan still constructs a provider and
  // sends a meaningless update request.
  it("stops after a concise zero-impact summary with no provider calls", async () => {
    jest
      .spyOn(impactPlanner, "createImpactPlan")
      .mockResolvedValue(planningResult(false));
    const loadContext = jest.spyOn(commandContext, "loadCommandContext");
    const openScope = jest.spyOn(RepositoryWriteScope, "open");
    const resolveTargets = jest.spyOn(
      targetResolver,
      "resolveDocumentationTargets",
    );

    expect(await executeUpdateCommand({}, root)).toBe(0);

    expect(loadContext).not.toHaveBeenCalled();
    expect(openScope).not.toHaveBeenCalled();
    expect(resolveTargets).not.toHaveBeenCalled();
    expect(consoleLog.mock.calls.flat().join("\n")).toContain(
      "No documentation updates are indicated.",
    );
  });

  // Break caught: compatibility flags diverge or ambiguous values silently
  // select one Git base.
  it("maps base and since aliases and rejects conflicts before planning", async () => {
    const createPlan = jest
      .spyOn(impactPlanner, "createImpactPlan")
      .mockResolvedValue(planningResult(false));

    expect(await executeUpdateCommand({ base: "main" }, root)).toBe(0);
    expect(await executeUpdateCommand({ since: "release" }, root)).toBe(0);
    expect(
      await executeUpdateCommand(
        { base: "origin/main", since: "origin/main" },
        root,
      ),
    ).toBe(0);
    expect(createPlan.mock.calls.map(([options]) => options.base)).toEqual([
      "main",
      "release",
      "origin/main",
    ]);

    createPlan.mockClear();
    expect(
      await executeUpdateCommand({ base: "main", since: "release" }, root),
    ).toBe(1);
    expect(createPlan).not.toHaveBeenCalled();
  });

  // Break caught: update reads the output path independently instead of using
  // the prepared writer snapshot for both generation and replacement.
  it("uses one prepared snapshot for update generation and replacement", async () => {
    const result = planningResult(true);
    jest.spyOn(impactPlanner, "createImpactPlan").mockResolvedValue(result);
    const prepared = {
      displayPath: "README.md",
      existingText: "# Existing\n",
      replaceText: jest.fn(),
    };
    const openScope = jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({} as RepositoryWriteScope);
    const resolveTargets = jest
      .spyOn(targetResolver, "resolveDocumentationTargets")
      .mockResolvedValue([
        {
          path: "README.md",
          reasons: ["direct-reference"],
          sections: ["API"],
          prepared,
        },
      ]);
    const generateUpdate = jest.fn().mockResolvedValue("# Updated\n");
    jest.spyOn(commandContext, "loadCommandContext").mockResolvedValue({
      config: defaultConfig,
      cwd: root,
      generator: { generateUpdate } as never,
      isMock: true,
    });
    const writeDoc = jest
      .spyOn(commandContext, "writeDoc")
      .mockImplementation(async (target) => {
        await target.prepared!.replaceText("# Updated\n");
      });

    expect(await executeUpdateCommand({ mock: true }, root)).toBe(0);

    expect(openScope).toHaveBeenCalledWith(root);
    expect(resolveTargets).toHaveBeenCalled();
    expect(generateUpdate).toHaveBeenCalledWith({
      existingDoc: "# Existing\n",
      impactPlan: result.providerContext,
    });
    expect(writeDoc).toHaveBeenCalledWith(
      expect.objectContaining({ existingText: "# Existing\n" }),
      "# Updated\n",
      { auto: undefined, dryRun: undefined, strict: undefined },
    );
  });

  // Break caught: an unsafe update target bypasses repository containment and
  // reaches provider construction.
  it("rejects an unsafe target before provider construction", async () => {
    const scope = {} as RepositoryWriteScope;
    jest
      .spyOn(impactPlanner, "createImpactPlan")
      .mockResolvedValue(planningResult(true));
    jest.spyOn(RepositoryWriteScope, "open").mockResolvedValue(scope);
    const resolveTargets = jest
      .spyOn(targetResolver, "resolveDocumentationTargets")
      .mockRejectedValue(new RepositoryWriteError("TRUST_PATH_OUTSIDE_ROOT"));
    const generateUpdate = jest.fn().mockResolvedValue("# Updated\n");
    const loadContext = jest
      .spyOn(commandContext, "loadCommandContext")
      .mockResolvedValue({
        config: defaultConfig,
        cwd: root,
        generator: { generateUpdate } as never,
        isMock: false,
      });

    expect(await executeUpdateCommand({ target: "../outside.md" }, root)).toBe(
      2,
    );

    expect(RepositoryWriteScope.open).toHaveBeenCalledWith(root);
    expect(resolveTargets).toHaveBeenCalledWith(
      expect.objectContaining({
        scope,
        explicitTargets: ["../outside.md"],
      }),
    );
    expect(loadContext).not.toHaveBeenCalled();
    expect(generateUpdate).not.toHaveBeenCalled();
  });

  // Break caught: the update wrapper collapses Trust Gate rejection to the
  // ordinary provider failure status.
  it("preserves exit 2 for strict Trust Gate rejection", async () => {
    const scope = {} as RepositoryWriteScope;
    jest
      .spyOn(impactPlanner, "createImpactPlan")
      .mockResolvedValue(planningResult(true));
    jest.spyOn(RepositoryWriteScope, "open").mockResolvedValue(scope);
    const resolveTargets = jest
      .spyOn(targetResolver, "resolveDocumentationTargets")
      .mockResolvedValue([
        {
          path: "README.md",
          reasons: ["direct-reference"],
          sections: ["API"],
          prepared: {
            displayPath: "README.md",
            existingText: "# Existing\n",
            replaceText: jest.fn(),
          },
        },
      ]);
    const generateUpdate = jest
      .fn()
      .mockRejectedValue(new TrustViolationError([]));
    const loadContext = jest
      .spyOn(commandContext, "loadCommandContext")
      .mockResolvedValue({
        config: defaultConfig,
        cwd: root,
        generator: { generateUpdate } as never,
        isMock: false,
      });

    expect(await executeUpdateCommand({}, root)).toBe(2);
    expect(resolveTargets).toHaveBeenCalledWith(
      expect.objectContaining({ scope }),
    );
    expect(loadContext).toHaveBeenCalledWith(
      {},
      root,
      expect.objectContaining({
        interactive: false,
        beforeProviderCreate: expect.any(Function),
      }),
    );
    expect(generateUpdate).toHaveBeenCalledTimes(1);
  });

  it("registers impact, target, provider, and write options explicitly", () => {
    expect(updateCommand.options.map((option) => option.flags)).toEqual([
      "--base <ref>",
      "--since <ref>",
      "--target <file>",
      "--all",
      "--provider <name>",
      "--model <model>",
      "--provider-base-url <url>",
      "--allow-local-http",
      "--yes",
      "--dry-run",
      "--mock",
    ]);
  });

  it("confirms the selected boundary before construction, generation, preview, and write", async () => {
    const events: string[] = [];
    const result = planningResult(true);
    jest
      .spyOn(impactPlanner, "createImpactPlan")
      .mockImplementation(async () => {
        events.push("plan");
        return result;
      });
    jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({} as RepositoryWriteScope);
    jest
      .spyOn(targetResolver, "resolveDocumentationTargets")
      .mockImplementation(async () => {
        events.push("prepare:README.md");
        return [
          {
            ...candidate("README.md"),
            prepared: {
              displayPath: "README.md",
              existingText: "# README.md\n",
              replaceText: jest.fn(async () => {
                events.push("write:README.md");
              }),
            },
          },
        ];
      });
    const selection = {
      provider: "openai",
      model: "gpt-5.6-luna",
      source: "command" as const,
      boundary: "remote" as const,
      credentialEnv: "OPENAI_API_KEY",
    };
    jest
      .spyOn(providerSelection, "confirmProviderBoundary")
      .mockImplementation(async (input) => {
        events.push("confirm-boundary");
        expect(input).toMatchObject({
          selection,
          targetPaths: ["README.md"],
          contextBytes: 512,
          trustPolicy: "redact",
          interactive: true,
          yes: false,
        });
        return true;
      });
    const generateUpdate = jest.fn().mockImplementation(async () => {
      events.push("generate:README.md");
      return "# Updated\n";
    });
    jest
      .spyOn(commandContext, "loadCommandContext")
      .mockImplementation(async (_options, _cwd, runtime) => {
        events.push("select-provider");
        await runtime?.beforeProviderCreate?.(selection, defaultConfig);
        events.push("construct-provider");
        return {
          config: defaultConfig,
          cwd: root,
          generator: { generateUpdate } as never,
          isMock: false,
          selection,
        };
      });
    jest
      .spyOn(commandContext, "writeDoc")
      .mockImplementation(async (target, content) => {
        events.push(`preview:${target.displayPath}`);
        await target.prepared!.replaceText(content);
      });

    await expect(
      executeUpdateCommand({ provider: "openai" }, root, {
        interactive: true,
        choose: jest.fn(),
        providerPrompter: providerPrompter(),
      }),
    ).resolves.toBe(0);

    expect(events).toEqual([
      "plan",
      "prepare:README.md",
      "select-provider",
      "confirm-boundary",
      "construct-provider",
      "generate:README.md",
      "preview:README.md",
      "write:README.md",
    ]);
  });

  it("treats a declined provider boundary as cancellation before construction", async () => {
    jest
      .spyOn(impactPlanner, "createImpactPlan")
      .mockResolvedValue(planningResult(true));
    jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({} as RepositoryWriteScope);
    jest
      .spyOn(targetResolver, "resolveDocumentationTargets")
      .mockResolvedValue([candidate("README.md")]);
    const selection = {
      provider: "openai",
      model: "gpt-5.6-luna",
      source: "command" as const,
      boundary: "remote" as const,
      credentialEnv: "OPENAI_API_KEY",
    };
    jest
      .spyOn(providerSelection, "confirmProviderBoundary")
      .mockResolvedValue(false);
    const construct = jest.fn();
    jest
      .spyOn(commandContext, "loadCommandContext")
      .mockImplementation(async (_options, _cwd, runtime) => {
        await runtime?.beforeProviderCreate?.(selection, defaultConfig);
        construct();
        throw new Error("unreachable");
      });
    const writeDoc = jest.spyOn(commandContext, "writeDoc");

    await expect(
      executeUpdateCommand({ provider: "openai" }, root, {
        interactive: true,
        choose: jest.fn(),
        providerPrompter: providerPrompter(),
      }),
    ).resolves.toBe(0);

    expect(construct).not.toHaveBeenCalled();
    expect(writeDoc).not.toHaveBeenCalled();
    expect(consoleLog.mock.calls.flat().join(" ")).toContain(
      "No model request was sent",
    );
  });

  it("persists only an explicitly remembered interactive selection", async () => {
    jest
      .spyOn(impactPlanner, "createImpactPlan")
      .mockResolvedValue(planningResult(true));
    jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({} as RepositoryWriteScope);
    jest
      .spyOn(targetResolver, "resolveDocumentationTargets")
      .mockResolvedValue([candidate("README.md")]);
    const selection = {
      provider: "openai",
      model: "gpt-5.6-luna",
      source: "interactive" as const,
      boundary: "remote" as const,
      credentialEnv: "OPENAI_API_KEY",
    };
    jest
      .spyOn(providerSelection, "confirmProviderBoundary")
      .mockResolvedValue(true);
    jest
      .spyOn(commandContext, "loadCommandContext")
      .mockImplementation(async (_options, _cwd, runtime) => {
        await runtime?.beforeProviderCreate?.(selection, defaultConfig);
        return {
          config: defaultConfig,
          cwd: root,
          generator: {
            generateUpdate: jest.fn().mockResolvedValue("# Updated\n"),
          } as never,
          isMock: false,
          selection,
        };
      });
    jest.spyOn(commandContext, "writeDoc").mockResolvedValue(undefined);
    const remember = jest.fn().mockResolvedValue(undefined);
    const prompt = providerPrompter({
      rememberSelection: jest.fn().mockResolvedValue(true),
    });

    await expect(
      executeUpdateCommand({}, root, {
        interactive: true,
        choose: jest.fn(),
        providerPrompter: prompt,
        rememberProviderSelection: remember,
      }),
    ).resolves.toBe(0);

    expect(prompt.rememberSelection).toHaveBeenCalledTimes(1);
    expect(remember).toHaveBeenCalledWith(root, selection, undefined);
  });
});

function candidate(path: string): ResolvedDocumentationTarget {
  return {
    path,
    reasons: ["direct-reference"],
    sections: ["API"],
    prepared: {
      displayPath: path,
      existingText: `# ${path}\n`,
      replaceText: jest.fn(),
    },
  };
}

describe("update target selection", () => {
  it("returns explicit and all selections without prompting", async () => {
    const candidates = [candidate("README.md"), candidate("docs/API.md")];
    const choose = jest.fn();

    await expect(
      selectUpdateTargets({
        candidates,
        explicit: true,
        all: false,
        runtime: { interactive: true, choose },
      }),
    ).resolves.toEqual(candidates);
    await expect(
      selectUpdateTargets({
        candidates,
        explicit: false,
        all: true,
        runtime: { interactive: true, choose },
      }),
    ).resolves.toEqual(candidates);
    expect(choose).not.toHaveBeenCalled();
  });

  it("rejects ambiguous non-interactive automatic selection", async () => {
    await expect(
      selectUpdateTargets({
        candidates: [candidate("README.md"), candidate("docs/API.md")],
        explicit: false,
        all: false,
        runtime: { interactive: false, choose: jest.fn() },
      }),
    ).rejects.toThrow("--target");
  });

  it("uses interactive multiselect results and treats cancellation as empty", async () => {
    const candidates = [candidate("README.md"), candidate("docs/API.md")];
    const choose: UpdateSelectionRuntime["choose"] = jest
      .fn()
      .mockResolvedValueOnce(["docs/API.md"])
      .mockResolvedValueOnce([]);
    const runtime = { interactive: true, choose };

    await expect(
      selectUpdateTargets({
        candidates,
        explicit: false,
        all: false,
        runtime,
      }),
    ).resolves.toEqual([candidates[1]]);
    await expect(
      selectUpdateTargets({
        candidates,
        explicit: false,
        all: false,
        runtime,
      }),
    ).resolves.toEqual([]);
  });
});

describe("multi-target update ordering", () => {
  let root: string;
  let consoleLog: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "aidoc-update-targets-"));
    consoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
    consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  function multiTargetResult(): ImpactPlanningResult {
    const result = planningResult(true);
    const documentation = [
      result.plan.documentation[0]!,
      {
        ...result.plan.documentation[0]!,
        directReferences: [
          {
            ...result.plan.documentation[0]!.directReferences[0]!,
            file: "docs/API.md",
          },
        ],
      },
    ];
    result.plan.documentation = documentation;
    result.providerContext.documentation = documentation;
    return result;
  }

  function targets(events: string[]) {
    return ["README.md", "docs/API.md"].map((path) => ({
      path,
      reasons: ["direct-reference" as const],
      sections: ["API"],
      prepared: {
        displayPath: path,
        existingText: `# ${path}\n`,
        replaceText: jest.fn(async () => events.push(`write:${path}`)),
      },
    }));
  }

  it("prepares every target before provider context construction", async () => {
    const events: string[] = [];
    const result = multiTargetResult();
    jest
      .spyOn(impactPlanner, "createImpactPlan")
      .mockImplementation(async () => {
        events.push("plan");
        return result;
      });
    jest.spyOn(RepositoryWriteScope, "open").mockImplementation(async () => {
      events.push("scope");
      return {} as RepositoryWriteScope;
    });
    jest
      .spyOn(targetResolver, "resolveDocumentationTargets")
      .mockImplementation(async () => {
        events.push("prepare:README.md");
        events.push("prepare:docs/API.md");
        return targets(events);
      });
    const generateUpdate = jest.fn().mockImplementation(async (context) => {
      events.push(
        `generate:${context.impactPlan.documentation[0]?.directReferences[0]?.file}`,
      );
      return "# Updated\n";
    });
    jest
      .spyOn(commandContext, "loadCommandContext")
      .mockImplementation(async () => {
        events.push("provider");
        return {
          config: defaultConfig,
          cwd: root,
          generator: { generateUpdate } as never,
          isMock: true,
        };
      });
    jest
      .spyOn(commandContext, "writeDoc")
      .mockImplementation(async (target) => {
        await target.prepared!.replaceText("# Updated\n");
      });

    await expect(
      executeUpdateCommand({ all: true, mock: true, yes: true }, root),
    ).resolves.toBe(0);

    expect(events.slice(0, 5)).toEqual([
      "plan",
      "scope",
      "prepare:README.md",
      "prepare:docs/API.md",
      "provider",
    ]);
    expect(events).toEqual([
      "plan",
      "scope",
      "prepare:README.md",
      "prepare:docs/API.md",
      "provider",
      "generate:README.md",
      "write:README.md",
      "generate:docs/API.md",
      "write:docs/API.md",
    ]);
    expect(commandContext.writeDoc).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "# Updated\n",
      { auto: true, dryRun: undefined, strict: undefined },
    );
  });

  it("fails ambiguous non-interactive updates before loading a provider", async () => {
    const result = multiTargetResult();
    jest.spyOn(impactPlanner, "createImpactPlan").mockResolvedValue(result);
    jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({} as RepositoryWriteScope);
    jest
      .spyOn(targetResolver, "resolveDocumentationTargets")
      .mockResolvedValue(targets([]));
    const loadContext = jest.spyOn(commandContext, "loadCommandContext");

    await expect(
      executeUpdateCommand({ mock: true }, root, {
        interactive: false,
        choose: jest.fn(),
      }),
    ).resolves.toBe(1);

    expect(loadContext).not.toHaveBeenCalled();
    expect(consoleError.mock.calls.flat().join(" ")).toContain("--target");
  });

  it("treats empty interactive selection as cancellation before provider construction", async () => {
    const result = multiTargetResult();
    jest.spyOn(impactPlanner, "createImpactPlan").mockResolvedValue(result);
    jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({} as RepositoryWriteScope);
    jest
      .spyOn(targetResolver, "resolveDocumentationTargets")
      .mockResolvedValue(targets([]));
    const loadContext = jest.spyOn(commandContext, "loadCommandContext");

    await expect(
      executeUpdateCommand({ mock: true }, root, {
        interactive: true,
        choose: jest.fn().mockResolvedValue([]),
      }),
    ).resolves.toBe(0);

    expect(loadContext).not.toHaveBeenCalled();
  });

  it("keeps accepted progress and skips later targets after cancellation", async () => {
    const events: string[] = [];
    const result = multiTargetResult();
    jest.spyOn(impactPlanner, "createImpactPlan").mockResolvedValue(result);
    jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({} as RepositoryWriteScope);
    const resolvedTargets = [
      ...targets(events),
      {
        path: "docs/Guide.md",
        reasons: ["direct-reference" as const],
        sections: ["Guide"],
        prepared: {
          displayPath: "docs/Guide.md",
          existingText: "# Guide\n",
          replaceText: jest.fn(),
        },
      },
    ];
    jest
      .spyOn(targetResolver, "resolveDocumentationTargets")
      .mockResolvedValue(resolvedTargets);
    const generateUpdate = jest
      .fn()
      .mockResolvedValueOnce("# First\n")
      .mockResolvedValueOnce("# Second\n");
    jest.spyOn(commandContext, "loadCommandContext").mockResolvedValue({
      config: defaultConfig,
      cwd: root,
      generator: { generateUpdate } as never,
      isMock: true,
    });
    jest
      .spyOn(commandContext, "writeDoc")
      .mockImplementation(async (target) => {
        if (target.displayPath === "README.md") {
          await target.prepared!.replaceText("# First\n");
        }
      });

    await expect(
      executeUpdateCommand({ all: true, mock: true }, root),
    ).resolves.toBe(0);

    expect(generateUpdate).toHaveBeenCalledTimes(2);
    expect(consoleLog.mock.calls.flat().join(" ")).toContain(
      "remaining targets were skipped",
    );
  });

  it("reports completed progress when a later target fails", async () => {
    const events: string[] = [];
    const result = multiTargetResult();
    jest.spyOn(impactPlanner, "createImpactPlan").mockResolvedValue(result);
    jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({} as RepositoryWriteScope);
    const resolvedTargets = [
      ...targets(events),
      {
        path: "docs/Guide.md",
        reasons: ["direct-reference" as const],
        sections: ["Guide"],
        prepared: {
          displayPath: "docs/Guide.md",
          existingText: "# Guide\n",
          replaceText: jest.fn(),
        },
      },
    ];
    jest
      .spyOn(targetResolver, "resolveDocumentationTargets")
      .mockResolvedValue(resolvedTargets);
    const generateUpdate = jest
      .fn()
      .mockImplementationOnce(async () => {
        events.push("generate:README.md");
        return "# First\n";
      })
      .mockImplementationOnce(async () => {
        events.push("generate:docs/API.md");
        throw new Error("provider failed");
      });
    jest.spyOn(commandContext, "loadCommandContext").mockResolvedValue({
      config: defaultConfig,
      cwd: root,
      generator: { generateUpdate } as never,
      isMock: true,
    });
    jest
      .spyOn(commandContext, "writeDoc")
      .mockImplementation(async (target) => {
        if (target.displayPath === "README.md") {
          await target.prepared!.replaceText("# First\n");
        }
      });

    await expect(
      executeUpdateCommand({ all: true, mock: true }, root),
    ).resolves.toBe(1);

    expect(generateUpdate).toHaveBeenCalledTimes(2);
    expect(events).toContain("generate:README.md");
    expect(events).toContain("generate:docs/API.md");
    expect(events).not.toContain("generate:docs/Guide.md");
    expect(events).toContain("write:README.md");
    expect(events).not.toContain("write:docs/API.md");
    expect(consoleLog.mock.calls.flat().join(" ")).toContain(
      "Partial update: 1 of 3 selected targets completed; remaining targets were skipped.",
    );
  });
});
