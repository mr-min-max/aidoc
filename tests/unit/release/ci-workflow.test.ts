import * as fs from "fs";
import * as path from "path";

const { load } = require("js-yaml") as {
  load(source: string): unknown;
};

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  steps: WorkflowStep[];
}

interface CiWorkflow {
  permissions?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

const workflow = load(
  fs.readFileSync(path.resolve(".github/workflows/ci.yml"), "utf8"),
) as CiWorkflow;

function actionStep(job: WorkflowJob, action: string): WorkflowStep {
  const step = job.steps.find((candidate) =>
    candidate.uses?.startsWith(`${action}@`),
  );
  if (!step) throw new Error(`Missing CI action: ${action}`);
  return step;
}

function stepNamed(job: WorkflowJob, name: string): WorkflowStep {
  const step = job.steps.find((candidate) => candidate.name === name);
  if (!step) throw new Error(`Missing CI step: ${name}`);
  return step;
}

describe("CI workflow security policy", () => {
  it("uses read-only repository permissions and disables checkout credentials", () => {
    const checkout = actionStep(workflow.jobs.test, "actions/checkout");

    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(checkout.with?.["persist-credentials"]).toBe(false);
  });

  it("pins every CI third-party action to its reviewed immutable revision", () => {
    const reviewedActions = {
      "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/setup-node": "820762786026740c76f36085b0efc47a31fe5020",
      "codecov/codecov-action": "fb8b3582c8e4def4969c97caa2f19720cb33a72f",
    };
    const uses = workflow.jobs.test.steps.flatMap((step) =>
      step.uses ? [step.uses] : [],
    );

    expect([...uses].sort()).toEqual(
      Object.entries(reviewedActions)
        .map(([action, revision]) => `${action}@${revision}`)
        .sort(),
    );

    for (const [action, revision] of Object.entries(reviewedActions)) {
      expect(actionStep(workflow.jobs.test, action).uses).toBe(
        `${action}@${revision}`,
      );
    }
    expect(uses.every((use) => /@[0-9a-f]{40}$/.test(use))).toBe(true);
  });

  it("fetches complete history and rejects unprotected commit identities before install", () => {
    const job = workflow.jobs.test;
    const checkout = actionStep(job, "actions/checkout");
    const identity = stepNamed(job, "Verify protected Git identities");
    const identityIndex = job.steps.indexOf(identity);
    const installIndex = job.steps.findIndex((step) => step.run === "npm ci");

    expect(checkout.with?.["fetch-depth"]).toBe(0);
    expect(identity.run).toContain("git config --local user.name mr-min-max");
    expect(identity.run).toContain(
      "git config --local user.email 254284659+mr-min-max@users.noreply.github.com",
    );
    expect(identity.run).toContain(
      "node scripts/public-beta-preflight.mjs --json --candidate-ref HEAD --skip-source-artifacts",
    );
    expect(identity.run).toContain("--main-ref origin/main");
    expect(identityIndex).toBeGreaterThanOrEqual(0);
    expect(installIndex).toBeGreaterThan(identityIndex);
  });
});
