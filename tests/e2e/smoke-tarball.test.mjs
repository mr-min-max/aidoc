import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getConfiguredSmokeTarball } from "./smoke-tarball.mjs";

test("returns the exact configured absolute tarball", () => {
  const root = mkdtempSync(join(tmpdir(), "aidoc-smoke-tarball-"));
  const tarball = join(root, "aidoc-gen-0.1.1.tgz");
  writeFileSync(tarball, "fixture");

  try {
    assert.equal(
      getConfiguredSmokeTarball({ AIDOC_TEST_TARBALL: tarball }),
      tarball,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preserves local packing when no tarball is configured", () => {
  assert.equal(getConfiguredSmokeTarball({}), null);
});

test("rejects configured tarballs that are not absolute existing tgz files", () => {
  const root = mkdtempSync(join(tmpdir(), "aidoc-smoke-tarball-"));
  const wrongExtension = join(root, "aidoc-gen.tar");
  const directory = join(root, "directory.tgz");
  writeFileSync(wrongExtension, "fixture");
  mkdirSync(directory);

  try {
    assert.throws(
      () =>
        getConfiguredSmokeTarball({
          AIDOC_TEST_TARBALL: "relative/package.tgz",
        }),
      /absolute path/i,
    );
    assert.throws(
      () =>
        getConfiguredSmokeTarball({
          AIDOC_TEST_TARBALL: join(root, "missing.tgz"),
        }),
      /existing file/i,
    );
    assert.throws(
      () =>
        getConfiguredSmokeTarball({
          AIDOC_TEST_TARBALL: wrongExtension,
        }),
      /\.tgz/i,
    );
    assert.throws(
      () =>
        getConfiguredSmokeTarball({
          AIDOC_TEST_TARBALL: directory,
        }),
      /existing file/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
