import { win32 } from "node:path";
import {
  assertValidRepositoryTarget,
  assertValidWindowsTarget,
  isRepositoryContainedPath,
} from "../../../src/security/repository-path";

describe("repository path policy", () => {
  it.each(["", "safe\0.md", "safe\nname.md", "../outside.md", "a/../b.md"])(
    "rejects malformed target %j",
    (target) => {
      expect(() => assertValidRepositoryTarget(target, "linux")).toThrow(
        expect.objectContaining({ code: "TRUST_INVALID_PATH" }),
      );
    },
  );

  it.each([
    "C:relative.md",
    "C:\\safe.md:secret",
    "CON",
    "nul.txt",
    "COM1.md",
    "trailing. ",
    "\\\\?\\C:\\repo\\file.md",
    "\\\\.\\NUL",
    "bad<name>.md",
  ])("rejects Win32 target %j", (target) => {
    expect(() => assertValidWindowsTarget(target)).toThrow(
      expect.objectContaining({ code: "TRUST_INVALID_PATH" }),
    );
  });

  it("accepts a lexical .git path for later resolved-path inspection", () => {
    expect(() =>
      assertValidRepositoryTarget(".git/config", "linux"),
    ).not.toThrow();
  });

  it("accepts a candidate contained by its repository root", () => {
    expect(isRepositoryContainedPath("/repo", "/repo/docs/API.md")).toBe(true);
  });

  it("rejects a sibling-prefix escape", () => {
    expect(isRepositoryContainedPath("/repo", "/repo-other/file.md")).toBe(
      false,
    );
  });

  it("applies Win32 drive and UNC containment semantics on every host", () => {
    const win32Semantics = {
      relative: win32.relative,
      isAbsolute: win32.isAbsolute,
      sep: win32.sep,
    };
    expect(
      isRepositoryContainedPath(
        "C:\\repo",
        "C:\\repo\\docs\\API.md",
        win32Semantics,
      ),
    ).toBe(true);
    expect(
      isRepositoryContainedPath(
        "C:\\repo",
        "D:\\repo\\docs\\API.md",
        win32Semantics,
      ),
    ).toBe(false);
    expect(
      isRepositoryContainedPath(
        "\\\\server\\repo",
        "\\\\server\\repo-other\\API.md",
        win32Semantics,
      ),
    ).toBe(false);
  });
});
