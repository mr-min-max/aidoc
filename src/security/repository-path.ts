import { isAbsolute, relative, sep } from "node:path";
import { RepositoryWriteError } from "./types";

interface PathSemantics {
  relative: typeof relative;
  isAbsolute: typeof isAbsolute;
  sep: typeof sep;
}

const DEFAULT_PATH_SEMANTICS: PathSemantics = { relative, isAbsolute, sep };
const WINDOWS_RESERVED_BASENAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

/** Validates an unresolved output target without accessing the filesystem. */
export function assertValidRepositoryTarget(
  rawTarget: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (rawTarget.length === 0 || containsControlCharacter(rawTarget)) {
    throwInvalidPath();
  }

  const components = (
    platform === "win32" ? rawTarget.split(/[\\/]+/) : rawTarget.split("/")
  ).filter((component) => component.length > 0);
  if (components.includes("..")) throwInvalidPath();

  if (platform === "win32") assertValidWindowsTarget(rawTarget);
}

/** Validates Windows-specific target syntax without accessing the filesystem. */
export function assertValidWindowsTarget(rawTarget: string): void {
  if (rawTarget.length === 0 || containsControlCharacter(rawTarget)) {
    throwInvalidPath();
  }
  if (isWindowsDeviceNamespace(rawTarget)) throwInvalidPath();

  const components = rawTarget
    .split(/[\\/]+/)
    .filter((component) => component.length > 0);
  for (const component of components) {
    if (
      component.endsWith(".") ||
      component.endsWith(" ") ||
      /[<>:"|?*]/.test(component)
    ) {
      throwInvalidPath();
    }

    const baseName = component.split(".")[0];
    if (WINDOWS_RESERVED_BASENAMES.has(baseName.toUpperCase())) {
      throwInvalidPath();
    }
  }
}

/** Checks whether a resolved candidate remains within a resolved repository root. */
export function isRepositoryContainedPath(
  root: string,
  candidate: string,
  semantics: PathSemantics = DEFAULT_PATH_SEMANTICS,
): boolean {
  const candidateRelativePath = semantics.relative(root, candidate);
  return (
    candidateRelativePath === "" ||
    (!candidateRelativePath.startsWith(`..${semantics.sep}`) &&
      candidateRelativePath !== ".." &&
      !semantics.isAbsolute(candidateRelativePath))
  );
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}

function isWindowsDeviceNamespace(value: string): boolean {
  return (
    value.startsWith("\\\\?\\") ||
    value.startsWith("\\\\.\\") ||
    value.startsWith("//?/") ||
    value.startsWith("//./")
  );
}

function throwInvalidPath(): never {
  throw new RepositoryWriteError("TRUST_INVALID_PATH");
}
