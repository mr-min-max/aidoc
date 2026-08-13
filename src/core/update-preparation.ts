import * as fs from "node:fs";
import * as path from "node:path";
import Handlebars from "handlebars";
import type {
  DocumentationReference,
  ImpactProviderContext,
} from "../impact/types";

export interface UpdateGenerationEnvelope {
  readonly operation: "update";
  readonly systemPrompt: string;
  readonly prompt: string;
}

interface UpdateTemplateTarget {
  file: string;
  section: string;
}

interface UpdateTemplateChange {
  id: string;
  category: string;
  risk: string;
  changedContractFacets: string[];
  directTargets: UpdateTemplateTarget[];
  recommendedTargets: UpdateTemplateTarget[];
}

/** Renders the exact update envelope shared by direct and provider-free flows. */
export function renderUpdateGenerationEnvelope(input: {
  templatesDir: string;
  existingDoc: string;
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
  const render = Handlebars.compile(source);
  return {
    operation: "update",
    systemPrompt:
      "You are a documentation updater. Preserve the existing structure and only modify sections affected by code changes.",
    prompt: render({
      existingDoc: input.existingDoc,
      impactPlan: updateTemplatePlan(input.impactPlan),
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
      return {
        id: change.id,
        category: change.category,
        risk: change.risk,
        changedContractFacets:
          "changedContractFacets" in change
            ? (change.changedContractFacets ?? [])
            : [],
        directTargets: projectUpdateTargets(matching?.directReferences ?? []),
        recommendedTargets: projectUpdateTargets(
          matching?.recommendations ?? [],
        ),
      };
    }),
  };
}

function projectUpdateTargets(
  references: readonly DocumentationReference[],
): UpdateTemplateTarget[] {
  return references.map(({ file, section }) => ({ file, section }));
}
