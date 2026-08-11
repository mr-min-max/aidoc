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
import type {
  ImpactPlan,
  ImpactPlanningResult,
  ImpactProviderContext,
} from "../../../src/impact/types";
import * as providerRegistry from "../../../src/providers/registry";
import {
  RepositoryWriteError,
  TrustViolationError,
} from "../../../src/security/types";

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
    const prepareTarget = jest.spyOn(commandContext, "prepareDocumentTarget");

    expect(await executeUpdateCommand({}, root)).toBe(0);

    expect(loadContext).not.toHaveBeenCalled();
    expect(prepareTarget).not.toHaveBeenCalled();
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
    writeFileSync(join(root, "README.md"), "# Live read must be ignored\n");
    jest.spyOn(impactPlanner, "createImpactPlan").mockResolvedValue(result);
    const target = {
      displayPath: "README.md",
      existingText: "# Existing\n",
      prepared: { replaceText: jest.fn() },
    };
    const prepareDocumentTarget = jest
      .spyOn(commandContext, "prepareDocumentTarget")
      .mockResolvedValue(target as never);
    const generateUpdate = jest.fn().mockResolvedValue("# Updated\n");
    jest.spyOn(commandContext, "loadCommandContext").mockResolvedValue({
      config: defaultConfig,
      cwd: root,
      generator: { generateUpdate } as never,
      isMock: true,
    });
    const writeDoc = jest
      .spyOn(commandContext, "writeDoc")
      .mockResolvedValue(undefined);

    expect(await executeUpdateCommand({ mock: true }, root)).toBe(0);

    expect(prepareDocumentTarget).toHaveBeenCalledWith(
      root,
      "./README.md",
      false,
    );
    expect(generateUpdate).toHaveBeenCalledWith({
      existingDoc: "# Existing\n",
      impactPlan: result.providerContext,
    });
    expect(writeDoc).toHaveBeenCalledWith(
      expect.objectContaining({ existingText: "# Existing\n" }),
      "# Updated\n",
      { dryRun: false },
    );
  });

  // Break caught: an unsafe update target reaches provider construction and
  // generation before repository containment rejects it.
  it("rejects an unsafe target before provider construction", async () => {
    jest
      .spyOn(impactPlanner, "createImpactPlan")
      .mockResolvedValue(planningResult(true));
    jest
      .spyOn(commandContext, "prepareDocumentTarget")
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

    expect(loadContext).not.toHaveBeenCalled();
    expect(generateUpdate).not.toHaveBeenCalled();
  });

  // Break caught: the update wrapper collapses Trust Gate rejection to the
  // ordinary provider failure status.
  it("preserves exit 2 for strict Trust Gate rejection", async () => {
    jest
      .spyOn(impactPlanner, "createImpactPlan")
      .mockResolvedValue(planningResult(true));
    const generateUpdate = jest
      .fn()
      .mockRejectedValue(new TrustViolationError([]));
    jest.spyOn(commandContext, "loadCommandContext").mockResolvedValue({
      config: defaultConfig,
      cwd: root,
      generator: { generateUpdate } as never,
      isMock: false,
    });

    expect(await executeUpdateCommand({}, root)).toBe(2);
  });

  it("registers base and since as explicit compatibility aliases", () => {
    expect(updateCommand.options.map((option) => option.flags)).toEqual([
      "--base <ref>",
      "--since <ref>",
      "--target <file>",
      "--dry-run",
      "--mock",
    ]);
  });
});
