import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const verifier = path.resolve("scripts/verify-release-candidate.mjs");

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Release Test",
      GIT_AUTHOR_EMAIL: "release-test@users.noreply.github.com",
      GIT_COMMITTER_NAME: "Release Test",
      GIT_COMMITTER_EMAIL: "release-test@users.noreply.github.com",
    },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args[0]} failed`);
  }
  return result.stdout.trim();
}

function runVerifier(cwd: string, tag = "v0.2.0-beta.3") {
  return spawnSync(
    process.execPath,
    [
      verifier,
      "--main-ref",
      "refs/heads/main",
      "--candidate-ref",
      "HEAD",
      "--tag",
      tag,
    ],
    { cwd, encoding: "utf8" },
  );
}

describe("release candidate verifier", () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-release-"));
    git(repository, "init", "--initial-branch=main");
    fs.writeFileSync(
      path.join(repository, "package.json"),
      JSON.stringify({ name: "aidoc-gen", version: "0.2.0-beta.3" }),
    );
    git(repository, "add", "package.json");
    git(repository, "commit", "-m", "initial release candidate");
  });

  afterEach(() => {
    fs.rmSync(repository, { recursive: true, force: true });
  });

  it("accepts a matching tag whose candidate commit is contained in main", () => {
    const result = runVerifier(repository);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("rejects an unmerged descendant of main", () => {
    git(repository, "switch", "-c", "unmerged-release");
    fs.writeFileSync(path.join(repository, "unmerged.txt"), "not on main\n");
    git(repository, "add", "unmerged.txt");
    git(repository, "commit", "-m", "unmerged release work");

    const result = runVerifier(repository);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Release candidate is not contained in the protected main branch.\n",
    );
    expect(result.stderr).not.toContain(repository);
  });

  it("rejects a tag that does not exactly match the package version", () => {
    const result = runVerifier(repository, "v0.2.0-beta.4");

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Release tag does not match the package version.\n",
    );
  });
});
