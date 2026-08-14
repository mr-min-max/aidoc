import * as fs from "fs";
import * as path from "path";

const { load } = require("js-yaml") as {
  load(source: string): unknown;
};

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string | number | boolean>;
}

interface WorkflowJob {
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps: WorkflowStep[];
}

interface RepairWorkflow {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

const workflowPath = path.resolve(
  ".github/workflows/repair-beta4-dist-tag.yml",
);
const workflowSource = fs.readFileSync(workflowPath, "utf8");
const workflow = load(workflowSource) as RepairWorkflow;

function stepNamed(job: WorkflowJob, name: string): WorkflowStep {
  const step = job.steps.find((candidate) => candidate.name === name);
  if (!step) throw new Error(`Missing workflow step: ${name}`);
  return step;
}

function normalizedCommand(command: string | undefined): string {
  return command?.replace(/\s+/gu, " ").trim() ?? "";
}

describe("beta.4 dist-tag repair workflow", () => {
  it("is a manually triggered, read-only, single-purpose workflow", () => {
    expect(workflow.on).toEqual({ workflow_dispatch: null });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.env).toBeUndefined();
    expect(Object.keys(workflow.jobs)).toEqual(["remove-unintended-latest"]);

    const job = workflow.jobs["remove-unintended-latest"];
    expect(job.permissions).toEqual({ contents: "read" });
    expect(job.env).toBeUndefined();
    expect(job.steps.map((step) => step.name ?? step.uses)).toEqual([
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "Verify exact precondition",
      "Remove unintended latest tag",
      "Verify exact postcondition",
    ]);
  });

  it("pins its only external action and does not check out repository code", () => {
    const uses = Object.values(workflow.jobs)
      .flatMap((job) => job.steps)
      .flatMap((step) => (step.uses ? [step.uses] : []));

    expect(uses).toEqual([
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    ]);
    expect(uses[0]).toMatch(/@[0-9a-f]{40}$/u);

    const setup = workflow.jobs["remove-unintended-latest"].steps[0];
    expect(setup.with).toEqual({
      "node-version": 24,
      "registry-url": "https://registry.npmjs.org",
    });
    expect(workflowSource).not.toContain("actions/checkout");
  });

  it("fails closed unless both beta and latest point to exact beta.4", () => {
    const job = workflow.jobs["remove-unintended-latest"];
    const precondition = stepNamed(job, "Verify exact precondition");

    expect(precondition.env).toBeUndefined();
    expect(normalizedCommand(precondition.run)).toContain(
      "npm dist-tag ls @mr-min-max/aidoc-gen --userconfig=/dev/null --registry=https://registry.npmjs.org",
    );
    expect(precondition.run).toContain("entries.length !== 2");
    expect(precondition.run).toContain(
      'tags.beta !== "0.2.0-beta.4" || tags.latest !== "0.2.0-beta.4"',
    );
    expect(precondition.run).toContain("Unexpected npm dist-tag state");
  });

  it("exposes the npm token only to the exact tag-removal step", () => {
    const job = workflow.jobs["remove-unintended-latest"];
    const remove = stepNamed(job, "Remove unintended latest tag");

    expect(normalizedCommand(remove.run)).toBe(
      "npm dist-tag rm @mr-min-max/aidoc-gen latest",
    );
    expect(remove.env).toEqual({
      NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}",
    });
    expect(
      job.steps
        .filter((step) => step !== remove)
        .every((step) => step.env?.NODE_AUTH_TOKEN === undefined),
    ).toBe(true);
    expect(
      workflowSource.match(/\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/gu),
    ).toHaveLength(1);
  });

  it("keeps beta on beta.4 and requires latest to be absent afterward", () => {
    const job = workflow.jobs["remove-unintended-latest"];
    const postcondition = stepNamed(job, "Verify exact postcondition");

    expect(postcondition.env).toBeUndefined();
    expect(normalizedCommand(postcondition.run)).toContain(
      "npm dist-tag ls @mr-min-max/aidoc-gen --userconfig=/dev/null --registry=https://registry.npmjs.org",
    );
    expect(postcondition.run).toContain("entries.length !== 1");
    expect(postcondition.run).toContain(
      'tags.beta !== "0.2.0-beta.4" || Object.hasOwn(tags, "latest")',
    );
    expect(postcondition.run).toContain("npm dist-tags were not repaired");
  });

  it("cannot publish, unpublish, deprecate, or add another dist-tag", () => {
    const commands = Object.values(workflow.jobs)
      .flatMap((job) => job.steps)
      .map((step) => normalizedCommand(step.run))
      .join("\n");

    expect(commands).not.toMatch(/\bnpm\s+(?:publish|unpublish|deprecate)\b/u);
    expect(commands).not.toMatch(/\bnpm\s+dist-tag\s+add\b/u);
    expect(commands.match(/\bnpm\s+dist-tag\s+rm\b/gu)).toHaveLength(1);
  });
});
