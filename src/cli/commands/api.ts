import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { analyzeCodebase } from '../../core/analyzer';
import { loadCommandContext, writeDoc } from '../context';

export const apiCommand = new Command('api')
  .description('Generate API documentation from code analysis')
  .option('-o, --output <path>', 'Output file path', './docs/API.md')
  .option('--dry-run', 'Preview without writing to file')
  .option('--mock', 'Use mock LLM response for testing')
  .action(async (options) => {
    const spinner = ora('Scanning codebase for API symbols...').start();
    try {
      const ctx = await loadCommandContext(options);
      const modules = await analyzeCodebase(ctx.cwd, ctx.config.include, ctx.config.exclude);

      if (modules.length === 0) {
        spinner.warn(chalk.yellow('No supported source files found.'));
        return;
      }
      spinner.succeed(chalk.green(`Found ${modules.length} modules`));

      const genSpinner = ora('Generating API documentation...').start();
      const apiDocs = await ctx.generator.generateApiDocs(modules);
      genSpinner.succeed(chalk.green('API documentation generated!'));

      await writeDoc(path.resolve(ctx.cwd, options.output), apiDocs, { dryRun: options.dryRun, label: options.output });
    } catch (error: any) {
      spinner.fail(chalk.red('Failed to generate API docs'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
