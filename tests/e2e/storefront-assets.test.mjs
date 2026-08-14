import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const requiredAssets = [
  "docs/assets/brand/aidoc-mark.svg",
  "docs/assets/brand/aidoc-wordmark.svg",
  "docs/assets/brand/aidoc-mark-on-dark.svg",
  "docs/assets/brand/aidoc-mark-on-light.svg",
  "docs/assets/brand/aidoc-mark-dark.png",
  "docs/assets/brand/aidoc-mark-light.png",
  "docs/assets/brand/aidoc-avatar.png",
  "docs/assets/brand/README.md",
  "docs/assets/social/aidoc-social-preview.svg",
  "docs/assets/social/aidoc-social-preview.png",
  "docs/assets/demo/aidoc-flow-poster.svg",
  "docs/assets/demo/aidoc-flow-poster.png",
];
const missingAssets = requiredAssets.filter(
  (relativePath) => !existsSync(path.join(root, relativePath)),
);

function absolutePath(relativePath) {
  return path.join(root, relativePath);
}

function readText(relativePath) {
  return readFileSync(absolutePath(relativePath), "utf8");
}

function readPng(relativePath) {
  return readFileSync(absolutePath(relativePath));
}

function pngDimensions(relativePath) {
  const bytes = readPng(relativePath);
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${relativePath} must have a PNG signature`,
  );
  assert.equal(bytes.toString("ascii", 12, 16), "IHDR");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

test("requires every repository-owned storefront static asset", () => {
  assert.deepEqual(missingAssets, []);
});

test(
  "enforces storefront asset dimensions, safety, text, and budgets",
  { skip: missingAssets.length > 0 ? "static assets are not present" : false },
  () => {
    const svgPaths = requiredAssets.filter((relativePath) =>
      relativePath.endsWith(".svg"),
    );
    const allSvg = svgPaths.map(readText).join("\n");
    const markSvg = readText("docs/assets/brand/aidoc-mark.svg");
    const wordmarkSvg = readText("docs/assets/brand/aidoc-wordmark.svg");
    const socialSvg = readText("docs/assets/social/aidoc-social-preview.svg");
    const posterSvg = readText("docs/assets/demo/aidoc-flow-poster.svg");
    const brandReadme = readText("docs/assets/brand/README.md");

    const expectedPngDimensions = {
      "docs/assets/brand/aidoc-mark-dark.png": { width: 512, height: 512 },
      "docs/assets/brand/aidoc-mark-light.png": { width: 512, height: 512 },
      "docs/assets/brand/aidoc-avatar.png": { width: 512, height: 512 },
      "docs/assets/social/aidoc-social-preview.png": {
        width: 1280,
        height: 640,
      },
      "docs/assets/demo/aidoc-flow-poster.png": {
        width: 1280,
        height: 720,
      },
    };
    for (const [relativePath, dimensions] of Object.entries(
      expectedPngDimensions,
    )) {
      assert.deepEqual(pngDimensions(relativePath), dimensions);
      assert.ok(statSync(absolutePath(relativePath)).size > 0);
    }

    const budgets = {
      "docs/assets/brand/aidoc-mark.svg": 50 * 1024,
      "docs/assets/demo/aidoc-flow-poster.png": 500 * 1024,
      "docs/assets/social/aidoc-social-preview.png": 1.5 * 1024 * 1024,
    };
    for (const [relativePath, maximumBytes] of Object.entries(budgets)) {
      assert.ok(
        statSync(absolutePath(relativePath)).size <= maximumBytes,
        `${relativePath} exceeds ${maximumBytes} bytes`,
      );
    }

    assert.match(markSvg, /viewBox="0 0 64 64"/u);
    assert.match(markSvg, /<title id="title">AiDoc mark<\/title>/u);
    assert.match(
      markSvg,
      /<desc id="desc">A document page connected to three AST nodes\.<\/desc>/u,
    );
    for (const geometry of [
      'd="M14 7h25l11 11v39H14z"',
      'd="M39 7v12h11"',
      'd="M24 29v14m0-7h15m0-7v14"',
      'cx="24" cy="29" r="4"',
      'cx="24" cy="43" r="4"',
      'cx="39" cy="29" r="4"',
      'cx="39" cy="43" r="4"',
    ]) {
      assert.match(markSvg, new RegExp(geometry, "u"));
    }
    for (const color of ["#161B22", "#F0F6FC", "#58A6FF", "#3FB950"]) {
      assert.match(markSvg, new RegExp(color, "u"));
    }
    assert.match(wordmarkSvg, /AiDoc/u);
    assert.match(wordmarkSvg, /font-family="(?:system-ui|ui-monospace)/u);
    assert.match(wordmarkSvg, /<title[^>]*>AiDoc wordmark<\/title>/u);
    assert.match(
      wordmarkSvg,
      /<desc[^>]*>[^<]*document[^<]*AST[^<]*<\/desc>/iu,
    );

    assert.doesNotMatch(
      allSvg,
      /<script|javascript:|(?:href|src)=["']https?:\/\/|xlink:href|@import|url\(/iu,
    );
    assert.doesNotMatch(allSvg, /OpenAI|Anthropic|GitHub|Claude logo/iu);
    assert.doesNotMatch(
      `${allSvg}\n${brandReadme}`,
      /\u2014/u,
      "static storefront assets must not contain a Unicode em dash",
    );

    assert.deepEqual(
      [...socialSvg.matchAll(/<text\b[^>]*>([^<]+)<\/text>/gu)].map(
        ([, textContent]) => textContent,
      ),
      [
        "AiDoc",
        "Documentation that keeps up with your code.",
        "Code change -> Impact plan -> Reviewable docs update",
      ],
    );
    assert.match(socialSvg, /viewBox="0 0 1280 640"/u);
    for (const textContent of [
      "createUser(email, role)",
      "README.md",
      "docs/API.md",
      "Validated",
    ]) {
      const escapedText = textContent.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      assert.match(posterSvg, new RegExp(escapedText, "u"));
    }
    assert.match(posterSvg, /viewBox="0 0 1280 720"/u);

    assert.match(
      brandReadme,
      /Alt text:[^\n]*document page connected to three AST nodes/iu,
    );
    assert.match(brandReadme, /clear space[^\n]*8 viewBox units/iu);
    assert.match(brandReadme, /minimum[^\n]*32[- ]pixel/iu);
    assert.match(brandReadme, /original design[^\n]*third-party logo/iu);
    assert.notDeepEqual(
      readPng("docs/assets/brand/aidoc-mark-dark.png"),
      readPng("docs/assets/brand/aidoc-mark-light.png"),
    );
  },
);
