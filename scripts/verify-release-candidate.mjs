import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const FIXED_ERRORS = Object.freeze({
  arguments: "Release verifier arguments are invalid.",
  package: "Release package metadata could not be verified.",
  repository: "Release repository state could not be verified.",
  ancestry: "Release candidate is not contained in the protected main branch.",
  expected: "Release candidate does not match the previously verified commit.",
  tag: "Release tag does not match the package version.",
});

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function hasControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
      return true;
    }
  }
  return false;
}

function parseArguments(argv) {
  const required = new Set(["--main-ref", "--candidate-ref", "--tag"]);
  const accepted = new Set([...required, "--expected-sha"]);
  const values = Object.create(null);

  if (argv.length !== required.size * 2 && argv.length !== accepted.size * 2) {
    return null;
  }

  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !accepted.has(name) ||
      Object.hasOwn(values, name) ||
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 256 ||
      hasControlCharacter(value)
    ) {
      return null;
    }
    values[name] = value;
  }

  if (
    ![...required].every((name) => Object.hasOwn(values, name)) ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(values["--main-ref"]) ||
    values["--main-ref"].includes("..") ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(values["--candidate-ref"]) ||
    values["--candidate-ref"].includes("..") ||
    !/^v[0-9A-Za-z][0-9A-Za-z.+-]*$/u.test(values["--tag"]) ||
    (Object.hasOwn(values, "--expected-sha") &&
      !/^[0-9a-f]{40,64}$/u.test(values["--expected-sha"]))
  ) {
    return null;
  }

  return Object.freeze({
    mainRef: values["--main-ref"],
    candidateRef: values["--candidate-ref"],
    tag: values["--tag"],
    expectedSha: values["--expected-sha"],
  });
}

function gitEnvironment() {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("GIT_")) {
      delete environment[name];
    }
  }
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL =
    process.platform === "win32" ? "NUL" : "/dev/null";
  return environment;
}

function git(args) {
  return spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: gitEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveCommit(reference) {
  const result = git(["rev-parse", "--verify", `${reference}^{commit}`]);
  const commit = result.stdout.trim();
  if (result.status !== 0 || !/^[0-9a-f]{40,64}$/u.test(commit)) {
    return null;
  }
  return commit;
}

const options = parseArguments(process.argv.slice(2));
if (!options) {
  fail(FIXED_ERRORS.arguments);
} else {
  let packageVersion;
  try {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    if (
      packageJson === null ||
      typeof packageJson !== "object" ||
      typeof packageJson.version !== "string" ||
      packageJson.version.length === 0 ||
      packageJson.version.length > 128 ||
      hasControlCharacter(packageJson.version)
    ) {
      throw new TypeError("invalid package version");
    }
    packageVersion = packageJson.version;
  } catch {
    fail(FIXED_ERRORS.package);
  }

  if (packageVersion !== undefined && options.tag !== `v${packageVersion}`) {
    fail(FIXED_ERRORS.tag);
  } else if (packageVersion !== undefined) {
    const candidateCommit = resolveCommit(options.candidateRef);
    const mainCommit = resolveCommit(options.mainRef);
    if (!candidateCommit || !mainCommit) {
      fail(FIXED_ERRORS.repository);
    } else if (
      options.expectedSha !== undefined &&
      (candidateCommit !== options.expectedSha ||
        mainCommit !== options.expectedSha)
    ) {
      fail(FIXED_ERRORS.expected);
    } else {
      const ancestry = git([
        "merge-base",
        "--is-ancestor",
        candidateCommit,
        mainCommit,
      ]);
      if (ancestry.status !== 0) {
        fail(FIXED_ERRORS.ancestry);
      }
    }
  }
}
