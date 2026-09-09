import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  executeReviewCommand,
  createReviewReport,
} from "../../../src/cli/commands/review";
import * as planner from "../../../src/impact/planner";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "aidoc-review-cli-"));
  mkdirSync(join(root, "src"));
  git(root, "init", "-q", "--initial-branch", "main");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test");
  writeFileSync(join(root, "src", "user.ts"), "export function createUser(email: string): string { return email; }\n");
  writeFileSync(join(root, "README.md"), "# API\n\n## API\n\n`createUser`\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  return root;
}

describe("review command", () => {
  let root: string;
  beforeEach(() => { root = fixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("reports stale by default but fails only when fail-on stale is selected", async () => {
    writeFileSync(join(root, "src", "user.ts"), "export function createUser(email: number): number { return email; }\n");
    const output = { stdout: jest.fn(), stderr: jest.fn() };
    expect(await executeReviewCommand({ base: "HEAD", format: "json" }, output, root)).toBe(0);
    expect(JSON.parse(output.stdout.mock.calls[0][0]).verdict).toBe("stale");
    output.stdout.mockClear();
    expect(await executeReviewCommand({ base: "HEAD", format: "json", failOn: "stale" }, output, root)).toBe(1);
  });

  it("does not fail stale-only reports under the breaking policy", async () => {
    writeFileSync(
      join(root, "src", "user.ts"),
      "export function createUser(email: number): number { return email; }\n",
    );
    const output = { stdout: jest.fn(), stderr: jest.fn() };

    expect(
      await executeReviewCommand(
        { base: "HEAD", format: "json", failOn: "breaking" },
        output,
        root,
      ),
    ).toBe(0);
    expect(JSON.parse(output.stdout.mock.calls[0][0]).verdict).toBe("stale");
  });

  it("fails breaking reports under the breaking policy", async () => {
    writeFileSync(
      join(root, "src", "user.ts"),
      "export function createUser(email: string, role: string): string { return email; }\n",
    );
    const output = { stdout: jest.fn(), stderr: jest.fn() };

    expect(
      await executeReviewCommand(
        { base: "HEAD", format: "json", failOn: "breaking" },
        output,
        root,
      ),
    ).toBe(1);
    expect(JSON.parse(output.stdout.mock.calls[0][0]).verdict).toBe("breaking");
  });

  it.each([
    [{ format: "yaml" }, "format"],
    [{ failOn: "always" }, "fail-on"],
  ])("rejects an invalid %s option before planning", async (invalid, _label) => {
    const createPlan = jest.spyOn(planner, "createImpactPlan");
    const output = { stdout: jest.fn(), stderr: jest.fn() };

    expect(
      await executeReviewCommand(
        invalid as unknown as Parameters<typeof executeReviewCommand>[0],
        output,
        root,
      ),
    ).toBe(2);
    expect(output.stdout).not.toHaveBeenCalled();
    expect(output.stderr).toHaveBeenCalledWith(
      "Invalid review options: format or fail-on is not supported.\n",
    );
    expect(createPlan).not.toHaveBeenCalled();
  });

  it("reports an arity increase as breaking", async () => {
    writeFileSync(join(root, "src", "user.ts"), "export function createUser(email: string, role: string): string { return email; }\n");
    const result = await createReviewReport({ base: "HEAD" }, root);
    expect(result.verdict).toBe("breaking");
    expect(result.summary.breaking).toBe(1);
  });

  it("reports an added symbol as not mentioned when it has only a recommendation", async () => {
    writeFileSync(
      join(root, "src", "user.ts"),
      "export function createUser(email: string): string { return email; }\nexport function helperExport(): void {}\n",
    );

    const result = await createReviewReport({ base: "HEAD" }, root);

    expect(result.changes.map((change) => change.qualifiedName)).toEqual([
      "helperExport",
    ]);
    expect(result.documents).toEqual([]);
    expect(result.unmapped).toEqual(["helperExport"]);
    expect(result.summary.unmappedSymbols).toBe(1);
  });

  it("assesses a directly mentioned implementation-only change without listing it as a report change", async () => {
    writeFileSync(
      join(root, "src", "user.ts"),
      "export function createUser(email: string): string { return email.trim(); }\n",
    );

    const result = await createReviewReport({ base: "HEAD" }, root);

    expect(result.changes).toEqual([]);
    expect(result.summary.publicApiChanges).toBe(0);
    expect(result.documents).toEqual([
      {
        path: "README.md",
        status: "stale",
        sections: [
          { section: "API", slug: "api-1", symbols: ["createUser"] },
        ],
      },
    ]);
    expect(result.verdict).toBe("stale");
  });

  it("prints suppression detail in text while preserving a clean exit", async () => {
    writeFileSync(join(root, ".aidocignore"), "createUser\n");
    writeFileSync(
      join(root, "src", "user.ts"),
      "export function createUser(email: string, role: string): string { return email; }\n",
    );
    const output = { stdout: jest.fn(), stderr: jest.fn() };

    expect(
      await executeReviewCommand(
        { base: "HEAD", format: "text", failOn: "stale" },
        output,
        root,
      ),
    ).toBe(0);
    expect(output.stdout).toHaveBeenCalledWith(
      "No public API changes in this pull request.\n" +
        "1 suppressed change from .aidocignore.\n",
    );

    const result = await createReviewReport({ base: "HEAD" }, root);
    expect(result.verdict).toBe("clean");
    expect(result.summary.suppressed).toBe(1);
    expect(result.suppressed).toEqual([
      { symbol: "createUser", reason: "createUser" },
    ]);
  });
});
