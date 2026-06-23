import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { loadConfig } from '../../config/loader';
import { Generator } from '../../core/generator';
import { createProvider } from '../../providers/factory';
import { writeMarkdown, readExistingMarkdown } from '../../output/markdown';
import { getCommitsSince, getLatestTag } from '../../git/history';

export const changelogCommand = new Command('changelog')
  .description('Generate CHANGELOG from git history')
  .option('--from <ref>', 'Start ref (tag, commit, or branch)')
  .option('--to <ref>', 'End ref', 'HEAD')
  .option('--version <ver>', 'Version string for the entry', 'Unreleased')
  .option('-o, --output <path>', 'Output file path', './CHANGELOG.md')
  .option('--dry-run', 'Preview without writing')
  .option('--mock', 'Use mock LLM response for testing')
  .action(async (options) => {
    const config = loadConfig();
    const spinner = ora('Reading git history...').start();

    try {
      const fromRef = options.from || await getLatestTag() || 'HEAD~20';
      const toRef = options.to;

      const commits = await getCommitsSince(fromRef, toRef);

      if (commits.length === 0) {
        spinner.warn(chalk.yellow('No commits found in the specified range.'));
        return;
      }

      spinner.succeed(chalk.green(`Found ${commits.length} commits`));
      const genSpinner = ora('Generating CHANGELOG entry...').start();

      let changelog: string;
      if (options.mock) {
        await new Promise(r => setTimeout(r, 1000));
        const today = new Date().toISOString().split('T')[0];
        changelog = [
          `## [${options.version}] - ${today}`,
          '',
          '### Added',
          ...commits.filter(c => c.message.startsWith('feat')).map(c => `- ${c.message}`),
          '',
          '### Fixed',
          ...commits.filter(c => c.message.startsWith('fix')).map(c => `- ${c.message}`),
          '',
          '### Changed',
          ...commits.filter(c => !c.message.startsWith('feat') && !c.message.startsWith('fix')).map(c => `- ${c.message}`),
        ].join('\n');
      } else {
        const provider = createProvider(config);
        const templatesDir = path.resolve(__dirname, '../../templates');
        const generator = new Generator(provider, templatesDir);
        changelog = await generator.generateChangelog({
          commits,
          version: options.version,
          date: new Date().toISOString().split('T')[0],
          fromRef,
          toRef,
        });
      }

      genSpinner.succeed(chalk.green('CHANGELOG entry generated!'));

      if (options.dryRun) {
        console.log('\n' + changelog);
      } else {
        const outputPath = path.resolve(process.cwd(), options.output);
        const existing = readExistingMarkdown(outputPath);
        const header = '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n';
        const content = existing
          ? existing.replace(/^# Changelog.*?\n\n/s, header + changelog + '\n\n')
          : header + changelog;

        writeMarkdown(outputPath, content);
        console.log(chalk.green(`✔ Written to ${options.output}`));
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Failed to generate CHANGELOG'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
