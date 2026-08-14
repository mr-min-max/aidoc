#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const NPM_REGISTRY = "https://registry.npmjs.org/";
const MAX_METADATA_BYTES = 1_048_576;
const LEGACY_CANDIDATE = Object.freeze({
  name: "aidoc-gen",
  version: "0.2.0-beta.3",
});

export const NPM_PUBLISHED_STATE_MESSAGES = Object.freeze({
  success: "Npm published beta registry state is verified.",
  verificationFailed:
    "Npm published beta registry state could not be verified.",
});

function fixedError() {
  return new Error(NPM_PUBLISHED_STATE_MESSAGES.verificationFailed);
}

function validVersion(version) {
  return (
    typeof version === "string" &&
    version.length > 0 &&
    version.length <= 128 &&
    /^[0-9A-Za-z][0-9A-Za-z._-]*$/u.test(version)
  );
}

function validCandidate(candidate) {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    candidate.name === "@mr-min-max/aidoc-gen" &&
    validVersion(candidate.version)
  );
}

/** Parses the optional published-version override accepted by the CLI. */
export function parsePublishedVersionArguments(argv) {
  if (!Array.isArray(argv)) throw fixedError();
  if (argv.length === 0) return undefined;
  if (argv.length !== 2 || argv[0] !== "--version" || !validVersion(argv[1])) {
    throw fixedError();
  }
  return argv[1];
}

async function readCandidate(versionOverride) {
  try {
    const parsed = JSON.parse(
      await readFile(resolve("package.json"), { encoding: "utf8" }),
    );
    const candidate = {
      name: parsed?.name,
      version: versionOverride ?? parsed?.version,
    };
    if (!validCandidate(candidate)) throw fixedError();
    return Object.freeze(candidate);
  } catch {
    throw fixedError();
  }
}

function registryUrl(value) {
  return new URL(value, NPM_REGISTRY);
}

function versionUrl({ name, version }) {
  return registryUrl(
    `${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
  );
}

function packageUrl({ name }) {
  return registryUrl(encodeURIComponent(name));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validArtifact(candidate, version) {
  if (
    !isRecord(version) ||
    version.name !== candidate.name ||
    version.version !== candidate.version ||
    !isRecord(version.dist) ||
    typeof version.dist.integrity !== "string" ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(version.dist.integrity) ||
    typeof version.dist.tarball !== "string"
  ) {
    return false;
  }

  try {
    const tarball = new URL(version.dist.tarball);
    return (
      tarball.origin === "https://registry.npmjs.org" &&
      tarball.pathname ===
        `/@mr-min-max/aidoc-gen/-/aidoc-gen-${candidate.version}.tgz` &&
      tarball.search === "" &&
      tarball.hash === ""
    );
  } catch {
    return false;
  }
}

function validMetadata(candidate, metadata) {
  if (
    !isRecord(metadata) ||
    metadata.name !== candidate.name ||
    !isRecord(metadata["dist-tags"]) ||
    !isRecord(metadata.versions)
  ) {
    return false;
  }

  const beta = metadata["dist-tags"].beta;
  const latest = metadata["dist-tags"].latest;
  return (
    beta === candidate.version &&
    typeof latest === "string" &&
    latest.length > 0 &&
    Object.hasOwn(metadata.versions, latest) &&
    Object.hasOwn(metadata.versions, candidate.version) &&
    validArtifact(candidate, metadata.versions[candidate.version])
  );
}

const REQUEST_OPTIONS = Object.freeze({
  method: "GET",
  headers: Object.freeze({ accept: "application/vnd.npm.install-v1+json" }),
  redirect: "error",
});

async function request(fetchImpl, url) {
  return fetchImpl(url, {
    ...REQUEST_OPTIONS,
    signal: globalThis.AbortSignal.timeout(10_000),
  });
}

export async function verifyNpmVersionPublished(options = {}) {
  const candidate =
    options.candidate ?? (await readCandidate(options.versionOverride));
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!validCandidate(candidate) || typeof fetchImpl !== "function") {
    throw fixedError();
  }

  try {
    const legacyResponse = await request(
      fetchImpl,
      versionUrl(LEGACY_CANDIDATE),
    );
    if (legacyResponse?.status !== 404) throw fixedError();

    const metadataResponse = await request(fetchImpl, packageUrl(candidate));
    if (
      metadataResponse?.status !== 200 ||
      typeof metadataResponse.text !== "function"
    ) {
      throw fixedError();
    }
    const source = await metadataResponse.text();
    if (
      typeof source !== "string" ||
      Buffer.byteLength(source, "utf8") > MAX_METADATA_BYTES
    ) {
      throw fixedError();
    }
    const metadata = JSON.parse(source);
    if (!validMetadata(candidate, metadata)) throw fixedError();
  } catch {
    throw fixedError();
  }

  return {
    checked: 2,
    status: "published",
    version: candidate.version,
  };
}

const entryPath = process.argv[1];
if (
  typeof entryPath === "string" &&
  resolve(entryPath) === fileURLToPath(import.meta.url)
) {
  try {
    const versionOverride = parsePublishedVersionArguments(
      process.argv.slice(2),
    );
    await verifyNpmVersionPublished({ versionOverride });
    process.stdout.write(`${NPM_PUBLISHED_STATE_MESSAGES.success}\n`);
  } catch {
    process.stderr.write(
      `${NPM_PUBLISHED_STATE_MESSAGES.verificationFailed}\n`,
    );
    process.exitCode = 1;
  }
}
