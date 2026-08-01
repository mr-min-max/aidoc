import { execFile as execFileCallback } from "node:child_process";
import { constants as fsConstants, promises as fs } from "node:fs";
import { promisify } from "node:util";
import { posix, resolve } from "node:path";
import { SnapshotDescriptor, PlanFailure } from "../impact/types";

const execFile = promisify(execFileCallback);
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_BUFFER = 4 * 1024 * 1024;
const STATUS = new Set(["A", "M", "D", "R"]);

export type SnapshotFileStatus = "added" | "modified" | "deleted" | "renamed";
export interface SnapshotFileChange {
  status: SnapshotFileStatus;
  beforePath?: string;
  afterPath?: string;
  beforeSource?: string;
  afterSource?: string;
  supported: boolean;
  excluded: boolean;
}
export interface GitSnapshotSet {
  root: string;
  base: SnapshotDescriptor;
  head: SnapshotDescriptor;
  files: SnapshotFileChange[];
  ignored: { unsupported: number; excluded: number };
}

export class GitSnapshotReader {
  constructor(
    private readonly cwd: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async read(options: {
    base?: string;
    head?: string;
    include: string[];
    exclude: string[];
  }): Promise<GitSnapshotSet> {
    const root = await this.gitRoot();
    const headLabel = options.head ?? "HEAD";
    const headCommit = await this.resolveCommit(
      headLabel,
      "PLAN_HEAD_NOT_FOUND",
    );
    let baseLabel = options.base ?? this.env.AIDOC_BASE_REF;
    if (!baseLabel) baseLabel = await this.discoverBase(headCommit);
    const baseCommit = await this.resolveBase(baseLabel);
    const immutable = options.head !== undefined;
    const changes = immutable
      ? await this.committedDiff(baseCommit, headCommit)
      : await this.workingDiff(baseCommit);
    const files: SnapshotFileChange[] = [];
    let unsupported = 0;
    let excluded = 0;
    for (const change of changes) {
      const paths = [change.beforePath, change.afterPath].filter(
        (p): p is string => p !== undefined,
      );
      const normalized = paths.map((p) => normalizePath(p));
      if (normalized.some((p) => p === undefined))
        throw new PlanFailure(
          "PLAN_SOURCE_READ_FAILED",
          "Unable to read repository source.",
        );
      const beforePath = change.beforePath
        ? normalizePath(change.beforePath)!
        : undefined;
      const afterPath = change.afterPath
        ? normalizePath(change.afterPath)!
        : undefined;
      const matchPath = afterPath ?? beforePath!;
      const isSupported = /\.(?:ts|tsx|js|jsx|py)$/u.test(matchPath);
      const isExcluded = isMatched(matchPath, options.exclude);
      if (!isSupported) unsupported++;
      if (isExcluded) excluded++;
      if (!isSupported || isExcluded) {
        files.push({
          ...change,
          beforePath,
          afterPath,
          supported: isSupported,
          excluded: isExcluded,
        });
        continue;
      }
      let beforeSource: string | undefined;
      let afterSource: string | undefined;
      if (beforePath && change.status !== "added")
        beforeSource = await this.blob(
          headCommit === baseCommit ? baseCommit : baseCommit,
          beforePath,
        );
      if (afterPath && change.status !== "deleted")
        afterSource = immutable
          ? await this.blob(headCommit, afterPath)
          : await this.worktreeFile(root, afterPath);
      if (!isMatched(matchPath, options.include)) {
        excluded++;
        files.push({
          ...change,
          beforePath,
          afterPath,
          beforeSource,
          afterSource,
          supported: true,
          excluded: true,
        });
        continue;
      }
      files.push({
        ...change,
        beforePath,
        afterPath,
        beforeSource,
        afterSource,
        supported: true,
        excluded: false,
      });
    }
    return {
      root,
      base: { type: "git", label: baseLabel, commit: baseCommit },
      head: {
        type: immutable ? "git" : "working-tree",
        label: headLabel,
        ...(immutable ? { commit: headCommit } : {}),
      },
      files,
      ignored: { unsupported, excluded },
    };
  }

  private async gitRoot(): Promise<string> {
    try {
      return (await this.run(["rev-parse", "--show-toplevel"])).trim();
    } catch {
      throw new PlanFailure(
        "PLAN_NOT_GIT_REPOSITORY",
        "The current directory is not a Git repository.",
      );
    }
  }
  private async run(args: string[]): Promise<string> {
    try {
      const result = await execFile("git", args, {
        cwd: this.cwd,
        env: this.env,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
      });
      return result.stdout;
    } catch {
      throw new Error("git command failed");
    }
  }
  private validateRef(ref: string): void {
    if (
      ref.startsWith("-") ||
      [...ref].some((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code === 0 || code === 10 || code === 13;
      })
    )
      throw new PlanFailure(
        "PLAN_INVALID_REF",
        "The Git reference is invalid.",
      );
  }
  private async resolveCommit(
    ref: string,
    code: "PLAN_BASE_NOT_FOUND" | "PLAN_HEAD_NOT_FOUND",
  ): Promise<string> {
    this.validateRef(ref);
    try {
      return (
        await this.run(["rev-parse", "--verify", `${ref}^{commit}`])
      ).trim();
    } catch {
      throw new PlanFailure(
        code,
        code === "PLAN_HEAD_NOT_FOUND"
          ? "The Git head could not be resolved."
          : "The Git base could not be resolved.",
      );
    }
  }
  private async resolveBase(ref: string): Promise<string> {
    this.validateRef(ref);
    try {
      return await this.resolveCommit(ref, "PLAN_BASE_NOT_FOUND");
    } catch {
      try {
        if (
          (await this.run(["rev-parse", "--is-shallow-repository"])).trim() ===
          "true"
        )
          throw new PlanFailure(
            "PLAN_SHALLOW_HISTORY",
            "The selected Git base is unavailable in this shallow repository.",
          );
      } catch (e) {
        if (e instanceof PlanFailure) throw e;
      }
      throw new PlanFailure(
        "PLAN_BASE_NOT_FOUND",
        "The Git base could not be resolved.",
      );
    }
  }
  private async discoverBase(head: string): Promise<string> {
    const candidates: string[] = [];
    try {
      const symbolic = (
        await this.run(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"])
      ).trim();
      if (symbolic) candidates.push(symbolic);
    } catch {
      /* absent */
    }
    candidates.push("origin/main", "main", "origin/master", "master", "HEAD~1");
    for (const candidate of candidates) {
      try {
        return await this.resolveCommit(candidate, "PLAN_BASE_NOT_FOUND");
      } catch {
        /* next */
      }
    }
    try {
      await this.resolveCommit("HEAD~1", "PLAN_BASE_NOT_FOUND");
    } catch {
      return EMPTY_TREE;
    }
    return head;
  }
  private async committedDiff(
    base: string,
    head: string,
  ): Promise<
    Omit<
      SnapshotFileChange,
      "supported" | "excluded" | "beforeSource" | "afterSource"
    >[]
  > {
    const output = await this.run([
      "diff-tree",
      "--root",
      "--name-status",
      "-r",
      "-M",
      "-z",
      base,
      head,
      "--",
    ]);
    return parseStatus(output);
  }
  private async workingDiff(
    base: string,
  ): Promise<
    Omit<
      SnapshotFileChange,
      "supported" | "excluded" | "beforeSource" | "afterSource"
    >[]
  > {
    const [tracked, untracked] = await Promise.all([
      this.run(["diff", "--name-status", "-M", base, "--"]),
      this.run(["ls-files", "--others", "--exclude-standard", "--"]),
    ]);
    const result = parseStatus(tracked);
    for (const path of untracked.split(/\r?\n/u).filter(Boolean))
      result.push({ status: "added", afterPath: path });
    return result;
  }
  private async blob(commit: string, path: string): Promise<string> {
    try {
      return await this.run(["show", `${commit}:${path}`, "--"]);
    } catch {
      throw new PlanFailure(
        "PLAN_SOURCE_READ_FAILED",
        "Unable to read repository source.",
        path,
      );
    }
  }
  private async worktreeFile(root: string, path: string): Promise<string> {
    const full = resolve(root, path);
    try {
      const realRoot = await fs.realpath(root);
      const realPath = await fs.realpath(full);
      if (realPath !== realRoot && !realPath.startsWith(`${realRoot}/`))
        throw new Error();
      const stat = await fs.lstat(full);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error();
      const handle = await fs.open(full, fsConstants.O_RDONLY);
      const before = await handle.stat();
      const source = await handle.readFile({ encoding: "utf8" });
      const after = await handle.stat();
      await handle.close();
      if (before.ino !== after.ino || before.size !== after.size)
        throw new Error();
      return source;
    } catch {
      throw new PlanFailure(
        "PLAN_UNSAFE_WORKTREE_PATH",
        "The working-tree path is unsafe.",
        path,
      );
    }
  }
}

function normalizePath(value: string): string | undefined {
  if (value.includes("\0") || value.includes("\n") || value.startsWith("/"))
    return undefined;
  const normalized = posix.normalize(value.replaceAll("\\", "/"));
  return normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
    ? undefined
    : normalized;
}
function isMatched(path: string, patterns: string[]): boolean {
  return (
    patterns.length > 0 &&
    patterns.some((pattern) => posix.matchesGlob(path, pattern))
  );
}
function parseStatus(
  output: string,
): Omit<
  SnapshotFileChange,
  "supported" | "excluded" | "beforeSource" | "afterSource"
>[] {
  const tokens = output.includes("\0")
    ? output.split("\0").filter(Boolean)
    : output.split(/\r?\n/u).filter(Boolean);
  const result: Omit<
    SnapshotFileChange,
    "supported" | "excluded" | "beforeSource" | "afterSource"
  >[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const parts = token.split(/\s+/u);
    const code = parts[0]?.[0];
    if (!code || !STATUS.has(code)) continue;
    if (code === "R")
      result.push({
        status: "renamed",
        beforePath: parts[1] ?? tokens[++i],
        afterPath: parts[2] ?? tokens[++i],
      });
    else {
      const path = parts[1] ?? tokens[++i];
      result.push(
        code === "D"
          ? { status: "deleted", beforePath: path }
          : { status: code === "A" ? "added" : "modified", afterPath: path },
      );
    }
  }
  return result;
}
