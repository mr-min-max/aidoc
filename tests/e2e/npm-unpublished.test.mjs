import assert from "node:assert/strict";
import test from "node:test";

import {
  NPM_REGISTRY_STATE_MESSAGES,
  verifyNpmVersionsUnpublished,
} from "../../scripts/verify-npm-unpublished.mjs";

const candidate = Object.freeze({
  name: "@mr-min-max/aidoc-gen",
  version: "0.2.0-beta.5",
});

test("accepts only exact 404 responses for both release identities", async () => {
  const requests = [];
  const result = await verifyNpmVersionsUnpublished({
    candidate,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return { status: 404 };
    },
  });

  assert.deepEqual(result, { checked: 2, status: "unpublished" });
  assert.deepEqual(
    requests.map(({ url }) => url),
    [
      "https://registry.npmjs.org/aidoc-gen/0.2.0-beta.3",
      "https://registry.npmjs.org/%40mr-min-max%2Faidoc-gen/0.2.0-beta.5",
    ],
  );
  for (const { options } of requests) {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.deepEqual(options.headers, {
      accept: "application/vnd.npm.install-v1+json",
    });
  }
});

test("fails distinctly when either version exists", async () => {
  for (const statuses of [
    [200, 404],
    [404, 200],
  ]) {
    let requestIndex = 0;
    await assert.rejects(
      verifyNpmVersionsUnpublished({
        candidate,
        fetchImpl: async () => ({ status: statuses[requestIndex++] }),
      }),
      new Error(NPM_REGISTRY_STATE_MESSAGES.versionExists),
    );
  }
});

test("fails closed on authentication, rate, server, and redirect responses", async () => {
  for (const status of [301, 401, 403, 429, 500]) {
    await assert.rejects(
      verifyNpmVersionsUnpublished({
        candidate,
        fetchImpl: async () => ({ status }),
      }),
      new Error(NPM_REGISTRY_STATE_MESSAGES.verificationFailed),
    );
  }
});

test("fails closed with a fixed diagnostic on transport errors", async () => {
  await assert.rejects(
    verifyNpmVersionsUnpublished({
      candidate,
      fetchImpl: async () => {
        throw new Error("seeded network path and credential");
      },
    }),
    new Error(NPM_REGISTRY_STATE_MESSAGES.verificationFailed),
  );

  let requestIndex = 0;
  await assert.rejects(
    verifyNpmVersionsUnpublished({
      candidate,
      fetchImpl: async () => {
        if (requestIndex++ === 0) return { status: 404 };
        throw new Error("seeded second-request failure");
      },
    }),
    new Error(NPM_REGISTRY_STATE_MESSAGES.verificationFailed),
  );
});
