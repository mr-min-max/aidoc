import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
const read = (file: string) =>
  readFileSync(path.join(root, file), { encoding: "utf8" });
const packageJson = JSON.parse(read("package.json"));
const cli = read("src/cli/index.ts");
const action = read("action.yml");
const publicBeta = read("docs/PUBLIC_BETA.md");
const activeCopy = [packageJson.description, cli, action, publicBeta].join(
  "\n",
);

describe("active AiDoc product copy", () => {
  it("uses one broad AST-first product position", () => {
    expect(packageJson.description).toBe(
      "AST-first documentation workflow for codebases. Create README and API docs, map code changes to affected files, and review focused updates with Codex, Claude, Ollama, or supported providers.",
    );
    expect(cli).toContain(
      '"AST-first documentation creation and change-aware updates for codebases."',
    );
    expect(action).toContain('name: "AiDoc: AST-first documentation workflow"');
    expect(action).toContain(
      'description: "Generate project documentation and run deterministic change-aware checks in CI."',
    );
    expect(publicBeta).toContain("Documentation that keeps up with your code.");
  });

  it("removes conflicting generic and synthetic copy", () => {
    expect(activeCopy).not.toContain(
      "AI-powered documentation generator for codebases",
    );
    expect(activeCopy).not.toContain("professional documentation");
    expect(activeCopy).not.toContain("🤖");
    expect(activeCopy).not.toContain("\u2014");
  });
});
