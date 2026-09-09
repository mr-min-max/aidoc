import { getGitRoot } from "../git/history";
import type {
  AuthorizedMCPDirectory,
  MCPRepositoryReadScope,
} from "./repository-scope";
import {
  assessDocumentationFreshness,
  type FreshnessReport,
} from "../core/freshness";
import { discoverReadme, createImpactPlan } from "../impact/planner";
import { toPlanError } from "../impact/canonical";
import type { PlanningConfig } from "../config/planning";
import { MCPRepositoryScopeError } from "./repository-scope";

/** Checks documentation freshness through the authorized scope and shared plan. */
export async function checkMCPDocumentationFreshness(input: {
  readonly scope: MCPRepositoryReadScope;
  readonly serverCwd: string;
  readonly directory: AuthorizedMCPDirectory;
  readonly docFile: unknown;
  readonly since: unknown;
  readonly planningConfig: Readonly<PlanningConfig>;
}): Promise<FreshnessReport> {
  let targetPath = input.docFile;
  if (targetPath === undefined) {
    const root = await getGitRoot(input.serverCwd);
    targetPath = (await discoverReadme(root)) ?? "README.md";
  }
  const targetFile = await input.scope.readOptionalFile(
    input.docFile === undefined ? input.scope.rootDirectory() : input.directory,
    targetPath,
  );
  const target = targetFile.displayPath;
  const since =
    input.since === undefined
      ? undefined
      : input.scope.validateGitRef(input.since, "");

  try {
    const planning = await createImpactPlan({
      cwd: input.serverCwd,
      base: since,
      planningConfig: input.planningConfig,
    });
    const changedFiles = await input.scope.changedFiles(
      input.scope.rootDirectory(),
      planning.plan.base.commit ?? planning.plan.base.label,
      planning.plan.head.type === "working-tree"
        ? undefined
        : (planning.plan.head.commit ?? planning.plan.head.label),
    );
    return assessDocumentationFreshness({
      plan: planning.plan,
      changedFiles,
      target,
      targetExists: targetFile.content !== null,
    });
  } catch (error: unknown) {
    if (MCPRepositoryScopeError.read(error) !== undefined) throw error;
    const planError = toPlanError(error);
    return {
      status: "unknown",
      target,
      targetChanged: false,
      referencedSymbols: [],
      sections: [],
      unmappedSymbols: [],
      sourceFiles: [],
      message: `Could not evaluate documentation freshness: ${planError.message}`,
    };
  }
}
