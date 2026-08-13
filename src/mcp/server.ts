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
 * - check_docs_freshness: Run an AST-backed source/document co-change guard
 *
 * Usage:
 *   npx aidoc-gen --mcp
 *   # or add to Claude/Cursor MCP config
 */

import { analyzeCodebase } from "../core/analyzer";
import { Generator } from "../core/generator";
import { createProvider } from "../providers/registry";
import { loadProviderConfig } from "../config/loader";
import { loadPlanningConfig } from "../config/planning";
import { readProjectInfo } from "../cli/context";
import { checkDocumentationFreshness } from "../core/freshness";
import { createImpactPlan } from "../impact/planner";
import {
  PLAN_ERROR_CODES,
  PlanFailure,
  type PlanErrorCode,
} from "../impact/types";
import { readPackageVersion } from "../core/package-meta";
import { resolveTemplatesDir } from "../core/templates";
import {
  getSafeErrorDiagnostic,
  inspectSafeAllowlistedErrorCode,
  UNKNOWN_ERROR_DIAGNOSTIC,
} from "../security/diagnostics";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createMCPUpdateWorkflowContext,
  defaultMCPUpdateWorkflowContext,
  prepareDocumentationUpdate,
  validateDocumentationDraft,
  MCP_TARGET_REQUIRED,
  type MCPUpdateWorkflowContext,
} from "./update-workflow";
import { MCP_INVALID_PREPARATION } from "./preparation-token";

const SAFE_MCP_ERROR_CODES = new Set<string>([
  ...PLAN_ERROR_CODES,
  "TRUST_SECRET_BLOCKED",
  "TRUST_INVALID_PROVIDER_OUTPUT",
  "TRUST_REPOSITORY_REQUIRED",
  "TRUST_INVALID_PATH",
  "TRUST_INSPECTION_FAILED",
  "TRUST_PATH_OUTSIDE_ROOT",
  "TRUST_UNSAFE_SYMLINK",
  "TRUST_INVALID_TARGET_TYPE",
  "TRUST_RACE_DETECTED",
  "TRUST_ATOMIC_WRITE_FAILED",
  "MCP_DIRECTORY_DENIED",
  "MCP_INVALID_PATH_INPUT",
  MCP_TARGET_REQUIRED,
  MCP_INVALID_PREPARATION,
]);
const UNKNOWN_MCP_ERROR = "Unknown MCP error.";

function invalidMCPRef(): PlanFailure {
  return new PlanFailure("PLAN_INVALID_REF", "The Git reference is invalid.");
}

function invalidMCPContextBudget(): PlanFailure {
  return new PlanFailure(
    "PLAN_INVALID_CONTEXT_BUDGET",
    "The provider context byte budget is invalid.",
  );
}

function readOwnMCPArgument(
  args: unknown,
  key: string,
  failure: () => PlanFailure,
): unknown {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw failure();
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(args, key);
  } catch {
    throw failure();
  }
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) throw failure();
  return descriptor.value;
}

function readMCPPlanOptions(args: unknown): {
  base?: string;
  head?: string;
  maxContextBytes?: number;
} {
  const base = readOwnMCPArgument(args, "base", invalidMCPRef);
  const head = readOwnMCPArgument(args, "head", invalidMCPRef);
  const maxContextBytes = readOwnMCPArgument(
    args,
    "max_context_bytes",
    invalidMCPContextBudget,
  );
  if (base !== undefined && typeof base !== "string") throw invalidMCPRef();
  if (head !== undefined && typeof head !== "string") throw invalidMCPRef();
  if (
    maxContextBytes !== undefined &&
    (typeof maxContextBytes !== "number" ||
      !Number.isInteger(maxContextBytes) ||
      maxContextBytes < 1024 ||
      maxContextBytes > 1048576)
  ) {
    throw invalidMCPContextBudget();
  }
  return { base, head, maxContextBytes };
}

export function formatMCPError(error: unknown): string {
  const planError = PlanFailure.read(error);
  if (planError !== undefined) {
    return `${planError.code}: ${planError.message}`;
  }

  const diagnostic = getSafeErrorDiagnostic(error);
  if (diagnostic.message === UNKNOWN_ERROR_DIAGNOSTIC) {
    return UNKNOWN_MCP_ERROR;
  }

  const { code, hasUntrustedCode } = inspectSafeAllowlistedErrorCode(
    error,
    SAFE_MCP_ERROR_CODES,
  );
  if (!code) {
    return hasUntrustedCode ? UNKNOWN_MCP_ERROR : diagnostic.message;
  }
  if (PLAN_ERROR_CODES.has(code as PlanErrorCode)) return UNKNOWN_MCP_ERROR;

  const prefix = `${code}:`;
  return diagnostic.message.startsWith(prefix)
    ? diagnostic.message
    : `${prefix} ${diagnostic.message}`;
}

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
  {
    name: "plan_documentation_impact",
    description:
      "Plan deterministic documentation impact for the repository where this MCP server started.",
    inputSchema: {
      type: "object",
      properties: {
        base: {
          type: "string",
          description: "Explicit comparison base Git ref",
        },
        head: {
          type: "string",
          description: "Compare two committed Git refs",
        },
        max_context_bytes: {
          type: "integer",
          minimum: 1024,
          maximum: 1048576,
          description: "Provider-context byte ceiling",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "prepare_documentation_update",
    description:
      "Prepare one repository-scoped Markdown update without writing files or calling a provider.",
    inputSchema: {
      type: "object",
      properties: {
        base: { type: "string" },
        head: { type: "string" },
        max_context_bytes: {
          type: "integer",
          minimum: 1024,
          maximum: 1048576,
        },
        target: { type: "string" },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        schema_version: {
          type: "string",
          const: "aidoc.mcp-update-preparation.v1",
        },
        preparation_digest: { type: "string" },
        target: { type: "string" },
        generation: {
          type: "object",
          properties: {
            system_prompt: { type: "string" },
            prompt: { type: "string" },
          },
          required: ["system_prompt", "prompt"],
          additionalProperties: false,
        },
        context: contextBudgetSchema(),
        trust: trustSummarySchema(),
        instructions: { type: "array", items: { type: "string" } },
      },
      required: [
        "schema_version",
        "preparation_digest",
        "target",
        "generation",
        "context",
        "trust",
        "instructions",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "validate_documentation_draft",
    description:
      "Validate a host-generated Markdown draft against a signed repository-scoped preparation without writing files.",
    inputSchema: {
      type: "object",
      properties: {
        preparation_digest: { type: "string" },
        target: { type: "string" },
        candidate_markdown: { type: "string" },
      },
      required: ["preparation_digest", "target", "candidate_markdown"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        schema_version: {
          type: "string",
          const: "aidoc.mcp-draft-validation.v1",
        },
        valid: { type: "boolean" },
        target: { type: "string" },
        approved_markdown: { type: "string" },
        markdown_warnings: { type: "array", items: { type: "string" } },
        diff: diffSummarySchema(),
        trust: trustSummarySchema(),
      },
      required: [
        "schema_version",
        "valid",
        "target",
        "markdown_warnings",
        "diff",
        "trust",
      ],
      additionalProperties: false,
    },
  },
];

function contextBudgetSchema(): object {
  return {
    type: "object",
    properties: {
      maxBytes: { type: "integer" },
      usedBytes: { type: "integer" },
      totalRecords: { type: "integer" },
      includedRecords: { type: "integer" },
      omittedRecords: { type: "integer" },
      impactDigest: { type: "string" },
    },
    required: [
      "maxBytes",
      "usedBytes",
      "totalRecords",
      "includedRecords",
      "omittedRecords",
      "impactDigest",
    ],
    additionalProperties: false,
  };
}

function trustSummarySchema(): object {
  return {
    type: "object",
    properties: {
      policy: { type: "string", enum: ["warn", "redact", "strict"] },
      action: {
        type: "string",
        enum: ["allowed", "warned", "redacted", "blocked"],
      },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string" },
            count: { type: "integer" },
          },
          required: ["kind", "count"],
          additionalProperties: false,
        },
      },
    },
    required: ["policy", "action", "findings"],
    additionalProperties: false,
  };
}

function diffSummarySchema(): object {
  return {
    type: "object",
    properties: {
      changed: { type: "boolean" },
      addedLines: { type: "integer" },
      removedLines: { type: "integer" },
      oldBytes: { type: "integer" },
      newBytes: { type: "integer" },
    },
    required: ["changed", "addedLines", "removedLines", "oldBytes", "newBytes"],
    additionalProperties: false,
  };
}

/** Handle a tool call */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  serverCwd = process.cwd(),
  workflowContext?: MCPUpdateWorkflowContext,
): Promise<unknown> {
  const updateContext =
    workflowContext ?? defaultMCPUpdateWorkflowContext(serverCwd);
  switch (name) {
    case "analyze_codebase": {
      const dir = args.directory as string;
      const config = loadPlanningConfig(dir);
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
      const config = loadProviderConfig(dir);
      const modules = await analyzeCodebase(
        dir,
        config.include,
        config.exclude,
      );
      const provider = createProvider(config);
      const templatesDir = resolveTemplatesDir();
      const generator = new Generator(provider, templatesDir, {
        policy: config.trustPolicy,
        origin: "mcp",
      });

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
      const config = loadProviderConfig(dir);
      const modules = await analyzeCodebase(
        dir,
        config.include,
        config.exclude,
      );
      const provider = createProvider(config);
      const templatesDir = resolveTemplatesDir();
      const generator = new Generator(provider, templatesDir, {
        policy: config.trustPolicy,
        origin: "mcp",
      });
      const apiDocs = await generator.generateApiDocs(modules);
      return { content: apiDocs, format: "markdown" };
    }

    case "generate_diagram": {
      const dir = args.directory as string;
      const config = loadProviderConfig(dir);
      const modules = await analyzeCodebase(
        dir,
        config.include,
        config.exclude,
      );
      const provider = createProvider(config);
      const templatesDir = resolveTemplatesDir();
      const generator = new Generator(provider, templatesDir, {
        policy: config.trustPolicy,
        origin: "mcp",
      });
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

    case "plan_documentation_impact": {
      const options = readMCPPlanOptions(args);
      const result = await createImpactPlan({
        cwd: serverCwd,
        base: options.base,
        head: options.head,
        maxContextBytes: options.maxContextBytes,
      });
      return result.plan;
    }

    case "prepare_documentation_update":
      return prepareDocumentationUpdate(args, updateContext);

    case "validate_documentation_draft":
      return validateDocumentationDraft(args, updateContext);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function createMCPServer(serverCwd = process.cwd()): Server {
  const workflowContext = createMCPUpdateWorkflowContext(serverCwd);
  const server = new Server(
    { name: "aidoc", version: readPackageVersion() },
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
        serverCwd,
        workflowContext,
      );
      const response = {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
      if (
        request.params.name === "prepare_documentation_update" ||
        request.params.name === "validate_documentation_draft"
      ) {
        return { ...response, structuredContent: result };
      }
      return response;
    } catch (error: unknown) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatMCPError(error),
          },
        ],
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
