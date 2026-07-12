#!/usr/bin/env node
import { Command } from "commander";
import * as dotenv from "dotenv";
import { readmeCommand } from "./commands/readme.js";
import { apiCommand } from "./commands/api.js";
import { annotateCommand } from "./commands/annotate.js";
import { changelogCommand } from "./commands/changelog.js";
import { diagramCommand } from "./commands/diagram.js";
import { updateCommand } from "./commands/update.js";
import { scoreCommand } from "./commands/score.js";
import { watchCommand } from "./commands/watch.js";
import { reviewCommand } from "./commands/review.js";
import { setLogLevel } from "../core/logger.js";

// `quiet` suppresses dotenv's startup banner, which would otherwise print to
// stdout — noisy for the CLI and fatal for the MCP server, whose stdout is a
// JSON-RPC channel that must not contain anything else.
dotenv.config({ quiet: true });

const program = new Command();

program
  .name("aidoc")
  .description(
    "🤖 AI-powered documentation generator for codebases. Analyzes your code via AST parsing and generates professional documentation using LLM.",
  )
  .version("0.1.0")
  .option("--verbose", "Enable verbose debug logging")
  .option(
    "--mcp",
    "Start as MCP (Model Context Protocol) server for AI assistant integration",
  )
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setLogLevel("debug");
    }
  });

program.addCommand(readmeCommand);
program.addCommand(apiCommand);
program.addCommand(annotateCommand);
program.addCommand(changelogCommand);
program.addCommand(diagramCommand);
program.addCommand(updateCommand);
program.addCommand(scoreCommand);
program.addCommand(watchCommand);
program.addCommand(reviewCommand);

// Handle --mcp flag before parsing commands
const args = process.argv.slice(2);
if (args.includes("--mcp")) {
  import("../mcp/server.js").then(({ startMCPServer }) => {
    startMCPServer().catch(console.error);
  });
} else {
  program.parse();
}
