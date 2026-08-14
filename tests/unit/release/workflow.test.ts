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
  with?: Record<string, string>;
}

interface WorkflowJob {
  needs?: string | string[];
  permissions?: Record<string, string>;
  strategy?: { matrix?: Record<string, unknown> };
  steps: WorkflowStep[];
}

interface ReleaseWorkflow {
  jobs: Record<string, WorkflowJob>;
}

const workflowPath = path.resolve(".github/workflows/release.yml");
const workflowSource = fs.readFileSync(workflowPath, "utf8");
const workflow = load(workflowSource) as ReleaseWorkflow;

function stepNamed(job: WorkflowJob, name: string): WorkflowStep {
  const step = job.steps.find((candidate) => candidate.name === name);
  if (!step) throw new Error(`Missing workflow step: ${name}`);
  return step;
}

describe("release workflow", () => {
  it("pins every external action to its reviewed commit", () => {
    const reviewedActions = {
      "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
      "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
      "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",
      "actions/download-artifact": "d3f86a106a0bac45b974a628896c90dbdf5c8093",
      "softprops/action-gh-release": "3bb12739c298aeb8a4eeaf626c5b8d85266b0e65",
    };
    const uses = Object.values(workflow.jobs)
      .flatMap((job) => job.steps)
      .flatMap((step) => (step.uses ? [step.uses] : []));

    for (const [action, sha] of Object.entries(reviewedActions)) {
      const matches = uses.filter((use) => use.startsWith(`${action}@`));
      expect(matches.length).toBeGreaterThan(0);
      expect(new Set(matches)).toEqual(new Set([`${action}@${sha}`]));
      expect(workflowSource).toContain(`${action}@${sha} # v`);
    }
  });

  it("packs once after Node 22/24 verification and smokes that exact file", () => {
    const verify = workflow.jobs.verify;
    expect(verify.strategy?.matrix?.["node-version"]).toEqual([22, 24]);

    const verifyIndex = verify.steps.findIndex(
      (step) => step.run === "npm run verify:release",
    );
    const packIndex = verify.steps.findIndex(
      (step) => step.name === "Pack release artifact",
    );
    const smokeIndex = verify.steps.findIndex(
      (step) => step.name === "Smoke exact release artifact",
    );
    const uploadIndex = verify.steps.findIndex(
      (step) => step.name === "Upload verified artifact",
    );
    expect(verifyIndex).toBeGreaterThanOrEqual(0);
    expect(packIndex).toBeGreaterThan(verifyIndex);
    expect(smokeIndex).toBeGreaterThan(packIndex);
    expect(uploadIndex).toBeGreaterThan(smokeIndex);

    const pack = verify.steps[packIndex];
    expect(pack.run?.match(/\bnpm pack\b/g)).toHaveLength(1);
    expect(pack.run).toContain("sha256sum");
    expect(pack.run).toContain("checksum=");

    const smoke = verify.steps[smokeIndex];
    expect(smoke.env?.AIDOC_TEST_TARBALL).toBe(
      "${{ steps.pack.outputs.tarball }}",
    );
    expect(smoke.run).toContain("npm run test:package");
    expect(smoke.run).toContain("npm run test:mcp");

    const upload = verify.steps[uploadIndex];
    expect(upload.with?.path).toContain("${{ steps.pack.outputs.tarball }}");
    expect(upload.with?.path).toContain("${{ steps.pack.outputs.checksum }}");
  });

  it("fetches complete history and rejects unprotected commit identities before install", () => {
    const verify = workflow.jobs.verify;
    const checkout = verify.steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    const identity = stepNamed(verify, "Verify protected Git identities");
    const identityIndex = verify.steps.indexOf(identity);
    const installIndex = verify.steps.findIndex(
      (step) => step.run === "npm ci",
    );

    expect(checkout?.with?.["fetch-depth"]).toBe(0);
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

  it("publishes the checksum-verified tarball in an independent job", () => {
    const publish = workflow.jobs.publish;
    expect(publish).toBeDefined();
    expect(publish.needs).toBe("verify");
    expect(publish.permissions?.contents).not.toBe("write");

    const validate = stepNamed(publish, "Validate verified artifact");
    expect(validate.run).toContain("tarballs=(");
    expect(validate.run).toContain("checksums=(");
    expect(validate.run).toContain("sha256sum --check");

    const publishStep = stepNamed(publish, "Publish verified artifact");
    expect(publishStep.run).toContain(
      'npm publish "${{ steps.artifact.outputs.tarball }}"',
    );
    expect(publishStep.run).toContain("--ignore-scripts");
    expect(publishStep.env?.NODE_AUTH_TOKEN).toBe("${{ secrets.NPM_TOKEN }}");
    expect(
      publish.steps
        .filter((step) => step !== publishStep)
        .some((step) => step.env?.NODE_AUTH_TOKEN !== undefined),
    ).toBe(false);
  });

  it("creates the GitHub Release only after publish without rebuilding", () => {
    const githubRelease = workflow.jobs["github-release"];
    expect(githubRelease).toBeDefined();
    expect(githubRelease.needs).toBe("publish");
    expect(githubRelease.permissions).toEqual({ contents: "write" });
    expect(githubRelease.steps).toHaveLength(1);
    expect(githubRelease.steps[0].uses).toBe(
      "softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65",
    );

    const serializedSteps = JSON.stringify(githubRelease.steps);
    expect(serializedSteps).not.toMatch(
      /actions\/checkout|\bnpm\b|\bbuild\b|\binstall\b|\bpackage\b|\bpublish\b/i,
    );
  });
});
