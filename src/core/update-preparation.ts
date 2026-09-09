import * as fs from "node:fs";
import * as path from "node:path";
import Handlebars from "handlebars";
import type { ImpactProviderContext } from "../impact/types";

export interface UpdateGenerationEnvelope {
  readonly operation: "update";
  readonly systemPrompt: string;
  readonly prompt: string;
}

interface UpdateTemplateChange {
  qualifiedName: string;
  kind: string;
  category: string;
  changedContractFacets: string[];
  before?: string;
  after?: string;
  compacted: boolean;
  sections: string[];
}

/** Renders the exact update envelope shared by direct and provider-free flows. */
export function renderUpdateGenerationEnvelope(input: {
  templatesDir: string;
  existingDoc: string;
  target: string;
  impactPlan: ImpactProviderContext;
}): UpdateGenerationEnvelope {
  const templatePath = path.join(input.templatesDir, "update.hbs");
  if (!fs.existsSync(templatePath)) {
    throw new Error("Template not found.");
  }

  let source: string;
  try {
    source = fs.readFileSync(templatePath, "utf8");
  } catch {
    throw new Error("Template unavailable.");
  }
  const render = Handlebars.compile(source, { noEscape: true });
  return {
    operation: "update",
    systemPrompt:
      "You are a documentation updater. Preserve the existing structure and only modify sections affected by code changes.",
    prompt: render({
      target: input.target,
      existingDoc: input.existingDoc,
      ...updateTemplatePlan(input.impactPlan),
    }),
  };
}

function updateTemplatePlan(impactPlan: ImpactProviderContext): {
  changes: UpdateTemplateChange[];
} {
  const documentation = new Map(
    impactPlan.documentation.map((item) => [item.changeId, item]),
  );
  return {
    changes: impactPlan.changes.map((change) => {
      const matching = documentation.get(change.id);
      const direct = matching?.directReferences ?? [];
      const recommended = matching?.recommendations ?? [];
      const sections = [
        ...new Set([...direct, ...recommended].map(({ section }) => section)),
      ].sort();
      const full =
        "compacted" in change && change.compacted === true ? undefined : change;
      return {
        qualifiedName: full?.qualifiedName ?? change.id,
        kind: full?.kind ?? change.kind,
        category: change.category,
        changedContractFacets: full?.changedContractFacets ?? [],
        ...(full?.before === undefined ? {} : { before: full.before }),
        ...(full?.after === undefined ? {} : { after: full.after }),
        compacted: "compacted" in change && change.compacted === true,
        sections,
      };
    }),
  };
}
