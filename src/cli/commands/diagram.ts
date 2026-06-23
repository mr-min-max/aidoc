import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { loadConfig } from '../../config/loader';
import { analyzeCodebase } from '../../core/analyzer';
import { Generator } from '../../core/generator';
import { createProvider } from '../../providers/factory';
import { writeMarkdown } from '../../output/markdown';

export const diagramCommand = new Command('diagram')
  .description('Generate architecture diagram (Mermaid) from code analysis')
  .option('-o, --output <path>', 'Output file path', './docs/architecture.md')
  .option('--dry-run', 'Preview without writing')
  .option('--mock', 'Use mock LLM response for testing')
  .action(async (options) => {
    const config = loadConfig();
    const cwd = process.cwd();
    const spinner = ora('Analyzing project architecture...').start();

    try {
      const modules = await analyzeCodebase(cwd, config.include, config.exclude);

      if (modules.length === 0) {
        spinner.warn(chalk.yellow('No supported source files found.'));
        return;
      }

      spinner.succeed(chalk.green(`Analyzed ${modules.length} modules`));
      const genSpinner = ora('Generating architecture diagram...').start();

      let diagram: string;
      if (options.mock) {
        await new Promise(r => setTimeout(r, 1000));
        const nodes = modules.map((m, i) => {
          const name = path.basename(m.filePath, path.extname(m.filePath));
          return `    N${i}["${name}"]`;
        });
        const edges = modules.slice(1).map((_, i) => `    N0 --> N${i + 1}`);
        diagram = `graph TD\n${nodes.join('\n')}\n${edges.join('\n')}`;
      } else {
        const provider = createProvider(config);
        const templatesDir = path.resolve(__dirname, '../../templates');
        const generator = new Generator(provider, templatesDir);
        diagram = await generator.generateDiagram(modules);
      }

      genSpinner.succeed(chalk.green('Architecture diagram generated!'));

      const output = `# Architecture\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n`;

      if (options.dryRun) {
        console.log('\n' + output);
      } else {
        const outputPath = path.resolve(cwd, options.output);
        writeMarkdown(outputPath, output);
        console.log(chalk.green(`✔ Written to ${options.output}`));
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Failed to generate diagram'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
