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
import { createProvider } from "../providers/factory";
import { loadConfig } from "../config/loader";
import { getChangedFiles } from "../git/history";
import { readExistingMarkdown } from "../output/markdown";
import * as path from "path";
import * as fs from "fs";

/** MCP Tool Definition */
interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<
      string,
      { type: string; description: string; default?: unknown }
    >;
    required?: string[];
  };
}

/** MCP JSON-RPC Request */
interface MCPRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/** MCP JSON-RPC Response */
interface MCPResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Available MCP tools */
const TOOLS: MCPTool[] = [
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
      "Check whether documentation files are up-to-date with the current codebase. Returns a report of stale sections.",
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
async function handleToolCall(
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

      const pkgPath = path.join(dir, "package.json");
      let projectName = path.basename(dir);
      let description = "";
      let dependencies: string[] = [];

      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        projectName = pkg.name || projectName;
        description = pkg.description || "";
        dependencies = Object.keys(pkg.dependencies || {});
      }

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

/** MCP Server over stdio */
export async function startMCPServer(): Promise<void> {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  function send(response: MCPResponse): void {
    const json = JSON.stringify(response);
    process.stdout.write(
      `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`,
    );
  }

  let buffer = "";

  rl.on("line", async (line: string) => {
    buffer += line;

    // Try to parse as JSON-RPC
    try {
      const request: MCPRequest = JSON.parse(buffer);
      buffer = "";

      switch (request.method) {
        case "initialize":
          send({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: {
                name: "aidoc",
                version: "0.1.0",
              },
            },
          });
          break;

        case "tools/list":
          send({
            jsonrpc: "2.0",
            id: request.id,
            result: { tools: TOOLS },
          });
          break;

        case "tools/call": {
          const params = request.params as {
            name: string;
            arguments: Record<string, unknown>;
          };
          try {
            const result = await handleToolCall(
              params.name,
              params.arguments || {},
            );
            send({
              jsonrpc: "2.0",
              id: request.id,
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                  },
                ],
              },
            });
          } catch (error: unknown) {
            const message =
              error instanceof Error ? error.message : String(error);
            send({
              jsonrpc: "2.0",
              id: request.id,
              error: { code: -32000, message },
            });
          }
          break;
        }

        case "notifications/initialized":
          // Client notification, no response needed
          break;

        default:
          send({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`,
            },
          });
      }
    } catch {
      // Not complete JSON yet, continue buffering
    }
  });
}
