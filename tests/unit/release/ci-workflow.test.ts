import * as fs from "fs";
import * as path from "path";

const { load } = require("js-yaml") as {
  load(source: string): unknown;
};

interface WorkflowStep {
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

describe("CI workflow security policy", () => {
  it("uses read-only repository permissions and disables checkout credentials", () => {
    const checkout = actionStep(workflow.jobs.test, "actions/checkout");

    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(checkout.with?.["persist-credentials"]).toBe(false);
  });

  it("pins every CI third-party action to its reviewed immutable revision", () => {
    const reviewedActions = {
      "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
      "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
      "codecov/codecov-action": "b9fd7d16f6d7d1b5d2bec1a2887e65ceed900238",
    };
    const uses = workflow.jobs.test.steps.flatMap((step) =>
      step.uses ? [step.uses] : [],
    );

    for (const [action, revision] of Object.entries(reviewedActions)) {
      expect(actionStep(workflow.jobs.test, action).uses).toBe(
        `${action}@${revision}`,
      );
    }
    expect(uses.every((use) => /@[0-9a-f]{40}$/.test(use))).toBe(true);
  });
});
