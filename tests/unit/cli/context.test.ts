import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { loadCommandContext, writeDoc } from "../../../src/cli/context";

describe("loadCommandContext", () => {
  it("returns a mock generator when mock is set", async () => {
    const ctx = await loadCommandContext({ mock: true });
    expect(ctx.isMock).toBe(true);
    expect(ctx.generator.constructor.name).toBe("MockGenerator");
  });

  it("loads configuration from the project directory being analyzed", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-context-"));
    try {
      fs.writeFileSync(
        path.join(root, ".aidocrc.json"),
        JSON.stringify({ model: "project-model" }),
      );
      const ctx = await loadCommandContext({ mock: true }, root);
      expect(ctx.config.model).toBe("project-model");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("writeDoc", () => {
  const tmp = path.join(os.tmpdir(), `aidoc-test-${Date.now()}.md`);

  afterEach(() => {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  });

  it("creates a new file (no existing, no dry-run)", async () => {
    await writeDoc(tmp, "# Hello\n", {});
    expect(fs.readFileSync(tmp, "utf8")).toBe("# Hello\n");
  });

  it("dry-run writes nothing", async () => {
    await writeDoc(tmp, "# Hello\n", { dryRun: true });
    expect(fs.existsSync(tmp)).toBe(false);
  });

  it("rejects invalid Markdown before writing in strict-output mode", async () => {
    const target = path.join(os.tmpdir(), `aidoc-strict-${Date.now()}.md`);
    await expect(
      writeDoc(target, "not a Markdown document", { strict: true }),
    ).rejects.toThrow(/failed validation/i);
    expect(fs.existsSync(target)).toBe(false);
  });
});
