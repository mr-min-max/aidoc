import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import * as path from 'path';
import * as fs from 'fs';
import { loadConfig } from '../../config/loader';
import { analyzeCodebase } from '../../core/analyzer';
import { Generator } from '../../core/generator';
import { createProvider } from '../../providers/factory';
import { writeMarkdown, readExistingMarkdown } from '../../output/markdown';
import { displayDiff } from '../../output/diff-display';

export const readmeCommand = new Command('readme')
  .description('Generate README.md from code analysis')
  .option('-o, --output <path>', 'Output file path', './README.md')
  .option('--dry-run', 'Preview without writing to file')
  .option('--no-badges', 'Skip badges generation')
  .option('--mock', 'Use mock LLM response for testing')
  .action(async (options) => {
    const config = loadConfig();
    const cwd = process.cwd();
    const spinner = ora('Scanning codebase...').start();

    try {
      const modules = await analyzeCodebase(cwd, config.include, config.exclude);
      spinner.text = 'Analyzing code structure...';

      if (modules.length === 0) {
        spinner.warn(chalk.yellow('No supported source files found. Make sure your project has .ts, .js, or .py files.'));
        return;
      }

      spinner.succeed(chalk.green(`Found ${modules.length} modules to analyze`));

      // Read package.json for project info
      const pkgPath = path.join(cwd, 'package.json');
      let projectName = path.basename(cwd);
      let description = '';
      let dependencies: string[] = [];

      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        projectName = pkg.name || projectName;
        description = pkg.description || '';
        dependencies = Object.keys(pkg.dependencies || {});
      }

      const genSpinner = ora('Generating README with AI...').start();

      let readme: string;
      if (options.mock) {
        await new Promise(r => setTimeout(r, 1000));
        const funcList = modules.flatMap(m => m.functions.map(f => `- \`${f.name}()\` — ${f.existingDoc || 'No description'}`));
        const classList = modules.flatMap(m => m.classes.map(c => `- \`${c.name}\` — ${c.existingDoc || 'No description'}`));

        readme = [
          `# ${projectName}`,
          '',
          `> ${description || 'An awesome project'}`,
          '',
          '[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)',
          '[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)',
          '',
          '## Features',
          '',
          '- 🧠 AI-powered documentation generation',
          '- 📊 AST-based code analysis',
          '- 🔄 Diff-aware documentation updates',
          '',
          '## Installation',
          '',
          '```bash',
          `npm install ${projectName}`,
          '```',
          '',
          '## API',
          '',
          ...(funcList.length > 0 ? ['### Functions', '', ...funcList, ''] : []),
          ...(classList.length > 0 ? ['### Classes', '', ...classList, ''] : []),
          '## License',
          '',
          'MIT',
        ].join('\n');
      } else {
        const provider = createProvider(config);
        const templatesDir = path.resolve(__dirname, '../../templates');
        const generator = new Generator(provider, templatesDir);
        readme = await generator.generateReadme({
          projectName,
          description,
          modules,
          dependencies,
          badges: options.badges !== false,
          tableOfContents: config.readme.tableOfContents,
          installSection: config.readme.installSection,
          usageExamples: config.readme.usageExamples,
        });
      }

      genSpinner.succeed(chalk.green('README generated!'));

      const outputPath = path.resolve(cwd, options.output);
      const existing = readExistingMarkdown(outputPath);

      if (existing) {
        displayDiff('README.md', existing, readme);
        if (!options.dryRun) {
          const { confirm } = await prompts({
            type: 'confirm',
            name: 'confirm',
            message: 'Apply changes to README.md?',
            initial: true,
          });
          if (confirm) {
            writeMarkdown(outputPath, readme);
            console.log(chalk.green(`✔ Written to ${options.output}`));
          } else {
            console.log(chalk.yellow('Skipped.'));
          }
        }
      } else if (options.dryRun) {
        console.log('\n' + readme);
      } else {
        writeMarkdown(outputPath, readme);
        console.log(chalk.green(`✔ Created ${options.output}`));
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Failed to generate README'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
