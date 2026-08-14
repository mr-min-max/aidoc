#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const NPM_REGISTRY = "https://registry.npmjs.org/";
const LEGACY_CANDIDATE = Object.freeze({
  name: "aidoc-gen",
  version: "0.2.0-beta.3",
});

export const NPM_REGISTRY_STATE_MESSAGES = Object.freeze({
  success: "Npm release registry state is unpublished.",
  verificationFailed: "Npm release registry state could not be verified.",
  versionExists: "Npm release registry state is not unpublished.",
});

function fixedError(message) {
  return new Error(message);
}

function validCandidate(candidate) {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    candidate.name === "@mr-min-max/aidoc-gen" &&
    typeof candidate.version === "string" &&
    candidate.version.length > 0 &&
    candidate.version.length <= 128 &&
    /^[0-9A-Za-z][0-9A-Za-z._-]*$/u.test(candidate.version)
  );
}

async function readCandidate() {
  try {
    const parsed = JSON.parse(
      await readFile(resolve("package.json"), { encoding: "utf8" }),
    );
    if (!validCandidate(parsed)) {
      throw fixedError(NPM_REGISTRY_STATE_MESSAGES.verificationFailed);
    }
    return Object.freeze({ name: parsed.name, version: parsed.version });
  } catch {
    throw fixedError(NPM_REGISTRY_STATE_MESSAGES.verificationFailed);
  }
}

function versionUrl({ name, version }) {
  return new URL(
    `${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    NPM_REGISTRY,
  );
}

export async function verifyNpmVersionsUnpublished(options = {}) {
  const candidate = options.candidate ?? (await readCandidate());
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!validCandidate(candidate) || typeof fetchImpl !== "function") {
    throw fixedError(NPM_REGISTRY_STATE_MESSAGES.verificationFailed);
  }

  for (const release of [LEGACY_CANDIDATE, candidate]) {
    let status;
    try {
      const response = await fetchImpl(versionUrl(release), {
        method: "GET",
        headers: { accept: "application/vnd.npm.install-v1+json" },
        redirect: "error",
        signal: globalThis.AbortSignal.timeout(10_000),
      });
      status = response?.status;
    } catch {
      throw fixedError(NPM_REGISTRY_STATE_MESSAGES.verificationFailed);
    }

    if (status === 404) continue;
    if (status === 200) {
      throw fixedError(NPM_REGISTRY_STATE_MESSAGES.versionExists);
    }
    throw fixedError(NPM_REGISTRY_STATE_MESSAGES.verificationFailed);
  }

  return { checked: 2, status: "unpublished" };
}

const entryPath = process.argv[1];
if (
  typeof entryPath === "string" &&
  resolve(entryPath) === fileURLToPath(import.meta.url)
) {
  try {
    await verifyNpmVersionsUnpublished();
    process.stdout.write(`${NPM_REGISTRY_STATE_MESSAGES.success}\n`);
  } catch (error) {
    const message =
      error instanceof Error &&
      (error.message === NPM_REGISTRY_STATE_MESSAGES.versionExists ||
        error.message === NPM_REGISTRY_STATE_MESSAGES.verificationFailed)
        ? error.message
        : NPM_REGISTRY_STATE_MESSAGES.verificationFailed;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
