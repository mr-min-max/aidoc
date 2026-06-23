import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { loadConfig } from '../../config/loader';
import { analyzeCodebase } from '../../core/analyzer';
import { Generator } from '../../core/generator';
import { createProvider } from '../../providers/factory';
import { writeMarkdown } from '../../output/markdown';

export const apiCommand = new Command('api')
  .description('Generate API documentation from code analysis')
  .option('-o, --output <path>', 'Output file path', './docs/API.md')
  .option('--dry-run', 'Preview without writing to file')
  .option('--mock', 'Use mock LLM response for testing')
  .action(async (options) => {
    const config = loadConfig();
    const cwd = process.cwd();
    const spinner = ora('Scanning codebase for API symbols...').start();

    try {
      const modules = await analyzeCodebase(cwd, config.include, config.exclude);

      if (modules.length === 0) {
        spinner.warn(chalk.yellow('No supported source files found.'));
        return;
      }

      spinner.succeed(chalk.green(`Found ${modules.length} modules`));
      const genSpinner = ora('Generating API documentation...').start();

      let apiDocs: string;
      if (options.mock) {
        await new Promise(r => setTimeout(r, 1000));
        const sections = modules.map(m => {
          const funcs = m.functions.map(f =>
            `### \`${f.name}(${f.parameters.map(p => p.name).join(', ')})\`\n\n${f.existingDoc || 'No description available.'}\n\n**Returns:** \`${f.returnType}\`\n`
          ).join('\n');
          const classes = m.classes.map(c =>
            `### Class: \`${c.name}\`\n\n${c.existingDoc || 'No description available.'}\n`
          ).join('\n');
          return `## ${path.basename(m.filePath)}\n\n${funcs}${classes}`;
        });
        apiDocs = `# API Documentation\n\n${sections.join('\n---\n\n')}`;
      } else {
        const provider = createProvider(config);
        const templatesDir = path.resolve(__dirname, '../../templates');
        const generator = new Generator(provider, templatesDir);
        apiDocs = await generator.generateApiDocs(modules);
      }

      genSpinner.succeed(chalk.green('API documentation generated!'));

      if (options.dryRun) {
        console.log('\n' + apiDocs);
      } else {
        const outputPath = path.resolve(cwd, options.output);
        writeMarkdown(outputPath, apiDocs);
        console.log(chalk.green(`✔ Written to ${options.output}`));
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Failed to generate API docs'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
