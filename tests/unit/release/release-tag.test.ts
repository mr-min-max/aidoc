import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const verifier = path.resolve("scripts/verify-pushed-release-tag.mjs");
const tagName = "v0.2.0-beta.5";
const tagRef = `refs/tags/${tagName}`;

function gitAs(cwd: string, email: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "mr-min-max",
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: "mr-min-max",
      GIT_COMMITTER_EMAIL: email,
    },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args[0]} failed`);
  }
  return result.stdout.trim();
}

function git(cwd: string, ...args: string[]): string {
  return gitAs(cwd, "254284659+mr-min-max@users.noreply.github.com", ...args);
}

function runVerifier(cwd: string, reference = tagRef) {
  return spawnSync(process.execPath, [verifier, "--ref", reference], {
    cwd,
    encoding: "utf8",
  });
}

describe("pushed release tag verifier", () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-tag-"));
    git(repository, "init", "--initial-branch=main");
    fs.writeFileSync(path.join(repository, "release.txt"), "candidate\n");
    git(repository, "add", "release.txt");
    git(repository, "commit", "-m", "release candidate");
  });

  afterEach(() => {
    fs.rmSync(repository, { recursive: true, force: true });
  });

  it("accepts an annotated protected-identity tag pointing directly to HEAD", () => {
    git(repository, "tag", "-a", tagName, "-m", tagName);

    const result = runVerifier(repository);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Release tag object is verified.\n");
    expect(result.stderr).toBe("");
  });

  it("rejects a lightweight tag with a fixed value-free diagnostic", () => {
    git(repository, "tag", tagName);

    const result = runVerifier(repository);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Release tag object could not be verified.\n");
    expect(result.stderr).not.toContain(repository);
  });

  it("rejects an annotated tag that does not point directly to HEAD", () => {
    const previousCommit = git(repository, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(repository, "release.txt"), "advanced\n");
    git(repository, "add", "release.txt");
    git(repository, "commit", "-m", "advance main");
    git(repository, "tag", "-a", tagName, previousCommit, "-m", tagName);

    const result = runVerifier(repository);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Release tag object could not be verified.\n");
  });

  it("rejects a ref whose annotated tag object declares another tag name", () => {
    git(repository, "tag", "-a", "v0.2.0-beta.4", "-m", "old tag");
    const tagObject = git(
      repository,
      "rev-parse",
      "refs/tags/v0.2.0-beta.4^{tag}",
    );
    git(repository, "update-ref", tagRef, tagObject);

    const result = runVerifier(repository);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Release tag object could not be verified.\n");
  });

  it("rejects an otherwise valid tag created with an unapproved identity", () => {
    gitAs(
      repository,
      "maintainer@example.invalid",
      "tag",
      "-a",
      tagName,
      "-m",
      tagName,
    );

    const result = runVerifier(repository);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Release tag object could not be verified.\n");
    expect(result.stderr).not.toContain("maintainer@example.invalid");
  });

  it("rejects malformed or non-tag refs before invoking Git", () => {
    const result = runVerifier(repository, "HEAD");

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Release tag arguments are invalid.\n");
  });
});
