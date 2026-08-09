import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { analyzeCodebase } from "../../../src/core/analyzer";
import { logger } from "../../../src/core/logger";

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
});
