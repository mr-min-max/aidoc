import * as impactPlanner from "../../../src/impact/planner";
import * as targetResolver from "../../../src/impact/targets";
import * as updateCommandModule from "../../../src/cli/commands/update";
import { RepositoryWriteScope } from "../../../src/security/repository-writer";
import type {
  ImpactPlan,
  ImpactPlanningResult,
} from "../../../src/impact/types";
import {
  executeDefaultCommand,
  type DefaultCommandRuntime,
} from "../../../src/cli/commands/default";

function runtime(interactive: boolean): {
  runtime: DefaultCommandRuntime;
  stdout: string[];
  stderr: string[];
  confirmUpdate: jest.Mock;
  showHelp: jest.Mock;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const confirmUpdate = jest.fn();
  const showHelp = jest.fn();
  return {
    runtime: {
      interactive,
      confirmUpdate,
      showHelp,
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    },
    stdout,
    stderr,
    confirmUpdate,
    showHelp,
  };
}

function planningResult(impact: boolean): ImpactPlanningResult {
  const summary = {
    totalChanges: impact ? 1 : 0,
    publicApiChanges: impact ? 1 : 0,
    potentiallyBreaking: 0,
    reviewRequired: impact ? 1 : 0,
    informational: 0,
    unmapped: 0,
    byCategory: {
      added: 0,
      removed: 0,
      moved: 0,
      "contract-changed": impact ? 1 : 0,
      "implementation-changed": 0,
      "documentation-changed": 0,
      "dependency-changed": 0,
    },
  } as const;
  const change = {
    scope: "symbol" as const,
    id: "change-1",
    category: "contract-changed" as const,
    risk: "review-required" as const,
    language: "typescript" as const,
    path: "src/index.ts",
    kind: "function" as const,
    qualifiedName: "greet",
    digest: "a".repeat(64),
  };
  const documentation = impact
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
  const providerContext = {
    schemaVersion: "aidoc.impact-context.v1" as const,
    impactDigest: "b".repeat(64),
    summary,
    changes: impact
      ? [
          {
            id: change.id,
            category: change.category,
            risk: change.risk,
            path: change.path,
            kind: change.kind,
            qualifiedName: change.qualifiedName,
          },
        ]
      : [],
    documentation,
    omittedRecords: 0,
  };
  const plan: ImpactPlan = {
    schemaVersion: "aidoc.impact-plan.v1",
    base: { type: "git", label: "main", commit: "c".repeat(40) },
    head: { type: "working-tree", label: "working-tree" },
    summary,
    changes: impact ? [change] : [],
    documentation,
    context: {
      maxBytes: 12000,
      usedBytes: impact ? 100 : 0,
      totalRecords: impact ? 1 : 0,
      includedRecords: impact ? 1 : 0,
      omittedRecords: 0,
      impactDigest: providerContext.impactDigest,
    },
    ignored: { unsupported: 0, excluded: 0 },
    digest: providerContext.impactDigest,
  };
  return { plan, providerContext };
}

describe("default aidoc entry", () => {
  afterEach(() => jest.restoreAllMocks());

  it("shows concise help and does not plan in a non-interactive shell", async () => {
    const io = runtime(false);
    const createPlan = jest.spyOn(impactPlanner, "createImpactPlan");

    await expect(
      executeDefaultCommand(io.runtime, "/tmp/project"),
    ).resolves.toBe(0);

    expect(io.showHelp).toHaveBeenCalledTimes(1);
    expect(io.confirmUpdate).not.toHaveBeenCalled();
    expect(createPlan).not.toHaveBeenCalled();
    expect(io.stdout).toEqual([]);
  });

  it("prints the deterministic plan and stops on interactive no-impact", async () => {
    const io = runtime(true);
    jest
      .spyOn(impactPlanner, "createImpactPlan")
      .mockResolvedValue(planningResult(false));
    const open = jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({} as RepositoryWriteScope);
    const resolveTargets = jest
      .spyOn(targetResolver, "resolveDocumentationTargets")
      .mockResolvedValue([]);

    await expect(
      executeDefaultCommand(io.runtime, "/tmp/project"),
    ).resolves.toBe(0);

    expect(io.stdout.join("\n")).toContain(
      "No documentation updates are indicated.",
    );
    expect(io.confirmUpdate).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith("/tmp/project");
    expect(resolveTargets).toHaveBeenCalled();
  });

  it("asks once for an impacted safe plan and returns 0 when declined", async () => {
    const io = runtime(true);
    io.confirmUpdate.mockResolvedValue(false);
    jest
      .spyOn(impactPlanner, "createImpactPlan")
      .mockResolvedValue(planningResult(true));
    jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({} as RepositoryWriteScope);
    jest
      .spyOn(targetResolver, "resolveDocumentationTargets")
      .mockResolvedValue([
        {
          path: "README.md",
          reasons: ["direct-reference"],
          sections: ["API"],
          prepared: {
            displayPath: "README.md",
            existingText: "# README\n",
            replaceText: jest.fn(),
          },
        },
      ]);
    const update = jest.spyOn(updateCommandModule, "executeUpdateCommand");

    await expect(
      executeDefaultCommand(io.runtime, "/tmp/project"),
    ).resolves.toBe(0);

    expect(io.confirmUpdate).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("delegates accepted interactive updates to the regular update command", async () => {
    const io = runtime(true);
    io.confirmUpdate.mockResolvedValue(true);
    jest
      .spyOn(impactPlanner, "createImpactPlan")
      .mockResolvedValue(planningResult(true));
    jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({} as RepositoryWriteScope);
    jest
      .spyOn(targetResolver, "resolveDocumentationTargets")
      .mockResolvedValue([
        {
          path: "README.md",
          reasons: ["direct-reference"],
          sections: ["API"],
          prepared: {
            displayPath: "README.md",
            existingText: "# README\n",
            replaceText: jest.fn(),
          },
        },
      ]);
    const update = jest
      .spyOn(updateCommandModule, "executeUpdateCommand")
      .mockResolvedValue(0);

    await expect(
      executeDefaultCommand(io.runtime, "/tmp/project"),
    ).resolves.toBe(0);

    expect(update).toHaveBeenCalledWith({}, "/tmp/project");
  });

  it("prints a stable diagnostic and returns 1 when planning fails", async () => {
    const io = runtime(true);
    jest
      .spyOn(impactPlanner, "createImpactPlan")
      .mockRejectedValue(new Error("hostile planning details"));

    await expect(
      executeDefaultCommand(io.runtime, "/tmp/project"),
    ).resolves.toBe(1);

    expect(io.stderr).toEqual([
      "PLAN_SOURCE_READ_FAILED: Documentation impact planning failed.\n",
    ]);
    expect(io.stdout).toEqual([]);
  });
});
