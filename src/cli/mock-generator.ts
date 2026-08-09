import * as path from "path";
import { ParsedModule } from "../parsers/types";
import type { UpdateContext } from "../core/differ";

/**
 * Drop-in stand-in for Generator used by --mock. Produces deterministic output
 * without calling an LLM, so the CLI can be demoed/tested with no API key.
 */
export class MockGenerator {
  /** Generates deterministic README markdown for tests and demos. */
  async generateReadme(ctx: {
    projectName: string;
    description: string;
    modules: ParsedModule[];
    dependencies: string[];
  }): Promise<string> {
    const funcList = ctx.modules.flatMap((m) =>
      m.functions.map(
        (f) => `- \`${f.name}()\` — ${f.existingDoc || "No description"}`,
      ),
    );
    const classList = ctx.modules.flatMap((m) =>
      m.classes.map(
        (c) => `- \`${c.name}\` — ${c.existingDoc || "No description"}`,
      ),
    );
    return [
      `# ${ctx.projectName}`,
      "",
      `> ${ctx.description || "An awesome project"}`,
      "",
      "[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)",
      "[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://typescriptlang.org/)",
      "",
      "## Features",
      "",
      "- 🧠 AI-powered documentation generation",
      "- 📊 AST-based code analysis",
      "- 🔄 Diff-aware documentation updates",
      "",
      "## Installation",
      "",
      "```bash",
      `npm install ${ctx.projectName}`,
      "```",
      "",
      "## API",
      "",
      ...(funcList.length ? ["### Functions", "", ...funcList, ""] : []),
      ...(classList.length ? ["### Classes", "", ...classList, ""] : []),
      "## License",
      "",
      "MIT",
    ].join("\n");
  }

  /** Generates deterministic API docs from parsed modules. */
  async generateApiDocs(modules: ParsedModule[]): Promise<string> {
    const sections = modules.map((m) => {
      const funcs = m.functions
        .map(
          (f) =>
            `### \`${f.name}(${f.parameters.map((p) => p.name).join(", ")})\`\n\n${f.existingDoc || "No description available."}\n\n**Returns:** \`${f.returnType}\`\n`,
        )
        .join("\n");
      const classes = m.classes
        .map(
          (c) =>
            `### Class: \`${c.name}\`\n\n${c.existingDoc || "No description available."}\n`,
        )
        .join("\n");
      return `## ${path.basename(m.filePath)}\n\n${funcs}${classes}`;
    });
    return `# API Documentation\n\n${sections.join("\n---\n\n")}`;
  }

  /** Generates a deterministic Mermaid dependency sketch from parsed modules. */
  async generateDiagram(modules: ParsedModule[]): Promise<string> {
    const nodes = modules.map((m, i) => {
      const name = path.basename(m.filePath, path.extname(m.filePath));
      return `    N${i}["${name}"]`;
    });
    const edges = modules.slice(1).map((_, i) => `    N0 --> N${i + 1}`);
    return `graph TD\n${nodes.join("\n")}\n${edges.join("\n")}`;
  }

  /** Generates deterministic JSDoc JSON for undocumented symbols. */
  async generateJsDoc(symbols: any[]): Promise<string> {
    return JSON.stringify(
      symbols.map((f: any) => ({
        name: f.name,
        jsdoc: `/**\n * ${f.name} — auto-generated documentation.\n${(f.parameters || []).map((p: any) => ` * @param ${p.name} - The ${p.name} parameter\n`).join("")} * @returns ${f.returnType || "void"}\n */`,
      })),
    );
  }

  /** Generates deterministic changelog markdown from commit metadata. */
  async generateChangelog(ctx: {
    commits: any[];
    version: string;
  }): Promise<string> {
    const today = new Date().toISOString().split("T")[0];
    return [
      `## [${ctx.version}] - ${today}`,
      "",
      "### Added",
      ...ctx.commits
        .filter((c: any) => c.message.startsWith("feat"))
        .map((c: any) => `- ${c.message}`),
      "",
      "### Fixed",
      ...ctx.commits
        .filter((c: any) => c.message.startsWith("fix"))
        .map((c: any) => `- ${c.message}`),
      "",
      "### Changed",
      ...ctx.commits
        .filter(
          (c: any) =>
            !c.message.startsWith("feat") && !c.message.startsWith("fix"),
        )
        .map((c: any) => `- ${c.message}`),
    ].join("\n");
  }

  /** Appends a deterministic update note for selected impact records. */
  async generateUpdate(ctx: UpdateContext): Promise<string> {
    return (
      ctx.existingDoc +
      `\n\n> 📅 Last updated: ${new Date().toISOString().split("T")[0]} (${ctx.impactPlan.changes.length} impact records)\n`
    );
  }
}
