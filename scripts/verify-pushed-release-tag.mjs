import { spawnSync } from "node:child_process";
import process from "node:process";

const FIXED_ERRORS = Object.freeze({
  arguments: "Release tag arguments are invalid.",
  verification: "Release tag object could not be verified.",
});

const PROTECTED_TAGGER_EMAIL =
  "<254284659+mr-min-max@users.noreply.github.com>";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function parseArguments(argv) {
  if (
    !Array.isArray(argv) ||
    argv.length !== 2 ||
    argv[0] !== "--ref" ||
    typeof argv[1] !== "string" ||
    argv[1].length > 160 ||
    argv[1].includes("..") ||
    !/^refs\/tags\/v[0-9A-Za-z][0-9A-Za-z.+-]*$/u.test(argv[1])
  ) {
    return null;
  }
  return Object.freeze({ reference: argv[1] });
}

function gitEnvironment() {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("GIT_")) delete environment[name];
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
    maxBuffer: 64 * 1024,
  });
}

function verifiedCommit(reference) {
  const result = git(["rev-parse", "--verify", `${reference}^{commit}`]);
  const commit = result.stdout.trim();
  if (result.status !== 0 || !/^[0-9a-f]{40,64}$/u.test(commit)) return null;
  return commit;
}

function verifyTag(reference) {
  const result = git([
    "for-each-ref",
    "--count=2",
    "--format=%(refname)%00%(objecttype)%00%(*objecttype)%00%(*objectname)%00%(tag)%00%(taggeremail)",
    reference,
  ]);
  if (result.status !== 0 || result.stdout.length > 4096) return false;

  const records = result.stdout.trimEnd().split("\n");
  if (records.length !== 1) return false;
  const fields = records[0].split("\0");
  if (fields.length !== 6) return false;

  const [
    actualRef,
    objectType,
    targetType,
    targetCommit,
    declaredTag,
    taggerEmail,
  ] = fields;
  const headCommit = verifiedCommit("HEAD");
  return (
    actualRef === reference &&
    objectType === "tag" &&
    targetType === "commit" &&
    /^[0-9a-f]{40,64}$/u.test(targetCommit) &&
    targetCommit === headCommit &&
    declaredTag === reference.slice("refs/tags/".length) &&
    taggerEmail === PROTECTED_TAGGER_EMAIL
  );
}

const options = parseArguments(process.argv.slice(2));
if (!options) {
  fail(FIXED_ERRORS.arguments);
} else if (!verifyTag(options.reference)) {
  fail(FIXED_ERRORS.verification);
} else {
  process.stdout.write("Release tag object is verified.\n");
}
