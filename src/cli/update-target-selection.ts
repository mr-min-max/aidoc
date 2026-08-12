import prompts from "prompts";
import type {
  DocumentationTargetReason,
  ResolvedDocumentationTarget,
} from "../impact/targets";

export interface UpdateSelectionRuntime {
  readonly interactive: boolean;
  choose(
    candidates: readonly {
      readonly path: string;
      readonly reasons: readonly DocumentationTargetReason[];
    }[],
  ): Promise<readonly string[]>;
}

export async function selectUpdateTargets(input: {
  candidates: readonly ResolvedDocumentationTarget[];
  explicit: boolean;
  all: boolean;
  runtime?: UpdateSelectionRuntime;
}): Promise<ResolvedDocumentationTarget[]> {
  if (input.explicit && input.all) {
    throw new Error("--target and --all cannot be used together.");
  }

  const candidates = [...input.candidates].sort((left, right) =>
    compareStrings(left.path, right.path),
  );
  if (input.explicit || input.all || candidates.length <= 1) {
    return candidates;
  }

  const runtime = input.runtime ?? defaultRuntime();
  if (!runtime.interactive) {
    throw new Error(
      "Multiple documentation targets were found. Use --target <file> or --all.",
    );
  }

  const selectedPaths = new Set(await runtime.choose(candidates));
  return candidates.filter((candidate) => selectedPaths.has(candidate.path));
}

function defaultRuntime(): UpdateSelectionRuntime {
  return {
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    choose: chooseInteractiveTargets,
  };
}

async function chooseInteractiveTargets(
  candidates: readonly {
    readonly path: string;
    readonly reasons: readonly DocumentationTargetReason[];
  }[],
): Promise<readonly string[]> {
  const response = await prompts({
    type: "multiselect",
    name: "targets",
    message: "Select documentation targets to update",
    instructions: false,
    choices: candidates.map((candidate) => ({
      title: `${candidate.path} — ${candidate.reasons.map(formatReason).join(", ")}`,
      value: candidate.path,
      selected: true,
    })),
  });
  return Array.isArray(response.targets) ? response.targets : [];
}

function formatReason(reason: DocumentationTargetReason): string {
  return reason.replaceAll("-", " ");
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
