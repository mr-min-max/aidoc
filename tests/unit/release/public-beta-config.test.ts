import * as fs from "fs";
import * as path from "path";

const { load } = require("js-yaml") as {
  load(source: string): unknown;
};

interface DependabotUpdate {
  "package-ecosystem": string;
  schedule: {
    interval: string;
    day?: string;
    time?: string;
    timezone?: string;
  };
  "open-pull-requests-limit": number;
}

interface DependabotConfig {
  version: number;
  updates: DependabotUpdate[];
}

describe("public beta repository configuration", () => {
  it("bounds weekly npm and Actions dependency updates", () => {
    const source = fs.readFileSync(
      path.resolve(".github/dependabot.yml"),
      "utf8",
    );
    const dependabot = load(source) as DependabotConfig;

    expect(dependabot.version).toBe(2);
    expect(
      dependabot.updates.map((item) => item["package-ecosystem"]).sort(),
    ).toEqual(["github-actions", "npm"]);
    for (const update of dependabot.updates) {
      expect(update.schedule.interval).toBe("weekly");
      expect(update.schedule.day).toBe("monday");
      expect(update.schedule.time).toMatch(/^09:/);
      expect(update.schedule.timezone).toBe("Europe/Kiev");
      expect(update["open-pull-requests-limit"]).toBeLessThanOrEqual(5);
    }
  });
});
