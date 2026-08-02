import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as commandContext from "../../../src/cli/context";
import * as templates from "../../../src/core/templates";
import * as providerRegistry from "../../../src/providers/registry";
import * as parserRegistry from "../../../src/parsers/registry";
import {
  executePlanCommand,
  planCommand,
  type PlanCommandIO,
} from "../../../src/cli/commands/plan";

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "aidoc-plan-cli-"));
  const hooks = join(root, "hooks");
  mkdirSync(hooks);
  execFileSync("git", ["init", "-q", "--initial-branch", "main"], {
    cwd: root,
  });
  execFileSync("git", ["config", "core.hooksPath", hooks], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  writeFileSync(
    join(root, "index.ts"),
    "export function greet(name: string): string { return name; }\n",
  );
  execFileSync("git", ["add", "--", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });
  writeFileSync(join(root, "README.md"), "# API\n\n`greet`\n");
  execFileSync("git", ["add", "--", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "docs"], { cwd: root });
  writeFileSync(
    join(root, "index.ts"),
    "export function greet(name: number): number { return name; }\n",
  );
  return root;
}

function capture(): {
  io: PlanCommandIO;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    },
    stdout,
    stderr,
  };
}

describe("plan command", () => {
  let root: string;

  beforeEach(() => {
    root = repository();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  // Break caught: planning accidentally enters provider bootstrap and begins
  // requiring credentials for an AST-only command.
  it("succeeds without flags or provider credentials and stays provider-free", async () => {
    const dotenvConfig = jest.spyOn(require("dotenv"), "config");
    const loadContext = jest.spyOn(commandContext, "loadCommandContext");
    const resolveTemplates = jest.spyOn(templates, "resolveTemplatesDir");
    const createProvider = jest.spyOn(providerRegistry, "createProvider");
    const output = capture();

    const code = await executePlanCommand({}, output.io, root);

    expect(code).toBe(0);
    expect(output.stderr).toEqual([]);
    expect(output.stdout.join("")).toMatch(
      /^Documentation impact: 1 public API change/u,
    );
    expect(output.stdout.join("")).toMatch(/Next: aidoc update\n?$/u);
    expect(dotenvConfig).not.toHaveBeenCalled();
    expect(loadContext).not.toHaveBeenCalled();
    expect(resolveTemplates).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
  });

  // Break caught: JSON success is contaminated by progress output or split
  // across writes, making it unsafe for CI consumers.
  it("writes exactly one clean JSON success object", async () => {
    const output = capture();

    expect(await executePlanCommand({ json: true }, output.io, root)).toBe(0);

    expect(output.stderr).toEqual([]);
    expect(output.stdout).toHaveLength(1);
    const result = JSON.parse(output.stdout[0]);
    expect(result).toEqual({
      ok: true,
      plan: expect.objectContaining({
        schemaVersion: "aidoc.impact-plan.v1",
      }),
    });
    expect(output.stdout[0]).not.toContain("\n");
    expect(output.stdout[0]).not.toContain("\u001b[");
  });

  // Break caught: failures leak Git/raw error data, use stderr in JSON mode,
  // or return success despite an invalid ref.
  it("emits one safe JSON failure object and exit 1", async () => {
    const output = capture();

    expect(
      await executePlanCommand(
        { json: true, base: "-hostile-ref" },
        output.io,
        root,
      ),
    ).toBe(1);

    expect(output.stderr).toEqual([]);
    expect(output.stdout).toHaveLength(1);
    expect(JSON.parse(output.stdout[0])).toEqual({
      ok: false,
      error: {
        code: "PLAN_INVALID_REF",
        message: "The Git reference is invalid.",
      },
    });
  });

  // Break caught: human failure output omits its stable code or exposes an
  // unsafe lower-level diagnostic.
  it("writes only the safe code and message for a human failure", async () => {
    const output = capture();

    expect(
      await executePlanCommand({ head: "missing-ref" }, output.io, root),
    ).toBe(1);

    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual([
      "PLAN_HEAD_NOT_FOUND: The Git head could not be resolved.\n",
    ]);
    expect(output.stderr[0]).not.toContain(root);
  });

  // Break caught: malformed CLI budgets reach Git/source parsing before being
  // rejected at the planning boundary.
  it("rejects invalid budgets before parsing any Git content", async () => {
    const parserLookup = jest.spyOn(parserRegistry, "getSnapshotParserForFile");
    const output = capture();

    expect(
      await executePlanCommand(
        { json: true, maxContextBytes: "1e4" },
        output.io,
        root,
      ),
    ).toBe(1);

    expect(parserLookup).not.toHaveBeenCalled();
    expect(JSON.parse(output.stdout[0])).toEqual({
      ok: false,
      error: {
        code: "PLAN_INVALID_CONTEXT_BUDGET",
        message: "The provider context byte budget is invalid.",
      },
    });
  });

  // Break caught: command registration grows provider flags or omits one of
  // the four planning-only options.
  it("registers exactly the approved planning flags", () => {
    expect(planCommand.options.map((option) => option.flags)).toEqual([
      "--base <ref>",
      "--head <ref>",
      "--json",
      "--max-context-bytes <count>",
    ]);
  });
});
