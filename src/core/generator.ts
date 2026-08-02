import * as fs from "fs";
import * as path from "path";
import Handlebars from "handlebars";
import { GenerateOptions, LLMProvider } from "../providers/types";
import { ParsedModule } from "../parsers/types";
import {
  GenerationOperation,
  GenerationOrigin,
  TrustEvent,
  TrustGateway,
} from "../security/gateway";
import { TrustPolicy } from "../security/types";
import type { UpdateContext } from "./differ";
import type {
  DocumentationReference,
  ImpactProviderContext,
} from "../impact/types";

interface ReadmeContext {
  projectName: string;
  description: string;
  modules: ParsedModule[];
  dependencies: string[];
  badges: boolean;
  tableOfContents: boolean;
  installSection: boolean;
  usageExamples: boolean;
}

interface ChangelogContext {
  commits: { hash: string; message: string; date: string }[];
  version: string;
  date: string;
  fromRef: string;
  toRef: string;
}

export interface GeneratorSecurityOptions {
  policy?: TrustPolicy;
  origin?: GenerationOrigin;
  onEvent?: (event: TrustEvent) => void;
}

/** Renders prompt templates and delegates generation to the configured LLM provider. */
export class Generator {
  private templateCache: Map<string, HandlebarsTemplateDelegate> = new Map();
  private readonly gateway: TrustGateway;

  constructor(
    provider: LLMProvider,
    private templatesDir: string,
    security: GeneratorSecurityOptions = {},
  ) {
    this.gateway = new TrustGateway(provider, {
      policy: security.policy ?? "redact",
      origin: security.origin ?? "cli",
      onEvent: security.onEvent,
    });
  }

  /** Generates a complete README from project metadata and parsed modules. */
  async generateReadme(context: ReadmeContext): Promise<string> {
    const prompt = this.renderTemplate("readme", context);
    return this.generateWithTrust(
      "readme",
      "You are a professional open-source documentation writer. Output only valid Markdown.",
      prompt,
      { temperature: 0.3 },
    );
  }

  /** Generates API reference markdown for exported symbols. */
  async generateApiDocs(modules: ParsedModule[]): Promise<string> {
    const prompt = this.renderTemplate("api-doc", { modules });
    return this.generateWithTrust(
      "api",
      "You are a technical API documentation writer. Be precise and comprehensive. Output only valid Markdown.",
      prompt,
      { temperature: 0.2 },
    );
  }

  /** Generates JSDoc comments as structured JSON for undocumented symbols. */
  async generateJsDoc(symbols: any[]): Promise<string> {
    const prompt = this.renderTemplate("jsdoc", { symbols });
    return this.generateWithTrust(
      "jsdoc",
      "You are a TypeScript expert. Generate only valid JSDoc comments. Respond only with valid JSON.",
      prompt,
      { responseFormat: "json", temperature: 0.2 },
    );
  }

  /** Generates a changelog entry from normalized git commit metadata. */
  async generateChangelog(context: ChangelogContext): Promise<string> {
    const prompt = this.renderTemplate("changelog", context);
    return this.generateWithTrust(
      "changelog",
      'You are a technical writer creating changelog entries. Follow the "Keep a Changelog" format.',
      prompt,
      { temperature: 0.3 },
    );
  }

  /** Generates a Mermaid architecture diagram from module imports and exports. */
  async generateDiagram(modules: ParsedModule[]): Promise<string> {
    const prompt = this.renderTemplate("diagram", { modules });
    return this.generateWithTrust(
      "diagram",
      "You are a software architect. Output only valid Mermaid diagram code without markdown fences.",
      prompt,
      { temperature: 0.2 },
    );
  }

  /** Updates an existing markdown document using a bounded impact plan. */
  async generateUpdate(context: UpdateContext): Promise<string> {
    const approvedExistingDoc = this.gateway.approveInputFragment(
      "update",
      context.existingDoc,
    );
    const prompt = this.renderTemplate("update", {
      existingDoc: approvedExistingDoc,
      impactPlan: updateTemplatePlan(context.impactPlan),
    });
    return this.generateWithTrust(
      "update",
      "You are a documentation updater. Preserve the existing structure and only modify sections affected by code changes.",
      prompt,
      { temperature: 0.2 },
    );
  }

  /** Generates a readme and calls onToken once with the approved completed response. */
  async generateReadmeStream(
    context: ReadmeContext,
    onToken: (token: string) => void,
  ): Promise<string> {
    const prompt = this.renderTemplate("readme", context);
    return this.gateway.generateStream(
      {
        operation: "readme",
        systemPrompt:
          "You are a professional open-source documentation writer. Output only valid Markdown.",
        prompt,
      },
      { temperature: 0.3 },
      onToken,
    );
  }

  private generateWithTrust(
    operation: GenerationOperation,
    systemPrompt: string,
    prompt: string,
    options: Omit<GenerateOptions, "systemPrompt">,
  ): Promise<string> {
    return this.gateway.generate({ operation, systemPrompt, prompt }, options);
  }

  private renderTemplate(name: string, context: any): string {
    if (!this.templateCache.has(name)) {
      const templatePath = path.join(this.templatesDir, `${name}.hbs`);
      if (!fs.existsSync(templatePath)) {
        throw new Error(`Template not found: ${templatePath}`);
      }
      const source = fs.readFileSync(templatePath, "utf8");
      this.templateCache.set(name, Handlebars.compile(source));
    }
    return this.templateCache.get(name)!(context);
  }
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
  references: DocumentationReference[],
): UpdateTemplateTarget[] {
  return references.map(({ file, section }) => ({ file, section }));
}
