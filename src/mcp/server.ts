#!/usr/bin/env node
/**
 * aidoc MCP (Model Context Protocol) Server
 *
 * Exposes aidoc's functionality as tools for AI assistants (ChatGPT, Claude,
 * Cursor, etc.) via the Model Context Protocol standard.
 *
 * Built on the official `@modelcontextprotocol/sdk`, so transport framing and
 * the JSON-RPC handshake are handled by the reference implementation rather
 * than by hand.
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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, ZodRawShape } from "zod";
import * as path from "path";
import { fileURLToPath } from "url";

import { analyzeCodebase } from "../core/analyzer.js";
import { Generator } from "../core/generator.js";
import { createProvider } from "../providers/registry.js";
import { loadConfig } from "../config/loader.js";
import { getChangedFiles } from "../git/history.js";
import { readExistingMarkdown } from "../output/markdown.js";
import { readProjectInfo } from "../cli/context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Server identity reported during the MCP `initialize` handshake. */
const SERVER_INFO = { name: "aidoc", version: "0.1.0" };

/** A tool exposed over MCP: its name, description, and Zod input schema. */
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
}

/**
 * Tool catalog. Input schemas are declared with Zod, which the SDK turns into
 * the JSON Schema advertised to clients and uses to validate incoming
 * arguments before our handler runs.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "analyze_codebase",
    description:
      "Analyze a codebase directory using AST parsing. Returns structured data about functions, classes, types, and imports found in the code.",
    inputSchema: {
      directory: z
        .string()
        .describe("Absolute path to the directory to analyze"),
      include: z
        .string()
        .optional()
        .describe(
          "Comma-separated glob patterns to include (default: **/*.ts,**/*.py)",
        ),
      exclude: z
        .string()
        .optional()
        .describe("Comma-separated glob patterns to exclude"),
    },
  },
  {
    name: "generate_readme",
    description:
      "Generate a professional README.md for a project by analyzing its code structure, package metadata, and dependencies.",
    inputSchema: {
      directory: z.string().describe("Absolute path to the project directory"),
    },
  },
  {
    name: "generate_api_docs",
    description:
      "Generate API reference documentation for all exported symbols (functions, classes, types) in a codebase.",
    inputSchema: {
      directory: z.string().describe("Absolute path to the project directory"),
    },
  },
  {
    name: "generate_diagram",
    description:
      "Generate a Mermaid architecture diagram showing module dependencies and data flow.",
    inputSchema: {
      directory: z.string().describe("Absolute path to the project directory"),
    },
  },
  {
    name: "check_docs_freshness",
    description:
      "Check whether documentation files are up-to-date with the current codebase. Returns a report of stale sections.",
    inputSchema: {
      directory: z.string().describe("Absolute path to the project directory"),
      doc_file: z
        .string()
        .optional()
        .describe(
          "Path to the documentation file to check (relative to directory)",
        ),
      since: z
        .string()
        .optional()
        .describe("Git ref to compare against (default: HEAD~5)"),
    },
  },
];

/**
 * Executes a tool by name. Kept independent of the MCP transport so it can be
 * unit-tested directly (e.g. `analyze_codebase` runs with no LLM).
 */
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
      const templatesDir = path.resolve(__dirname, "../templates");
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
      const templatesDir = path.resolve(__dirname, "../templates");
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
      const templatesDir = path.resolve(__dirname, "../templates");
      const generator = new Generator(provider, templatesDir);
      const diagram = await generator.generateDiagram(modules);
      return { content: diagram, format: "mermaid" };
    }

    case "check_docs_freshness": {
      const dir = args.directory as string;
      const docFile = (args.doc_file as string) || "README.md";
      const since = (args.since as string) || "HEAD~5";

      const docPath = path.resolve(dir, docFile);
      const existingDoc = readExistingMarkdown(docPath);

      if (!existingDoc) {
        return {
          status: "missing",
          message: `Documentation file not found: ${docFile}`,
          recommendation: "Run aidoc readme to generate initial documentation.",
        };
      }

      try {
        const changedFiles = await getChangedFiles(since, "HEAD", dir);

        if (changedFiles.length === 0) {
          return {
            status: "up-to-date",
            message: "No code changes detected. Documentation appears current.",
            changedFiles: [],
          };
        }

        // Filter to source files only
        const sourceChanges = changedFiles.filter(
          (f) => /\.(ts|tsx|js|jsx|py)$/.test(f) && !f.includes(".test."),
        );

        return {
          status: sourceChanges.length > 0 ? "potentially-stale" : "up-to-date",
          message:
            sourceChanges.length > 0
              ? `${sourceChanges.length} source files changed since ${since}. Documentation may need updating.`
              : "Only non-source files changed. Documentation is likely current.",
          changedFiles: sourceChanges,
          recommendation:
            sourceChanges.length > 0
              ? "Run aidoc update to refresh documentation."
              : null,
        };
      } catch {
        return {
          status: "unknown",
          message: "Could not access git history. Is this a git repository?",
        };
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** Wraps a tool result payload as an MCP text content block. */
function toTextResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

/** Builds an `McpServer` with every aidoc tool registered. */
export function createServer(): McpServer {
  const server = new McpServer(SERVER_INFO);

  for (const def of TOOL_DEFINITIONS) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.inputSchema },
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        try {
          const result = await handleToolCall(def.name, args);
          return toTextResult(result);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Error: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}

/** Starts the MCP server over stdio (newline-delimited JSON-RPC via the SDK). */
export async function startMCPServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
