import assert from "node:assert/strict";
import test from "node:test";

import {
  NPM_PUBLISHED_STATE_MESSAGES,
  parsePublishedVersionArguments,
  verifyNpmVersionPublished,
} from "../../scripts/verify-npm-published.mjs";

const candidate = Object.freeze({
  name: "@mr-min-max/aidoc-gen",
  version: "0.2.0-beta.4",
});

function publishedMetadata(overrides = {}) {
  return {
    name: candidate.name,
    "dist-tags": {
      beta: candidate.version,
      latest: candidate.version,
    },
    versions: {
      [candidate.version]: {
        name: candidate.name,
        version: candidate.version,
        dist: {
          integrity: "sha512-c2FmZS1pbnRlZ3JpdHk=",
          tarball:
            "https://registry.npmjs.org/@mr-min-max/aidoc-gen/-/aidoc-gen-0.2.0-beta.4.tgz",
        },
      },
    },
    ...overrides,
  };
}

function jsonResponse(status, value) {
  return {
    status,
    text: async () => JSON.stringify(value),
  };
}

test("selects one explicit published version without accepting extra arguments", () => {
  assert.equal(parsePublishedVersionArguments([]), undefined);
  assert.equal(
    parsePublishedVersionArguments(["--version", "0.2.0-beta.4"]),
    "0.2.0-beta.4",
  );

  for (const args of [
    ["--version"],
    ["--version", ""],
    ["--version", "0.2.0-beta.4", "extra"],
    ["--other", "0.2.0-beta.4"],
    ["--version", "../0.2.0-beta.4"],
    ["--version", "0.2.0-beta.4\nseeded-secret"],
  ]) {
    assert.throws(
      () => parsePublishedVersionArguments(args),
      new Error(NPM_PUBLISHED_STATE_MESSAGES.verificationFailed),
    );
  }
});

test("accepts the immutable beta version, exact beta tag, and required latest tag", async () => {
  const requests = [];
  const result = await verifyNpmVersionPublished({
    candidate,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return requests.length === 1
        ? jsonResponse(404, {})
        : jsonResponse(200, publishedMetadata());
    },
  });

  assert.deepEqual(result, {
    checked: 2,
    status: "published",
    version: candidate.version,
  });
  assert.deepEqual(
    requests.map(({ url }) => url),
    [
      "https://registry.npmjs.org/aidoc-gen/0.2.0-beta.3",
      "https://registry.npmjs.org/%40mr-min-max%2Faidoc-gen",
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

test("allows latest to move only when it still names an existing version", async () => {
  const metadata = publishedMetadata({
    "dist-tags": { beta: candidate.version, latest: "1.0.0" },
  });
  metadata.versions["1.0.0"] = {
    name: candidate.name,
    version: "1.0.0",
    dist: {
      integrity: "sha512-c3RhYmxl",
      tarball:
        "https://registry.npmjs.org/@mr-min-max/aidoc-gen/-/aidoc-gen-1.0.0.tgz",
    },
  };

  await assert.doesNotReject(
    verifyNpmVersionPublished({
      candidate,
      fetchImpl: async (_url) =>
        _url.toString().includes("aidoc-gen/0.2.0-beta.3")
          ? jsonResponse(404, {})
          : jsonResponse(200, metadata),
    }),
  );
});

test("fails closed on missing versions, wrong tags, or malformed artifacts", async () => {
  const invalidMetadata = [
    publishedMetadata({
      "dist-tags": { beta: "0.2.0-beta.3", latest: candidate.version },
    }),
    publishedMetadata({ "dist-tags": { beta: candidate.version } }),
    publishedMetadata({
      "dist-tags": { beta: candidate.version, latest: "9.9.9" },
    }),
    publishedMetadata({ versions: {} }),
    publishedMetadata({ name: "other-package" }),
    publishedMetadata({
      versions: {
        [candidate.version]: {
          name: candidate.name,
          version: candidate.version,
          dist: { integrity: "", tarball: "https://example.com/package.tgz" },
        },
      },
    }),
  ];

  for (const metadata of invalidMetadata) {
    await assert.rejects(
      verifyNpmVersionPublished({
        candidate,
        fetchImpl: async (url) =>
          url.toString().includes("aidoc-gen/0.2.0-beta.3")
            ? jsonResponse(404, {})
            : jsonResponse(200, metadata),
      }),
      new Error(NPM_PUBLISHED_STATE_MESSAGES.verificationFailed),
    );
  }
});

test("fails closed when the legacy rejected version exists", async () => {
  await assert.rejects(
    verifyNpmVersionPublished({
      candidate,
      fetchImpl: async () => jsonResponse(200, publishedMetadata()),
    }),
    new Error(NPM_PUBLISHED_STATE_MESSAGES.verificationFailed),
  );
});

test("fails closed on status, transport, body, and size errors with fixed diagnostics", async () => {
  const failures = [
    async () => ({ status: 401, text: async () => "" }),
    async () => {
      throw new Error("seeded private path and credential");
    },
    async (url) =>
      url.toString().includes("aidoc-gen/0.2.0-beta.3")
        ? jsonResponse(404, {})
        : { status: 200, text: async () => "not json" },
    async (url) =>
      url.toString().includes("aidoc-gen/0.2.0-beta.3")
        ? jsonResponse(404, {})
        : { status: 200, text: async () => "x".repeat(1_048_577) },
  ];

  for (const fetchImpl of failures) {
    await assert.rejects(
      verifyNpmVersionPublished({ candidate, fetchImpl }),
      new Error(NPM_PUBLISHED_STATE_MESSAGES.verificationFailed),
    );
  }
});
