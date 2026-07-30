#!/usr/bin/env node
import { Command } from "commander";
import * as dotenv from "dotenv";
import { readmeCommand } from "./commands/readme";
import { apiCommand } from "./commands/api";
import { annotateCommand } from "./commands/annotate";
import { changelogCommand } from "./commands/changelog";
import { diagramCommand } from "./commands/diagram";
import { updateCommand } from "./commands/update";
import { scoreCommand } from "./commands/score";
import { watchCommand } from "./commands/watch";
import { checkCommand } from "./commands/check";
import { setLogLevel } from "../core/logger";

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
program.addCommand(checkCommand);

// Handle --mcp flag before parsing commands
const args = process.argv.slice(2);
if (args.includes("--mcp")) {
  import("../mcp/server").then(({ startMCPServer }) => {
    startMCPServer().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    });
  });
} else {
  program.parseAsync().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
