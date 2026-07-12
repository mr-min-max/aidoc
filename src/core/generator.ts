import * as fs from "fs";
import * as path from "path";
import Handlebars from "handlebars";
import { LLMProvider } from "../providers/types.js";
import { ParsedModule } from "../parsers/types.js";

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

/** Renders prompt templates and delegates generation to the configured LLM provider. */
export class Generator {
  private templateCache: Map<string, HandlebarsTemplateDelegate> = new Map();

  constructor(
    private provider: LLMProvider,
    private templatesDir: string,
  ) {}

  /** Generates a complete README from project metadata and parsed modules. */
  async generateReadme(context: ReadmeContext): Promise<string> {
    const prompt = this.renderTemplate("readme", context);
    return this.provider.generate(prompt, {
      systemPrompt:
        "You are a professional open-source documentation writer. Output only valid Markdown.",
      temperature: 0.3,
    });
  }

  /** Generates API reference markdown for exported symbols. */
  async generateApiDocs(modules: ParsedModule[]): Promise<string> {
    const prompt = this.renderTemplate("api-doc", { modules });
    return this.provider.generate(prompt, {
      systemPrompt:
        "You are a technical API documentation writer. Be precise and comprehensive. Output only valid Markdown.",
      temperature: 0.2,
    });
  }

  /** Generates JSDoc comments as structured JSON for undocumented symbols. */
  async generateJsDoc(symbols: any[]): Promise<string> {
    const prompt = this.renderTemplate("jsdoc", { symbols });
    return this.provider.generate(prompt, {
      systemPrompt:
        "You are a TypeScript expert. Generate only valid JSDoc comments. Respond only with valid JSON.",
      responseFormat: "json",
      temperature: 0.2,
    });
  }

  /** Generates a changelog entry from normalized git commit metadata. */
  async generateChangelog(context: ChangelogContext): Promise<string> {
    const prompt = this.renderTemplate("changelog", context);
    return this.provider.generate(prompt, {
      systemPrompt:
        'You are a technical writer creating changelog entries. Follow the "Keep a Changelog" format.',
      temperature: 0.3,
    });
  }

  /** Generates a Mermaid architecture diagram from module imports and exports. */
  async generateDiagram(modules: ParsedModule[]): Promise<string> {
    const prompt = this.renderTemplate("diagram", { modules });
    return this.provider.generate(prompt, {
      systemPrompt:
        "You are a software architect. Output only valid Mermaid diagram code without markdown fences.",
      temperature: 0.2,
    });
  }

  /** Updates an existing markdown document using changed files and a diff summary. */
  async generateUpdate(context: {
    existingDoc: string;
    changedFiles: string[];
    diffSummary: string;
  }): Promise<string> {
    const prompt = this.renderTemplate("update", {
      existingDoc: context.existingDoc,
      changedFiles: context.changedFiles,
      diffSummary: context.diffSummary.substring(0, 3000),
    });
    return this.provider.generate(prompt, {
      systemPrompt:
        "You are a documentation updater. Preserve the existing structure and only modify sections affected by code changes.",
      temperature: 0.2,
    });
  }

  /** Streams a readme, calling onToken for each chunk. Falls back if unsupported. */
  async generateReadmeStream(
    context: ReadmeContext,
    onToken: (token: string) => void,
  ): Promise<string> {
    const prompt = this.renderTemplate("readme", context);
    if (this.provider.generateStream) {
      return this.provider.generateStream(
        prompt,
        {
          systemPrompt:
            "You are a professional open-source documentation writer. Output only valid Markdown.",
          temperature: 0.3,
        },
        onToken,
      );
    }
    const result = await this.generateReadme(context);
    onToken(result);
    return result;
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
