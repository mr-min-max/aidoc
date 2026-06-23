import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import * as path from 'path';
import { loadConfig } from '../../config/loader';
import { analyzeCodebase } from '../../core/analyzer';
import { Generator } from '../../core/generator';
import { createProvider } from '../../providers/factory';
import { writeMarkdown, readExistingMarkdown } from '../../output/markdown';
import { displayDiff } from '../../output/diff-display';
import { getChangedFiles, getDiff } from '../../git/history';
import { buildUpdateContext } from '../../core/differ';

export const updateCommand = new Command('update')
  .description('Update existing documentation based on code changes (diff-aware)')
  .option('--since <ref>', 'Git ref to compare from (default: last commit)')
  .option('--target <file>', 'Which doc file to update', './README.md')
  .option('--dry-run', 'Preview without writing')
  .option('--mock', 'Use mock LLM response for testing')
  .action(async (options) => {
    const config = loadConfig();
    const cwd = process.cwd();
    const spinner = ora('Checking for code changes...').start();

    try {
      const sinceRef = options.since || 'HEAD~5';
      const targetPath = path.resolve(cwd, options.target);

      const existingDoc = readExistingMarkdown(targetPath);
      if (!existingDoc) {
        spinner.fail(chalk.red(`File not found: ${options.target}. Run 'aidoc readme' first to generate it.`));
        process.exit(1);
      }

      const changedFiles = await getChangedFiles(sinceRef, 'HEAD', cwd);

      if (changedFiles.length === 0) {
        spinner.succeed(chalk.green('No code changes found. Documentation is up to date! ✅'));
        return;
      }

      spinner.succeed(chalk.yellow(`Found ${changedFiles.length} changed files since ${sinceRef}`));

      const genSpinner = ora('Updating documentation with AI...').start();

      let updatedDoc: string;
      if (options.mock) {
        await new Promise(r => setTimeout(r, 1000));
        const timestamp = `\n\n> 📅 Last updated: ${new Date().toISOString().split('T')[0]} (${changedFiles.length} files changed)\n`;
        updatedDoc = existingDoc + timestamp;
      } else {
        const diffSummary = await getDiff(sinceRef, 'HEAD', cwd);
        const context = buildUpdateContext(existingDoc, changedFiles, diffSummary);

        const modules = await analyzeCodebase(cwd, config.include, config.exclude);
        const provider = createProvider(config);
        const updatePrompt = [
          'You are a technical documentation maintainer.',
          'Given the EXISTING documentation and the CODE CHANGES below,',
          'update ONLY the sections that are affected by the changes.',
          'Keep unchanged sections intact. Output the complete updated document.',
          '',
          '--- EXISTING DOCUMENTATION ---',
          context.existingDoc,
          '',
          '--- CHANGED FILES ---',
          context.changedFiles.join('\n'),
          '',
          '--- DIFF SUMMARY ---',
          context.diffSummary.substring(0, 3000),
          '',
          'Output the complete updated Markdown document:',
        ].join('\n');

        updatedDoc = await provider.generate(updatePrompt, {
          systemPrompt: 'You are a documentation updater. Preserve the existing structure and only modify sections affected by code changes.',
          temperature: 0.2,
        });
      }

      genSpinner.succeed(chalk.green('Documentation updated!'));

      displayDiff(path.basename(targetPath), existingDoc, updatedDoc);

      if (!options.dryRun) {
        const { confirm } = await prompts({
          type: 'confirm',
          name: 'confirm',
          message: 'Apply updates?',
          initial: true,
        });
        if (confirm) {
          writeMarkdown(targetPath, updatedDoc);
          console.log(chalk.green(`✔ Updated ${options.target}`));
        }
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Failed to update documentation'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
