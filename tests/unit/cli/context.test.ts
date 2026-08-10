import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { execFileSync } from "child_process";
import {
  enforceGeneratedOutput,
  loadCommandContext,
  prepareDocumentTarget,
  writeDoc,
} from "../../../src/cli/context";
import { RepositoryWriteScope } from "../../../src/security/repository-writer";
import * as diffDisplay from "../../../src/output/diff-display";

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
  it("uses the prepared snapshot for a diff before replacing the document once", async () => {
    // Catches a write adapter regression that re-reads a live output path or
    // bypasses PreparedRepositoryTarget.replaceText().
    const replaceText = jest.fn().mockResolvedValue(undefined);
    const displayDiff = jest
      .spyOn(diffDisplay, "displayDiff")
      .mockImplementation(() => undefined);

    try {
      await writeDoc(
        {
          displayPath: "README.md",
          existingText: "# Before\n",
          prepared: {
            displayPath: "README.md",
            existingText: "# Before\n",
            replaceText,
          },
        },
        "# After\n",
        { auto: true },
      );

      expect(displayDiff).toHaveBeenCalledWith(
        "README.md",
        "# Before\n",
        "# After\n",
      );
      expect(replaceText).toHaveBeenCalledTimes(1);
      expect(replaceText).toHaveBeenCalledWith("# After\n");
    } finally {
      displayDiff.mockRestore();
    }
  });

  it("rejects invalid Markdown before replacing a prepared document in strict-output mode", async () => {
    // Catches a strict-output regression that invokes the atomic writer before validation.
    const replaceText = jest.fn().mockResolvedValue(undefined);
    await expect(
      writeDoc(
        {
          displayPath: "README.md",
          existingText: null,
          prepared: {
            displayPath: "README.md",
            existingText: null,
            replaceText,
          },
        },
        "not a Markdown document",
        { strict: true },
      ),
    ).rejects.toThrow(/failed validation/i);
    expect(replaceText).not.toHaveBeenCalled();
  });
});

describe("prepareDocumentTarget", () => {
  const roots: string[] = [];

  function createRepository(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-context-"));
    execFileSync("git", ["init", "-q", "--initial-branch", "main"], {
      cwd: root,
    });
    roots.push(root);
    return root;
  }

  afterEach(() => {
    jest.restoreAllMocks();
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("opens the repository writer and snapshots the requested real target", async () => {
    // Catches a regression that resolves a raw output path or reads it outside
    // RepositoryWriteScope before it has been trusted.
    const root = createRepository();
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "docs", "README.md"), "# Before\n");
    const scope = await RepositoryWriteScope.open(root);
    const prepare = jest.spyOn(scope, "prepare");
    const open = jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue(scope);

    const target = await prepareDocumentTarget(root, "docs/README.md", false);

    expect(open).toHaveBeenCalledWith(root);
    expect(prepare).toHaveBeenCalledWith("docs/README.md");
    expect(target).toMatchObject({
      displayPath: path.join("docs", "README.md"),
      existingText: "# Before\n",
    });
    expect(target.prepared).toBeDefined();
  });

  it("reads a dry-run preview without opening the repository writer", async () => {
    // Catches a dry-run regression that creates a writer scope, directories, or temp files.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-context-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "preview.md"), "# Preview\n");
    const open = jest.spyOn(RepositoryWriteScope, "open");

    const target = await prepareDocumentTarget(root, "preview.md", true);

    expect(open).not.toHaveBeenCalled();
    expect(target).toEqual({
      displayPath: "preview.md",
      existingText: "# Preview\n",
    });
    expect(fs.readdirSync(root)).toEqual(["preview.md"]);
  });

  it("rejects a control-bearing dry-run target without opening a writer", async () => {
    // Catches a terminal-output injection regression that preserves raw target
    // text as a dry-run display label before lexical validation.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-context-"));
    roots.push(root);
    const open = jest.spyOn(RepositoryWriteScope, "open");

    await expect(
      prepareDocumentTarget(root, `preview/${String.fromCharCode(27)}[2J.md`, true),
    ).rejects.toMatchObject({ code: "TRUST_INVALID_PATH" });

    expect(open).not.toHaveBeenCalled();
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("uses a basename label for a valid external dry-run preview", async () => {
    // Catches a display-path regression that leaks an absolute external target
    // into diffs, confirmation prompts, or status messages.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-context-"));
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-external-"));
    roots.push(root, external);
    const externalTarget = path.join(external, "private-preview.md");
    fs.writeFileSync(externalTarget, "# Preview\n");
    const open = jest.spyOn(RepositoryWriteScope, "open");

    const target = await prepareDocumentTarget(root, externalTarget, true);

    expect(target).toEqual({
      displayPath: "private-preview.md",
      existingText: "# Preview\n",
    });
    expect(open).not.toHaveBeenCalled();
    expect(fs.readdirSync(root)).toEqual([]);
  });
});

describe("enforceGeneratedOutput", () => {
  it("turns command-specific validation warnings into a strict failure", () => {
    expect(() =>
      enforceGeneratedOutput(
        { isValid: false, warnings: ["Generated provider output is blank"] },
        { strictOutput: true },
        "README",
      ),
    ).toThrow("README failed validation: Generated provider output is blank");
  });
});
