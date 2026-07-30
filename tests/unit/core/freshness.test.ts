jest.mock("../../../src/git/history", () => ({
  getChangedFiles: jest.fn(),
}));

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getChangedFiles } from "../../../src/git/history";
import {
  assessDocumentationFreshness,
  checkDocumentationFreshness,
} from "../../../src/core/freshness";

describe("assessDocumentationFreshness", () => {
  it("marks a missing target as missing", () => {
    const report = assessDocumentationFreshness(
      ["src/index.ts"],
      ["src/index.ts"],
      "README.md",
      false,
    );
    expect(report.status).toBe("missing");
  });

  it("marks docs stale when source changed without the target", () => {
    const report = assessDocumentationFreshness(
      ["src/index.ts", "tests/index.test.ts"],
      ["src/index.ts"],
      "README.md",
      true,
    );
    expect(report.status).toBe("stale");
    expect(report.sourceFiles).toEqual(["src/index.ts"]);
    expect(report.targetChanged).toBe(false);
  });

  it("reports an explicit co-change when target and source both changed", () => {
    const report = assessDocumentationFreshness(
      ["src/index.ts", "README.md"],
      ["src/index.ts"],
      "README.md",
      true,
    );
    expect(report.status).toBe("co-changed");
    expect(report.targetChanged).toBe(true);
  });

  it("ignores test-only and non-source changes", () => {
    const report = assessDocumentationFreshness(
      ["tests/index.test.ts", "package-lock.json"],
      [],
      "README.md",
      true,
    );
    expect(report.status).toBe("clean");
    expect(report.sourceFiles).toEqual([]);
  });
});

it("returns stale from the Git-backed AST boundary", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-freshness-"));
  try {
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(
      path.join(root, "src", "index.ts"),
      "export function currentApi(): string { return 'ok'; }\n",
    );
    fs.writeFileSync(path.join(root, "README.md"), "# Docs\n");
    (getChangedFiles as jest.Mock).mockResolvedValue(["src/index.ts"]);
    const report = await checkDocumentationFreshness(
      root,
      "README.md",
      "HEAD~1",
    );
    expect(report.status).toBe("stale");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
