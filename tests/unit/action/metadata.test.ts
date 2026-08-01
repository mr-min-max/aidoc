import * as fs from "fs";
import * as path from "path";

const { load } = require("js-yaml") as {
  load(source: string): unknown;
};

interface CompositeStep {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

interface CompositeAction {
  runs: { using: string; steps: CompositeStep[] };
}

const metadata = load(
  fs.readFileSync(path.resolve("action.yml"), "utf8"),
) as CompositeAction;

describe("composite Action runtime policy", () => {
  it("uses the reviewed setup-node revision and an explicit supported Node floor", () => {
    const setup = metadata.runs.steps.find(
      (step) => step.name === "Setup Node.js",
    );
    if (!setup) throw new Error("Missing Setup Node.js step");
    const nodeVersion = String(setup.with?.["node-version"] ?? "");
    const [major, minor] = nodeVersion.split(".").map(Number);

    expect(metadata.runs.using).toBe("composite");
    expect(setup.uses).toBe(
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    );
    expect(major).toBeGreaterThanOrEqual(22);
    expect(major === 22 ? minor : 12).toBeGreaterThanOrEqual(12);
  });
});
