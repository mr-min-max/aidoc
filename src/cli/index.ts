#!/usr/bin/env node
import { Command } from 'commander';
import * as dotenv from 'dotenv';
import { readmeCommand } from './commands/readme';
import { apiCommand } from './commands/api';
import { annotateCommand } from './commands/annotate';
import { changelogCommand } from './commands/changelog';
import { diagramCommand } from './commands/diagram';
import { updateCommand } from './commands/update';

dotenv.config();

const program = new Command();

program
  .name('aidoc')
  .description('🤖 AI-powered documentation generator for codebases. Analyzes your code via AST parsing and generates professional documentation using LLM.')
  .version('0.1.0');

program.addCommand(readmeCommand);
program.addCommand(apiCommand);
program.addCommand(annotateCommand);
program.addCommand(changelogCommand);
program.addCommand(diagramCommand);
program.addCommand(updateCommand);

program.parse();
