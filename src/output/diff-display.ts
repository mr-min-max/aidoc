import chalk from "chalk";
import { createTwoFilesPatch } from "diff";

/** Prints a colorized unified diff for an existing documentation file. */
export function displayDiff(
  filename: string,
  oldContent: string,
  newContent: string,
): void {
  const patch = createTwoFilesPatch(
    `a/${filename}`,
    `b/${filename}`,
    oldContent,
    newContent,
  );

  console.log("");
  const lines = patch.split("\n");
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      console.log(chalk.green(line));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      console.log(chalk.red(line));
    } else if (line.startsWith("@@")) {
      console.log(chalk.cyan(line));
    } else {
      console.log(chalk.gray(line));
    }
  }
  console.log("");
}
