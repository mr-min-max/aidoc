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
  with?: Record<string, string | boolean>;
}

interface WorkflowJob {
  needs?: string | string[];
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  strategy?: { matrix?: Record<string, unknown> };
  steps: WorkflowStep[];
}

interface ReleaseWorkflow {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
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

function normalizedCommand(command: string | undefined): string {
  return command?.replace(/\s+/gu, " ").trim() ?? "";
}

describe("release workflow", () => {
  it("has only the version-tag trigger and read-only default permissions", () => {
    expect(workflow.on).toEqual({ push: { tags: ["v*"] } });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.verify.permissions).toEqual({ contents: "read" });
  });

  it("pins every external action to its reviewed commit", () => {
    const reviewedActions = {
      "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/setup-node": "820762786026740c76f36085b0efc47a31fe5020",
      "actions/upload-artifact": "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
      "actions/download-artifact": "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
      "softprops/action-gh-release": "3d0d9888cb7fd7b750713d6e236d1fcb99157228",
    };
    const uses = Object.values(workflow.jobs)
      .flatMap((job) => job.steps)
      .flatMap((step) => (step.uses ? [step.uses] : []));

    expect([...uses].sort()).toEqual(
      [
        `actions/checkout@${reviewedActions["actions/checkout"]}`,
        `actions/download-artifact@${reviewedActions["actions/download-artifact"]}`,
        `actions/download-artifact@${reviewedActions["actions/download-artifact"]}`,
        `actions/setup-node@${reviewedActions["actions/setup-node"]}`,
        `actions/setup-node@${reviewedActions["actions/setup-node"]}`,
        `actions/upload-artifact@${reviewedActions["actions/upload-artifact"]}`,
        `softprops/action-gh-release@${reviewedActions["softprops/action-gh-release"]}`,
      ].sort(),
    );
    expect(uses.every((use) => /@[0-9a-f]{40}$/u.test(use))).toBe(true);

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
    const releaseCandidate = stepNamed(verify, "Verify release candidate");
    const releaseCandidateIndex = verify.steps.indexOf(releaseCandidate);
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
    expect(normalizedCommand(releaseCandidate.run)).toBe(
      'node scripts/verify-release-candidate.mjs --main-ref origin/main --candidate-ref HEAD --tag "$GITHUB_REF_NAME"',
    );
    expect(identityIndex).toBeGreaterThanOrEqual(0);
    expect(releaseCandidateIndex).toBeGreaterThan(identityIndex);
    expect(installIndex).toBeGreaterThan(releaseCandidateIndex);
  });

  it("publishes only the checksum-verified tarball with beta provenance", () => {
    const publish = workflow.jobs.publish;
    expect(publish).toBeDefined();
    expect(publish.needs).toBe("verify");
    expect(publish.permissions).toEqual({
      contents: "read",
      "id-token": "write",
    });

    const download = publish.steps.find((step) =>
      step.uses?.startsWith("actions/download-artifact@"),
    );
    expect(download?.with).toEqual({
      name: "aidoc-npm-package",
      path: "${{ runner.temp }}/aidoc-artifact",
    });

    const validate = stepNamed(publish, "Validate verified artifact");
    expect(validate.run).toContain("tarballs=(");
    expect(validate.run).toContain("checksums=(");
    expect(validate.run).toContain("sha256sum --check");

    const npmGuard = stepNamed(
      publish,
      "Verify npm trusted-publishing support",
    );
    expect(npmGuard.run).toContain("11.5.1");
    expect(npmGuard.env?.NODE_AUTH_TOKEN).toBeUndefined();

    const publishStep = stepNamed(publish, "Publish verified artifact");
    expect(normalizedCommand(publishStep.run)).toBe(
      'npm publish "${{ steps.artifact.outputs.tarball }}" --ignore-scripts --access public --tag beta --provenance',
    );
    expect(publishStep.env).toEqual({
      NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}",
    });

    const allSteps = Object.values(workflow.jobs).flatMap((job) => job.steps);
    const publishCommands = allSteps
      .map((step) => normalizedCommand(step.run))
      .filter((command) => /\bnpm\s+publish\b/u.test(command));
    expect(publishCommands).toEqual([normalizedCommand(publishStep.run)]);
    expect(workflowSource).not.toMatch(/--tag\s+latest\b/u);
    expect(workflow.env?.NODE_AUTH_TOKEN).toBeUndefined();
    expect(
      Object.values(workflow.jobs).every(
        (job) => job.env?.NODE_AUTH_TOKEN === undefined,
      ),
    ).toBe(true);
    expect(
      allSteps
        .filter((step) => step !== publishStep)
        .every((step) => step.env?.NODE_AUTH_TOKEN === undefined),
    ).toBe(true);
    expect(
      workflowSource.match(/\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/gu),
    ).toHaveLength(1);
  });

  it("attaches the verified files to a post-publish GitHub prerelease", () => {
    const githubRelease = workflow.jobs["github-release"];
    expect(githubRelease).toBeDefined();
    expect(githubRelease.needs).toBe("publish");
    expect(githubRelease.permissions).toEqual({ contents: "write" });

    const download = githubRelease.steps.find((step) =>
      step.uses?.startsWith("actions/download-artifact@"),
    );
    const validate = stepNamed(githubRelease, "Validate release assets");
    const release = githubRelease.steps.find((step) =>
      step.uses?.startsWith("softprops/action-gh-release@"),
    );

    expect(download?.with).toEqual({
      name: "aidoc-npm-package",
      path: "${{ runner.temp }}/aidoc-artifact",
    });
    expect(validate.run).toContain("sha256sum --check --strict");
    expect(release?.with).toMatchObject({
      generate_release_notes: true,
      prerelease: true,
      fail_on_unmatched_files: true,
    });
    expect(String(release?.with?.files)).toContain("*.tgz");
    expect(String(release?.with?.files)).toContain("*.sha256");

    const serializedSteps = JSON.stringify(githubRelease.steps);
    expect(serializedSteps).not.toMatch(
      /actions\/checkout|npm ci|npm install|npm pack|npm publish|npm run build/i,
    );
  });
});
