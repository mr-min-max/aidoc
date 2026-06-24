import simpleGit from "simple-git";

export interface CommitInfo {
  hash: string;
  message: string;
  date: string;
  author: string;
}

export async function getGitRoot(cwd?: string): Promise<string> {
  const git = cwd ? simpleGit(cwd) : simpleGit();
  const root = await git.revparse(["--show-toplevel"]);
  return root.trim();
}

export async function getCommitsSince(
  fromRef: string,
  toRef: string = "HEAD",
  cwd?: string,
): Promise<CommitInfo[]> {
  const git = cwd ? simpleGit(cwd) : simpleGit();
  const log = await git.log({ from: fromRef, to: toRef });

  return log.all.map((commit) => ({
    hash: commit.hash.substring(0, 7),
    message: commit.message,
    date: commit.date,
    author: (commit as any).author_name || "",
  }));
}

export async function getDiff(
  fromRef: string,
  toRef: string = "HEAD",
  cwd?: string,
): Promise<string> {
  const git = cwd ? simpleGit(cwd) : simpleGit();
  return git.diff([`${fromRef}..${toRef}`]);
}

export async function getChangedFiles(
  fromRef: string,
  toRef: string = "HEAD",
  cwd?: string,
): Promise<string[]> {
  const git = cwd ? simpleGit(cwd) : simpleGit();
  const result = await git.diff(["--name-only", `${fromRef}..${toRef}`]);
  return result.trim().split("\n").filter(Boolean);
}

export async function getLatestTag(cwd?: string): Promise<string | null> {
  const git = cwd ? simpleGit(cwd) : simpleGit();
  try {
    const tag = await git.raw(["describe", "--tags", "--abbrev=0"]);
    return tag.trim();
  } catch {
    return null;
  }
}
