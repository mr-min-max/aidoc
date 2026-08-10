import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readmeCommand } from "../../../src/cli/commands/readme";
import { apiCommand } from "../../../src/cli/commands/api";
import { changelogCommand } from "../../../src/cli/commands/changelog";
import { diagramCommand } from "../../../src/cli/commands/diagram";
import { scoreCommand } from "../../../src/cli/commands/score";
import { MockGenerator } from "../../../src/cli/mock-generator";
import { defaultConfig } from "../../../src/config/loader";
import * as commandContext from "../../../src/cli/context";
import * as analyzer from "../../../src/core/analyzer";
import * as history from "../../../src/git/history";
import {
  RepositoryWriteScope,
  type PreparedRepositoryTarget,
} from "../../../src/security/repository-writer";
import { RepositoryWriteError } from "../../../src/security/types";
import type { ParsedModule } from "../../../src/parsers/types";

function parsedModules(cwd: string): ParsedModule[] {
  return [
    {
      filePath: path.join(cwd, "src", "index.ts"),
      language: "typescript",
      functions: [
        {
          name: "greet",
          parameters: [],
          returnType: "void",
          isAsync: false,
          isExported: true,
          lineRange: [1, 1],
          signature: "export function greet(): void",
        },
      ],
      classes: [],
      types: [],
      imports: [],
    },
  ];
}

function mockCommandContext(generator: MockGenerator, cwd: string): jest.SpyInstance {
  return jest.spyOn(commandContext, "loadCommandContext").mockResolvedValue({
    config: defaultConfig,
    cwd,
    generator,
    isMock: true,
  });
}

function rejectOutsideTarget(): {
  prepare: jest.Mock;
  open: jest.SpyInstance;
} {
  const prepare = jest
    .fn()
    .mockRejectedValue(new RepositoryWriteError("TRUST_PATH_OUTSIDE_ROOT"));
  const open = jest
    .spyOn(RepositoryWriteScope, "open")
    .mockResolvedValue({ prepare } as unknown as RepositoryWriteScope);
  return { prepare, open };
}

function suppressCommandFailure(): jest.SpyInstance {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  return jest
    .spyOn(process, "exit")
    .mockImplementation((() => undefined) as never);
}

describe("generated document command write preparation", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects an outside README target before provider transport", async () => {
    // Catches a command-order regression that sends AST data to a provider before output validation.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-command-"));
    const outside = path.join(cwd, "outside", "README.md");
    const generator = new MockGenerator();
    const generate = jest
      .spyOn(generator, "generateReadme")
      .mockRejectedValue(new Error("provider transport was called"));
    const load = mockCommandContext(generator, cwd);
    const analyze = jest
      .spyOn(analyzer, "analyzeCodebase")
      .mockResolvedValue(parsedModules(cwd));
    const { prepare } = rejectOutsideTarget();
    const exit = suppressCommandFailure();

    try {
      await readmeCommand.parseAsync(["--output", outside], {
        from: "user",
      });

      expect(prepare).toHaveBeenCalledWith(outside);
      expect(generate).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(2);
    } finally {
      load.mockRestore();
      analyze.mockRestore();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects an outside API target before provider transport", async () => {
    // Catches a command-order regression that invokes API generation before validating the output target.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-command-"));
    const outside = path.join(cwd, "outside", "API.md");
    const generator = new MockGenerator();
    const generate = jest
      .spyOn(generator, "generateApiDocs")
      .mockRejectedValue(new Error("provider transport was called"));
    const load = mockCommandContext(generator, cwd);
    const analyze = jest
      .spyOn(analyzer, "analyzeCodebase")
      .mockResolvedValue(parsedModules(cwd));
    const { prepare } = rejectOutsideTarget();
    const exit = suppressCommandFailure();

    try {
      await apiCommand.parseAsync(["--output", outside], { from: "user" });

      expect(prepare).toHaveBeenCalledWith(outside);
      expect(generate).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(2);
    } finally {
      load.mockRestore();
      analyze.mockRestore();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects an outside CHANGELOG target before provider transport", async () => {
    // Catches a command-order regression that sends Git history to a provider before validating the output target.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-command-"));
    const outside = path.join(cwd, "outside", "CHANGELOG.md");
    const generator = new MockGenerator();
    const generate = jest
      .spyOn(generator, "generateChangelog")
      .mockRejectedValue(new Error("provider transport was called"));
    const load = mockCommandContext(generator, cwd);
    const latestTag = jest.spyOn(history, "getLatestTag").mockResolvedValue("v1.0.0");
    const commits = jest.spyOn(history, "getCommitsSince").mockResolvedValue([
      {
        hash: "1234567",
        message: "Add safe changelog output",
        date: "2026-08-10",
        author: "AiDoc",
      },
    ]);
    const { prepare } = rejectOutsideTarget();
    const exit = suppressCommandFailure();

    try {
      await changelogCommand.parseAsync(["--output", outside], {
        from: "user",
      });

      expect(prepare).toHaveBeenCalledWith(outside);
      expect(generate).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(2);
    } finally {
      load.mockRestore();
      latestTag.mockRestore();
      commits.mockRestore();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects an outside diagram target before provider transport", async () => {
    // Catches a command-order regression that invokes diagram generation before validating the output target.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-command-"));
    const outside = path.join(cwd, "outside", "architecture.md");
    const generator = new MockGenerator();
    const generate = jest
      .spyOn(generator, "generateDiagram")
      .mockRejectedValue(new Error("provider transport was called"));
    const load = mockCommandContext(generator, cwd);
    const analyze = jest
      .spyOn(analyzer, "analyzeCodebase")
      .mockResolvedValue(parsedModules(cwd));
    const { prepare } = rejectOutsideTarget();
    const exit = suppressCommandFailure();

    try {
      await diagramCommand.parseAsync(["--output", outside], {
        from: "user",
      });

      expect(prepare).toHaveBeenCalledWith(outside);
      expect(generate).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(2);
    } finally {
      load.mockRestore();
      analyze.mockRestore();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps a README dry-run free of writer scopes and filesystem output", async () => {
    // Catches a dry-run regression that opens a writer scope or creates parent directories and temp files.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-command-"));
    const output = path.join("preview", "README.md");
    const generator = new MockGenerator();
    const generate = jest
      .spyOn(generator, "generateReadme")
      .mockResolvedValue("# Preview\n");
    const load = mockCommandContext(generator, cwd);
    const analyze = jest
      .spyOn(analyzer, "analyzeCodebase")
      .mockResolvedValue(parsedModules(cwd));
    const open = jest.spyOn(RepositoryWriteScope, "open");
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const exit = suppressCommandFailure();

    try {
      await readmeCommand.parseAsync(["--dry-run", "--output", output], {
        from: "user",
      });

      expect(generate).toHaveBeenCalledTimes(1);
      expect(open).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(cwd, "preview"))).toBe(false);
      expect(fs.readdirSync(cwd)).toEqual([]);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      load.mockRestore();
      analyze.mockRestore();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects a control-bearing README dry-run target before provider transport", async () => {
    // Catches a command-order regression that permits an unsafe dry-run label
    // to reach provider generation or rendered CLI output.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-command-"));
    const output = `preview/${String.fromCharCode(27)}[2JREADME.md`;
    const generator = new MockGenerator();
    const generate = jest
      .spyOn(generator, "generateReadme")
      .mockRejectedValue(new Error("provider transport was called"));
    const load = mockCommandContext(generator, cwd);
    const analyze = jest
      .spyOn(analyzer, "analyzeCodebase")
      .mockResolvedValue(parsedModules(cwd));
    const open = jest.spyOn(RepositoryWriteScope, "open");
    const exit = suppressCommandFailure();

    try {
      await readmeCommand.parseAsync(["--dry-run", "--output", output], {
        from: "user",
      });

      expect(generate).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(2);
      expect(fs.readdirSync(cwd)).toEqual([]);
    } finally {
      load.mockRestore();
      analyze.mockRestore();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("merges a changelog entry with the target snapshot instead of a post-provider file read", async () => {
    // Catches a time-of-check/time-of-use regression that discards the prepared snapshot after generation.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-command-"));
    const output = path.join(cwd, "CHANGELOG.md");
    const existingText = "# Changelog\n\n## [0.1.0]\n\n- Snapshot entry\n";
    const replaceText = jest.fn().mockResolvedValue(undefined);
    const prepared: PreparedRepositoryTarget = {
      displayPath: "CHANGELOG.md",
      existingText,
      replaceText,
    };
    const prepare = jest.fn().mockResolvedValue(prepared);
    const open = jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({ prepare } as unknown as RepositoryWriteScope);
    const generator = new MockGenerator();
    const entry = "## [Unreleased] - 2026-08-11\n\n### Added\n\n- Prepared output\n";
    const generate = jest
      .spyOn(generator, "generateChangelog")
      .mockImplementation(async () => {
        fs.writeFileSync(
          output,
          "# Changelog\n\n## [0.1.0]\n\n- Post-provider entry\n",
        );
        return entry;
      });
    const load = mockCommandContext(generator, cwd);
    const latestTag = jest.spyOn(history, "getLatestTag").mockResolvedValue("v1.0.0");
    const commits = jest.spyOn(history, "getCommitsSince").mockResolvedValue([
      {
        hash: "1234567",
        message: "Add safe changelog output",
        date: "2026-08-10",
        author: "AiDoc",
      },
    ]);
    const exit = suppressCommandFailure();

    try {
      await changelogCommand.parseAsync(["--yes"], { from: "user" });

      expect(open).toHaveBeenCalledWith(cwd);
      expect(prepare).toHaveBeenCalledWith("./CHANGELOG.md");
      expect(generate).toHaveBeenCalledTimes(1);
      expect(replaceText).toHaveBeenCalledTimes(1);
      expect(replaceText.mock.calls[0]?.[0]).toContain("Snapshot entry");
      expect(replaceText.mock.calls[0]?.[0]).not.toContain("Post-provider entry");
      expect(exit).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
      latestTag.mockRestore();
      commits.mockRestore();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("score writer construction", () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    jest.restoreAllMocks();
  });

  it("does not construct a writer when score has no output", async () => {
    const invocationCwd = fs.mkdtempSync(
      path.join(os.tmpdir(), "aidoc-score-invocation-"),
    );
    const analysisDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "aidoc-score-analysis-"),
    );
    process.chdir(invocationCwd);
    jest.spyOn(analyzer, "analyzeCodebase").mockResolvedValue([]);
    const open = jest.spyOn(RepositoryWriteScope, "open");
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    const exit = suppressCommandFailure();

    try {
      await scoreCommand.parseAsync(["--dir", analysisDir], { from: "user" });

      expect(open).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(invocationCwd, { recursive: true, force: true });
      fs.rmSync(analysisDir, { recursive: true, force: true });
    }
  });

  it("keeps score dry-run output free of writer scopes and mutation", async () => {
    const invocationCwd = fs.mkdtempSync(
      path.join(os.tmpdir(), "aidoc-score-invocation-"),
    );
    const output = path.join("preview", "score.md");
    process.chdir(invocationCwd);
    jest.spyOn(analyzer, "analyzeCodebase").mockResolvedValue([]);
    const open = jest.spyOn(RepositoryWriteScope, "open");
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    const exit = suppressCommandFailure();

    try {
      await scoreCommand.parseAsync(["--dry-run", "--output", output], {
        from: "user",
      });

      expect(open).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(invocationCwd, "preview"))).toBe(false);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(invocationCwd, { recursive: true, force: true });
    }
  });

  // Break caught: score resolves its output from a later process cwd (or the
  // analysis directory) instead of the invocation repository captured at entry.
  it("opens real score output from invocation cwd independently of analysis dir", async () => {
    const invocationCwd = fs.mkdtempSync(
      path.join(os.tmpdir(), "aidoc-score-invocation-"),
    );
    const analysisDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "aidoc-score-analysis-"),
    );
    process.chdir(invocationCwd);
    const capturedInvocationCwd = process.cwd();
    jest
      .spyOn(analyzer, "analyzeCodebase")
      .mockImplementation(async (cwd) => {
        expect(cwd).toBe(analysisDir);
        process.chdir(analysisDir);
        return [];
      });
    const replaceText = jest.fn().mockResolvedValue(undefined);
    const prepare = jest.fn().mockResolvedValue({
      displayPath: "score.md",
      existingText: null,
      replaceText,
    });
    const open = jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue({ prepare } as unknown as RepositoryWriteScope);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    const exit = suppressCommandFailure();

    try {
      await scoreCommand.parseAsync(
        ["--dir", analysisDir, "--output", "score.md"],
        { from: "user" },
      );

      expect(open).toHaveBeenCalledWith(capturedInvocationCwd);
      expect(prepare).toHaveBeenCalledWith("score.md");
      expect(replaceText).toHaveBeenCalledTimes(1);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(invocationCwd, { recursive: true, force: true });
      fs.rmSync(analysisDir, { recursive: true, force: true });
    }
  });

  it("rejects outside score output with status 2 and no report file", async () => {
    const invocationCwd = fs.mkdtempSync(
      path.join(os.tmpdir(), "aidoc-score-invocation-"),
    );
    const outsideDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "aidoc-score-outside-"),
    );
    const outside = path.join(outsideDir, "score.md");
    process.chdir(invocationCwd);
    jest.spyOn(analyzer, "analyzeCodebase").mockResolvedValue([]);
    const { prepare } = rejectOutsideTarget();
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    const exit = suppressCommandFailure();

    try {
      await scoreCommand.parseAsync(["--output", outside], { from: "user" });

      expect(prepare).toHaveBeenCalledWith(outside);
      expect(exit).toHaveBeenCalledWith(2);
      expect(fs.existsSync(outside)).toBe(false);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(invocationCwd, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
