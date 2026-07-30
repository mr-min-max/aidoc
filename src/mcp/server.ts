#!/usr/bin/env node
/**
 * aidoc MCP (Model Context Protocol) Server
 *
 * Exposes aidoc's functionality as tools for AI assistants (ChatGPT, Claude, Cursor, etc.)
 * via the Model Context Protocol standard.
 *
 * Tools:
 * - analyze_codebase: Parse and return code structure (AST)
 * - generate_readme: Generate README documentation
 * - generate_api_docs: Generate API reference documentation
 * - generate_diagram: Generate architecture diagram
 * - check_docs_freshness: Check if documentation is up-to-date
 *
 * Usage:
 *   npx aidoc-gen --mcp
 *   # or add to Claude/Cursor MCP config
 */

import { analyzeCodebase } from "../core/analyzer";
import { Generator } from "../core/generator";
import { createProvider } from "../providers/registry";
import { loadConfig } from "../config/loader";
import { readProjectInfo } from "../cli/context";
import { checkDocumentationFreshness } from "../core/freshness";
import { resolveTemplatesDir } from "../core/templates";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

/** Available MCP tools */
export const TOOLS: Tool[] = [
  {
    name: "analyze_codebase",
    description:
      "Analyze a codebase directory using AST parsing. Returns structured data about functions, classes, types, and imports found in the code.",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Absolute path to the directory to analyze",
        },
        include: {
          type: "string",
          description:
            "Comma-separated glob patterns to include (default: **/*.ts,**/*.py)",
          default: "**/*.ts,**/*.tsx,**/*.js,**/*.jsx,**/*.py",
        },
        exclude: {
          type: "string",
          description: "Comma-separated glob patterns to exclude",
          default: "**/node_modules/**,**/dist/**,**/*.test.*",
        },
      },
      required: ["directory"],
    },
  },
  {
    name: "generate_readme",
    description:
      "Generate a professional README.md for a project by analyzing its code structure, package metadata, and dependencies.",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Absolute path to the project directory",
        },
      },
      required: ["directory"],
    },
  },
  {
    name: "generate_api_docs",
    description:
      "Generate API reference documentation for all exported symbols (functions, classes, types) in a codebase.",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Absolute path to the project directory",
        },
      },
      required: ["directory"],
    },
  },
  {
    name: "generate_diagram",
    description:
      "Generate a Mermaid architecture diagram showing module dependencies and data flow.",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Absolute path to the project directory",
        },
      },
      required: ["directory"],
    },
  },
  {
    name: "check_docs_freshness",
    description:
      "Run an AST-backed documentation co-change guard. This detects source/doc co-change and does not verify semantic correctness.",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Absolute path to the project directory",
        },
        doc_file: {
          type: "string",
          description:
            "Path to the documentation file to check (relative to directory)",
          default: "README.md",
        },
        since: {
          type: "string",
          description: "Git ref to compare against (default: HEAD~5)",
          default: "HEAD~5",
        },
      },
      required: ["directory"],
    },
  },
];

/** Handle a tool call */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const config = loadConfig(args.directory as string);

  switch (name) {
    case "analyze_codebase": {
      const dir = args.directory as string;
      const include = args.include
        ? (args.include as string).split(",")
        : config.include;
      const exclude = args.exclude
        ? (args.exclude as string).split(",")
        : config.exclude;

      const modules = await analyzeCodebase(dir, include, exclude);

      return {
        totalModules: modules.length,
        totalFunctions: modules.reduce((acc, m) => acc + m.functions.length, 0),
        totalClasses: modules.reduce((acc, m) => acc + m.classes.length, 0),
        totalTypes: modules.reduce((acc, m) => acc + m.types.length, 0),
        modules: modules.map((m) => ({
          filePath: m.filePath,
          language: m.language,
          functions: m.functions.map((f) => ({
            name: f.name,
            signature: f.signature,
            returnType: f.returnType,
            isAsync: f.isAsync,
            hasDoc: !!f.existingDoc,
          })),
          classes: m.classes.map((c) => ({
            name: c.name,
            extends: c.extends,
            implements: c.implements,
            methodCount: c.methods.length,
            hasDoc: !!c.existingDoc,
          })),
          types: m.types.map((t) => ({
            name: t.name,
            kind: t.kind,
          })),
        })),
      };
    }

    case "generate_readme": {
      const dir = args.directory as string;
      const modules = await analyzeCodebase(
        dir,
        config.include,
        config.exclude,
      );
      const provider = createProvider(config);
      const templatesDir = resolveTemplatesDir();
      const generator = new Generator(provider, templatesDir);

      const {
        name: projectName,
        description,
        dependencies,
      } = readProjectInfo(dir);

      const readme = await generator.generateReadme({
        projectName,
        description,
        modules,
        dependencies,
        badges: true,
        tableOfContents: true,
        installSection: true,
        usageExamples: true,
      });

      return { content: readme, format: "markdown" };
    }

    case "generate_api_docs": {
      const dir = args.directory as string;
      const modules = await analyzeCodebase(
        dir,
        config.include,
        config.exclude,
      );
      const provider = createProvider(config);
      const templatesDir = resolveTemplatesDir();
      const generator = new Generator(provider, templatesDir);
      const apiDocs = await generator.generateApiDocs(modules);
      return { content: apiDocs, format: "markdown" };
    }

    case "generate_diagram": {
      const dir = args.directory as string;
      const modules = await analyzeCodebase(
        dir,
        config.include,
        config.exclude,
      );
      const provider = createProvider(config);
      const templatesDir = resolveTemplatesDir();
      const generator = new Generator(provider, templatesDir);
      const diagram = await generator.generateDiagram(modules);
      return { content: diagram, format: "mermaid" };
    }

    case "check_docs_freshness": {
      const dir = args.directory as string;
      const docFile = (args.doc_file as string) || "README.md";
      const since = (args.since as string) || "HEAD~5";

      const report = await checkDocumentationFreshness(dir, docFile, since);
      return {
        ...report,
        recommendation:
          report.status === "stale"
            ? "Run aidoc update to refresh documentation."
            : null,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function createMCPServer(): Server {
  const server = new Server(
    { name: "aidoc", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await handleToolCall(
        request.params.name,
        request.params.arguments ?? {},
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: message }],
      };
    }
  });

  return server;
}

/** MCP Server over stdio */
export async function startMCPServer(): Promise<void> {
  const server = createMCPServer();
  await server.connect(new StdioServerTransport());
}
