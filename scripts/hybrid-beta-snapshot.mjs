import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Hash the current fixture tree, including tracked and untracked entries.
 * The .git directory is excluded and symlinks are recorded without following
 * them. The current HEAD identity is included so commit-only changes are also
 * detected. This is intentionally a content/state oracle for bounded demo
 * fixtures, not a Git commit-content comparison.
 */
export async function snapshotRepositoryTree(root) {
  let head = "no-git-head";
  try {
    head = (
      await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
      })
    ).stdout.trim();
  } catch {
    // Non-Git unit fixtures still get a deterministic content/state snapshot.
  }

  const entries = [];

  async function walk(relativeDirectory) {
    const absoluteDirectory = path.join(root, relativeDirectory);
    const children = (await readdir(absoluteDirectory)).sort();
    for (const name of children) {
      if (relativeDirectory === "" && name === ".git") continue;
      const relativePath = relativeDirectory
        ? path.join(relativeDirectory, name)
        : name;
      const absolutePath = path.join(root, relativePath);
      const stat = await lstat(absolutePath);
      const mode = stat.mode & 0o7777;
      if (stat.isSymbolicLink()) {
        entries.push({
          path: relativePath,
          kind: "symlink",
          mode,
          target: await readlink(absolutePath),
        });
      } else if (stat.isDirectory()) {
        entries.push({
          path: relativePath,
          kind: "directory",
          mode,
        });
        await walk(relativePath);
      } else if (stat.isFile()) {
        entries.push({
          path: relativePath,
          kind: "file",
          mode,
          content: await readFile(absolutePath),
        });
      } else {
        entries.push({ path: relativePath, kind: "other", mode });
      }
    }
  }

  await walk("");
  const hash = createHash("sha256");
  hash.update("HEAD\0", "utf8");
  hash.update(head, "utf8");
  hash.update("\0", "utf8");
  for (const entry of entries) {
    hash.update(entry.path, "utf8");
    hash.update("\0", "utf8");
    hash.update(entry.kind, "utf8");
    hash.update("\0", "utf8");
    hash.update(String(entry.mode), "utf8");
    hash.update("\0", "utf8");
    if (entry.target !== undefined) hash.update(entry.target, "utf8");
    if (entry.content !== undefined) hash.update(entry.content);
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}
