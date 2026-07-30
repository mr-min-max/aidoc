jest.mock("../../../src/git/history", () => ({
  getChangedFiles: jest.fn(),
}));

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getChangedFiles } from "../../../src/git/history";
import * as parserRegistry from "../../../src/parsers/registry";
import { PythonParser } from "../../../src/parsers/python";
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

it("returns unknown when changed TypeScript has syntax diagnostics", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-freshness-"));
  try {
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(
      path.join(root, "src", "broken.ts"),
      "export function broken(: string { return 'no'; }\n",
    );
    fs.writeFileSync(path.join(root, "README.md"), "# Docs\n");
    (getChangedFiles as jest.Mock).mockResolvedValue(["src/broken.ts"]);

    const report = await checkDocumentationFreshness(
      root,
      "README.md",
      "HEAD~1",
    );

    expect(report.status).toBe("unknown");
    expect(report.message).toMatch(/syntax/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("keeps a genuinely parsed empty source file AST-backed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-freshness-"));
  try {
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "empty.ts"), "");
    fs.writeFileSync(path.join(root, "README.md"), "# Docs\n");
    (getChangedFiles as jest.Mock).mockResolvedValue(["src/empty.ts"]);

    const report = await checkDocumentationFreshness(
      root,
      "README.md",
      "HEAD~1",
    );

    expect(report.status).toBe("stale");
    expect(report.sourceFiles).toEqual(["src/empty.ts"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("returns unknown when a changed supported source file no longer exists", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-freshness-"));
  try {
    fs.writeFileSync(path.join(root, "README.md"), "# Docs\n");
    (getChangedFiles as jest.Mock).mockResolvedValue(["src/deleted.ts"]);

    const report = await checkDocumentationFreshness(
      root,
      "README.md",
      "HEAD~1",
    );

    expect(report.status).toBe("unknown");
    expect(report.message).toMatch(/does not exist/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("returns unknown when Python runtime execution is unavailable", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-freshness-"));
  const unavailable = Object.assign(new Error("spawn python3 ENOENT"), {
    code: "ENOENT",
  });
  const parser = new PythonParser(async () => {
    throw unavailable;
  });
  const parserSpy = jest
    .spyOn(parserRegistry, "getParserForFile")
    .mockReturnValue(parser);

  try {
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "module.py"), "");
    fs.writeFileSync(path.join(root, "README.md"), "# Docs\n");
    (getChangedFiles as jest.Mock).mockResolvedValue(["src/module.py"]);

    const report = await checkDocumentationFreshness(
      root,
      "README.md",
      "HEAD~1",
    );

    expect(report.status).toBe("unknown");
    expect(report.message).toMatch(/Python parser unavailable/i);
  } finally {
    parserSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
