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

function runVerifier(
  cwd: string,
  options: { tag?: string; expectedSha?: string } = {},
) {
  const args = [
    verifier,
    "--main-ref",
    "refs/heads/main",
    "--candidate-ref",
    "HEAD",
    "--tag",
    options.tag ?? "v0.2.0-beta.4",
  ];
  if (options.expectedSha) {
    args.push("--expected-sha", options.expectedSha);
  }
  return spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
}

describe("release candidate verifier", () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-release-"));
    git(repository, "init", "--initial-branch=main");
    fs.writeFileSync(
      path.join(repository, "package.json"),
      JSON.stringify({
        name: "@mr-min-max/aidoc-gen",
        version: "0.2.0-beta.4",
      }),
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
    const result = runVerifier(repository, { tag: "v0.2.0-beta.3" });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Release tag does not match the package version.\n",
    );
  });

  it("rejects the superseded unscoped package name", () => {
    fs.writeFileSync(
      path.join(repository, "package.json"),
      JSON.stringify({ name: "aidoc-gen", version: "0.2.0-beta.4" }),
    );

    const result = runVerifier(repository);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Release package metadata could not be verified.\n",
    );
  });

  it("rejects a stale verified SHA even when the candidate remains on main", () => {
    const verifiedSha = git(repository, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(repository, "advanced.txt"), "main advanced\n");
    git(repository, "add", "advanced.txt");
    git(repository, "commit", "-m", "advance protected main");

    const result = spawnSync(
      "bash",
      [
        "-c",
        '"$1" "$2" --main-ref refs/heads/main --candidate-ref HEAD --tag v0.2.0-beta.4 --expected-sha "$3" && git tag -a v0.2.0-beta.4 "$3" -m v0.2.0-beta.4',
        "release-chain",
        process.execPath,
        verifier,
        verifiedSha,
      ],
      { cwd: repository, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Release candidate does not match the previously verified commit.\n",
    );
    expect(git(repository, "tag", "--list", "v0.2.0-beta.4")).toBe("");
  });
});
