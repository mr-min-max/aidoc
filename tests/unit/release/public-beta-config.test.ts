import { execFileSync } from "node:child_process";
import * as fs from "fs";
import * as path from "path";

const { load } = require("js-yaml") as {
  load(source: string): unknown;
};

interface DependabotUpdate {
  "package-ecosystem": string;
  directory: string;
  schedule: {
    interval: string;
    day?: string;
    time?: string;
    timezone?: string;
  };
  "open-pull-requests-limit": number;
  labels: string[];
  groups?: Record<
    string,
    { "dependency-type": string; "update-types": string[] }
  >;
}

interface DependabotConfig {
  version: number;
  updates: DependabotUpdate[];
  registries?: unknown;
}

describe("public beta repository configuration", () => {
  it("bounds weekly npm and Actions dependency updates", () => {
    const source = fs.readFileSync(
      path.resolve(".github/dependabot.yml"),
      "utf8",
    );
    const dependabot = load(source) as DependabotConfig;

    expect(dependabot).toEqual({
      version: 2,
      updates: [
        {
          "package-ecosystem": "npm",
          directory: "/",
          schedule: {
            interval: "weekly",
            day: "monday",
            time: "09:00",
            timezone: "Europe/Kiev",
          },
          "open-pull-requests-limit": 5,
          labels: ["dependencies"],
          groups: {
            "production-minor-and-patch": {
              "dependency-type": "production",
              "update-types": ["minor", "patch"],
            },
          },
        },
        {
          "package-ecosystem": "github-actions",
          directory: "/",
          schedule: {
            interval: "weekly",
            day: "monday",
            time: "09:15",
            timezone: "Europe/Kiev",
          },
          "open-pull-requests-limit": 3,
          labels: ["dependencies"],
        },
      ],
    });
    expect(dependabot.registries).toBeUndefined();
  });

  it("keeps private publication material outside tracked Git", () => {
    expect(() =>
      execFileSync("git", ["check-ignore", "--quiet", ".private/probe"], {
        cwd: path.resolve("."),
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("verifies the current candidate revision in the public-beta gate", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve("package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:public-beta"]).toBe(
      "npm run verify:release && npm run test:public-beta && node scripts/public-beta-preflight.mjs --json --candidate-ref HEAD",
    );
  });
});
