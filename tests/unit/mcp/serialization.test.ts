import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { registerProvider } from "../../../src/providers/registry";
import {
  createMCPServerContext,
  handleToolCall,
} from "../../../src/mcp/server";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function snapshotFixture(root: string): Array<{ file: string; hash: string }> {
  const files: Array<{ file: string; hash: string }> = [];

  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push({
        file: path.relative(root, absolutePath),
        hash: createHash("sha256")
          .update(fs.readFileSync(absolutePath))
          .digest("hex"),
      });
    }
  }

  visit(root);
  return files.sort((left, right) => left.file.localeCompare(right.file));
}

describe("MCP provider output serialization", () => {
  it("rejects a registered provider object before MCP can serialize it", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-mcp-object-"));
    const providerName = `object-mcp-provider-${Date.now()}`;
    const fakeSecret = ["sk", "proj", "S".repeat(32)].join("-");
    let serializationCalls = 0;
    const unsafeOutput = {
      toString: () => "# harmless",
      toJSON: () => {
        serializationCalls += 1;
        return fakeSecret;
      },
    };

    registerProvider({
      name: providerName,
      available: () => true,
      create: () => ({
        name: providerName,
        generate: async () => unsafeOutput as unknown as string,
      }),
    });
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({ provider: providerName, trustPolicy: "redact" }),
    );
    fs.writeFileSync(
      path.join(root, "src", "index.ts"),
      "export function documented(): string { return 'safe'; }\n",
    );
    git(root, "init", "--quiet");
    git(root, "config", "user.name", "aidoc test");
    git(root, "config", "user.email", "aidoc-test@example.invalid");
    git(root, "add", ".");
    git(root, "-c", "commit.gpgSign=false", "commit", "-m", "fixture");

    try {
      const context = await createMCPServerContext(root, Object.create(null));
      await expect(
        handleToolCall("generate_readme", { directory: root }, context),
      ).rejects.toMatchObject({ code: "TRUST_INVALID_PROVIDER_OUTPUT" });
      expect(serializationCalls).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("generates content without mutating the fixture tree", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-mcp-readonly-"));
    const providerName = `readonly-mcp-provider-${Date.now()}`;
    registerProvider({
      name: providerName,
      available: () => true,
      create: () => ({
        name: providerName,
        generate: async () => "# Generated content\n",
      }),
    });
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({ provider: providerName, trustPolicy: "strict" }),
    );
    fs.writeFileSync(
      path.join(root, "src", "index.ts"),
      "export function documented(): string { return 'safe'; }\n",
    );
    git(root, "init", "--quiet");
    git(root, "config", "user.name", "aidoc test");
    git(root, "config", "user.email", "aidoc-test@example.invalid");
    git(root, "add", ".");
    git(root, "-c", "commit.gpgSign=false", "commit", "-m", "fixture");

    try {
      const context = await createMCPServerContext(root, Object.create(null));
      const before = snapshotFixture(root);
      await expect(
        handleToolCall("generate_readme", { directory: root }, context),
      ).resolves.toEqual({
        content: "# Generated content\n",
        format: "markdown",
      });
      await expect(
        handleToolCall("generate_api_docs", { directory: root }, context),
      ).resolves.toEqual({
        content: "# Generated content\n",
        format: "markdown",
      });
      await expect(
        handleToolCall("generate_diagram", { directory: root }, context),
      ).resolves.toEqual({
        content: "# Generated content\n",
        format: "mermaid",
      });
      expect(snapshotFixture(root)).toEqual(before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
