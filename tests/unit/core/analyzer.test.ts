import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as scanner from "../../../src/core/scanner";
import {
  analyzeCapturedSources,
  analyzeCodebase,
} from "../../../src/core/analyzer";
import { globalCache } from "../../../src/core/cache";
import { logger } from "../../../src/core/logger";
import { registerParser } from "../../../src/parsers/registry";

describe("analyzeCodebase parser diagnostics", () => {
  it("does not log malformed Python source text", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-analyzer-"));
    const fakeSourceSecret = ["sk", "proj", "L".repeat(32)].join("-");
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    fs.writeFileSync(
      path.join(root, "broken.py"),
      `def broken(${fakeSourceSecret}:\n`,
    );

    try {
      const modules = await analyzeCodebase(root, ["**/*.py"], []);
      const messages = warn.mock.calls.map(([message]) => message).join("\n");

      expect(modules).toEqual([]);
      expect(messages).not.toContain(fakeSourceSecret);
      expect(messages).toContain("Failed to parse Python source.");
    } finally {
      warn.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("analyzes sorted captured sources without paths, cache, or legacy parsers", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const scanFiles = jest.spyOn(scanner, "scanFiles");
    const cacheGet = jest.spyOn(globalCache, "get");
    const cacheSet = jest.spyOn(globalCache, "set");
    const legacyParse = jest.fn();

    registerParser({
      name: "legacy-captured-test",
      supportedExtensions: [".legacy"],
      parse: legacyParse,
      snapshot: jest.fn(),
    });

    const sourceSentinel = ["captured", "analyzer", "Z".repeat(32)].join("-");

    const files = [
      {
        displayPath: "z.unsupported",
        content: "ignored",
      },
      {
        displayPath: "broken.py",
        content: `def broken(${sourceSentinel}:\n`,
      },
      {
        displayPath: "legacy.legacy",
        content: "legacy source",
      },
      {
        displayPath: "a.py",
        content: "def first():\n    return 1\n",
      },
      {
        displayPath: "b.py",
        content: "def second():\n    return 2\n",
      },
    ] as const;

    try {
      const modules = await analyzeCapturedSources(files);

      expect(modules.map(({ filePath }) => filePath)).toEqual(["a.py", "b.py"]);
      expect(
        modules.flatMap(({ functions }) => functions.map(({ name }) => name)),
      ).toEqual(["first", "second"]);
      expect(files.map(({ displayPath }) => displayPath)).toEqual([
        "z.unsupported",
        "broken.py",
        "legacy.legacy",
        "a.py",
        "b.py",
      ]);
      expect(legacyParse).not.toHaveBeenCalled();
      expect(scanFiles).not.toHaveBeenCalled();
      expect(cacheGet).not.toHaveBeenCalled();
      expect(cacheSet).not.toHaveBeenCalled();
      const messages = warn.mock.calls.map(([message]) => message).join("\n");
      expect(messages).toContain("Failed to parse Python source.");
      expect(messages).not.toContain(sourceSentinel);
    } finally {
      warn.mockRestore();
      scanFiles.mockRestore();
      cacheGet.mockRestore();
      cacheSet.mockRestore();
    }
  });
});
