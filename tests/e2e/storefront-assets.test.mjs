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
const animationFrames = [
  "docs/assets/demo/frame-01-change.svg",
  "docs/assets/demo/frame-02-plan.svg",
  "docs/assets/demo/frame-03-targets.svg",
  "docs/assets/demo/frame-04-diff.svg",
  "docs/assets/demo/frame-05-validated.svg",
];
const productionKit = [
  "docs/demo/aidoc-walkthrough-script.md",
  "docs/demo/aidoc-walkthrough.vtt",
  "docs/demo/recording-checklist.md",
];
const task4Assets = [
  ...animationFrames,
  "docs/assets/demo/aidoc-flow.gif",
  ...productionKit,
];
const missingTask4Assets = task4Assets.filter(
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

function gifDimensions(relativePath) {
  const bytes = readFileSync(absolutePath(relativePath));
  assert.equal(
    bytes.toString("ascii", 0, 6),
    "GIF89a",
    `${relativePath} must use the GIF89a header`,
  );
  return {
    width: bytes.readUInt16LE(6),
    height: bytes.readUInt16LE(8),
    bytes,
  };
}

function parseVttTime(value) {
  const match = /^(\d{2}):(\d{2})\.(\d{3})$/u.exec(value);
  assert.ok(match, `invalid WebVTT timestamp ${value}`);
  return Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 1000;
}

function parseVttCues(source) {
  return source
    .replace(/\r/g, "")
    .split("\n\n")
    .slice(1)
    .filter(Boolean)
    .map((block) => {
      const timing = block.split("\n").find((line) => line.includes("-->"));
      assert.ok(timing, "every WebVTT cue must have a timing line");
      const match = /^(\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}\.\d{3})$/u.exec(
        timing,
      );
      assert.ok(match, `invalid WebVTT timing line ${timing}`);
      return [parseVttTime(match[1]), parseVttTime(match[2])];
    });
}

test("requires every repository-owned storefront static asset", () => {
  assert.deepEqual(missingAssets, []);
});

test("requires the reproducible animation and walkthrough production kit", () => {
  assert.deepEqual(missingTask4Assets, []);
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

test(
  "enforces the five-frame animation contract and truthful production kit",
  {
    skip:
      missingTask4Assets.length > 0 ? "Task 4 assets are not present" : false,
  },
  () => {
    const frameSources = animationFrames.map(readText);
    const script = readText(productionKit[0]);
    const vtt = readText(productionKit[1]);
    const checklist = readText(productionKit[2]);
    const combinedText = [...frameSources, script, vtt, checklist].join("\n");

    frameSources.forEach((source, index) => {
      assert.match(source, /<svg\b[^>]*viewBox="0 0 1280 720"/u);
      assert.match(source, /data-safe-margin="64"/u);
      assert.match(
        source,
        /<g\b[^>]*data-content-area="safe"[^>]*transform="translate\(64 64\)"[^>]*>/u,
      );
      assert.match(source, /width="1152" height="592"/u);
      assert.match(source, new RegExp(`${index + 1} / 5`, "u"));
      const textElements = source.match(/<text\b/gu) ?? [];
      const fontSizes = [...source.matchAll(/font-size="(\d+)"/gu)].map(
        ([, value]) => Number(value),
      );
      assert.equal(
        textElements.length,
        fontSizes.length,
        "every visible frame text element must declare a font size",
      );
      assert.ok(fontSizes.length > 0, "frame text must declare font sizes");
      assert.ok(
        Math.min(...fontSizes) >= 24,
        "frame body text must be at least 24px",
      );
      assert.doesNotMatch(
        source,
        /<script\b|<image\b|<foreignObject\b|<use\b|javascript:|(?:href|xlink:href|src)=|@import|url\(|\son[a-z]+=/iu,
      );
    });

    const gif = gifDimensions("docs/assets/demo/aidoc-flow.gif");
    assert.deepEqual(
      { width: gif.width, height: gif.height },
      { width: 960, height: 540 },
    );
    assert.ok(
      gif.bytes.includes(Buffer.from("NETSCAPE2.0", "ascii")),
      "GIF must contain an infinite-loop application extension",
    );
    assert.ok(
      statSync(absolutePath("docs/assets/demo/aidoc-flow.gif")).size <=
        6 * 1024 * 1024,
    );

    assert.match(vtt, /^WEBVTT\n/u);
    assert.deepEqual(parseVttCues(vtt), [
      [0, 10],
      [10, 25],
      [25, 50],
      [50, 70],
      [70, 80],
    ]);
    for (const requiredText of [
      "createUser(email)",
      "createUser(email, role)",
      "README.md",
      "docs/API.md",
      "prepare_documentation_update",
      "validate_documentation_draft",
      "Review the diff",
      "Public beta",
    ]) {
      assert.match(
        combinedText,
        new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
      );
    }
    assert.match(script, /deterministic/u);
    assert.match(script, /does not claim to invoke\s+Codex/u);
    assert.match(script, /live Codex host workflow/u);
    for (const checklistText of [
      "fresh disposable repository",
      "no visible accounts",
      "API keys",
      "1080p",
      "24px-equivalent",
      "English captions",
      "final privacy scan",
      "public instructions",
      "reviewed upload",
      "ElevenLabs narration is synthetic",
      "MP4 is not committed",
    ]) {
      assert.match(
        checklist,
        new RegExp(checklistText.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"),
      );
    }

    assert.doesNotMatch(
      combinedText,
      /(?:\/Users\/|\/home\/|[A-Z]:\\\\(?:Users|home)\\\\)/iu,
    );
    assert.doesNotMatch(
      combinedText,
      /(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|AIDOC_[A-Z0-9_]*(?:KEY|TOKEN))\s*[:=]\s*\S+/iu,
    );
    assert.doesNotMatch(
      combinedText,
      /(?:preparation_digest|raw prompt|raw digest)\s*[:=]\s*[a-f0-9]{32,}/iu,
    );
    assert.doesNotMatch(
      combinedText,
      /\b(?:AI-generated|model-generated|provider-generated|Codex-generated|trusted by|adopted by|testimonial|customer|downloads|stars)\b/iu,
    );
    assert.doesNotMatch(
      combinedText,
      /\bsynthetic\s+(?:user|adoption|testimonial)\b/iu,
    );
    assert.doesNotMatch(combinedText, /\u2014/u);
    assert.doesNotMatch(combinedText, /OpenAI|Anthropic|GitHub|Claude logo/iu);
  },
);
