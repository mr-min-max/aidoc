import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { loadCommandContext, writeDoc } from '../context';
import { readExistingMarkdown } from '../../output/markdown';
import { getChangedFiles, getDiff } from '../../git/history';
import { buildUpdateContext } from '../../core/differ';

export const updateCommand = new Command('update')
  .description('Update existing documentation based on code changes (diff-aware)')
  .option('--since <ref>', 'Git ref to compare from (default: last commit)')
  .option('--target <file>', 'Which doc file to update', './README.md')
  .option('--dry-run', 'Preview without writing')
  .option('--mock', 'Use mock LLM response for testing')
  .action(async (options) => {
    const spinner = ora('Checking for code changes...').start();
    try {
      const ctx = await loadCommandContext(options);
      const sinceRef = options.since || 'HEAD~5';
      const targetPath = path.resolve(ctx.cwd, options.target);

      const existingDoc = readExistingMarkdown(targetPath);
      if (!existingDoc) {
        spinner.fail(chalk.red(`File not found: ${options.target}. Run 'aidoc readme' first to generate it.`));
        process.exit(1);
      }

      const changedFiles = await getChangedFiles(sinceRef, 'HEAD', ctx.cwd);
      if (changedFiles.length === 0) {
        spinner.succeed(chalk.green('No code changes found. Documentation is up to date! ✅'));
        return;
      }
      spinner.succeed(chalk.yellow(`Found ${changedFiles.length} changed files since ${sinceRef}`));

      const genSpinner = ora('Updating documentation with AI...').start();
      let updatedDoc: string;
      if (ctx.isMock) {
        updatedDoc = await ctx.generator.generateUpdate({ existingDoc, changedFiles } as any);
      } else {
        const diffSummary = await getDiff(sinceRef, 'HEAD', ctx.cwd);
        const updateCtx = buildUpdateContext(existingDoc, changedFiles, diffSummary);
        updatedDoc = await ctx.generator.generateUpdate(updateCtx);
      }
      genSpinner.succeed(chalk.green('Documentation updated!'));

      await writeDoc(targetPath, updatedDoc, { dryRun: options.dryRun, label: options.target });
    } catch (error: any) {
      spinner.fail(chalk.red('Failed to update documentation'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
