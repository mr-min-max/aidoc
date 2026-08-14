import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createMCPServerContext,
  handleToolCall,
} from "../../../src/mcp/server";

describe("MCP parser diagnostics", () => {
  it("does not serialize malformed source content in freshness results", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-mcp-parser-"));
    const hooks = path.join(root, "empty-hooks");
    const fakeSourceSecret = ["sk", "proj", "M".repeat(32)].join("-");
    fs.mkdirSync(path.join(root, "src"));
    fs.mkdirSync(hooks);

    const git = (...args: string[]): string =>
      execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    const commit = (message: string): void => {
      git("add", ".");
      git(
        "-c",
        "commit.gpgSign=false",
        "-c",
        `core.hooksPath=${hooks}`,
        "commit",
        "-m",
        message,
      );
    };

    try {
      git("init", "--quiet", `--template=${hooks}`);
      git("config", "user.name", "aidoc test");
      git("config", "user.email", "aidoc-test@example.invalid");
      fs.writeFileSync(path.join(root, "README.md"), "# Fixture\n");
      commit("fixture: baseline");
      const base = git("rev-parse", "HEAD");
      fs.writeFileSync(
        path.join(root, "src", "broken.py"),
        `def broken(${fakeSourceSecret}:\n`,
      );
      commit("fixture: malformed python");

      const context = await createMCPServerContext(root, Object.create(null));
      const result = (await handleToolCall(
        "check_docs_freshness",
        {
          directory: root,
          doc_file: "README.md",
          since: base,
        },
        context,
      )) as { status: string; message: string };

      expect(result.status).toBe("unknown");
      expect(result.message).not.toContain(fakeSourceSecret);
      expect(JSON.stringify(result)).not.toContain(fakeSourceSecret);
      expect(result.message).toBe(
        "Could not evaluate documentation freshness: the source parser failed safely.",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
