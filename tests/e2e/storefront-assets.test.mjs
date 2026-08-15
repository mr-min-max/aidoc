import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
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
  "docs/assets/brand/aidoc-avatar-source.png",
  "docs/assets/brand/aidoc-avatar.png",
  "docs/assets/brand/README.md",
  "docs/assets/social/aidoc-social-preview-source.png",
  "docs/assets/social/aidoc-social-preview.svg",
  "docs/assets/social/aidoc-social-preview.png",
  "docs/assets/demo/aidoc-flow-poster-source.png",
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
const animationRasterFrames = [
  "docs/assets/demo/frame-01-change.png",
  "docs/assets/demo/frame-02-plan.png",
  "docs/assets/demo/frame-03-targets.png",
  "docs/assets/demo/frame-04-diff.png",
  "docs/assets/demo/frame-05-validated.png",
];
const animationRasterFrameHashes = [
  "04f5f3a52517404c82f53ba6bdf27fc480b69c28844cb1c1baa2f91ea6e42b59",
  "050a0d825b7d80eb584ae0806ff428868630ddda152d9ab2586335902c4cde2a",
  "ba25796d9eb51a11fb39503c5c51ebc308f570f30f7c6259b36f961cc433e625",
  "0936131e536cf252e497d59e8efc73bf9453bba203be51b03e8dcc1309c6bb11",
  "eeda2ad870735deff49ce73d25b00724dc43bfb617173b7108a798cd4cef52a2",
];
const productionKit = [
  "docs/demo/aidoc-walkthrough-script.md",
  "docs/demo/aidoc-walkthrough.vtt",
  "docs/demo/recording-checklist.md",
];
const task4Assets = [
  "docs/assets/demo/aidoc-flow-scene.png",
  ...animationFrames,
  ...animationRasterFrames,
  "docs/assets/demo/aidoc-flow.gif",
  ...productionKit,
];
const missingTask4Assets = task4Assets.filter(
  (relativePath) => !existsSync(path.join(root, relativePath)),
);
const unsafeSvgTextPattern = /javascript:|@import|url\(/iu;
const allowedStaticSvgAttributes = new Map([
  ["aidoc:contract", new Set()],
  ["aidoc:copy", new Set()],
  ["aidoc:evidence", new Set()],
  ["aidoc:fact", new Set()],
  ["aidoc:line", new Set()],
  ["circle", new Set(["cx", "cy", "r", "fill"])],
  ["desc", new Set(["id"])],
  ["g", new Set(["data-content-area", "data-visible-code", "transform"])],
  [
    "image",
    new Set(["href", "x", "y", "width", "height", "preserveaspectratio"]),
  ],
  ["metadata", new Set()],
  [
    "path",
    new Set([
      "d",
      "fill",
      "stroke",
      "stroke-linecap",
      "stroke-linejoin",
      "stroke-width",
    ]),
  ],
  [
    "rect",
    new Set([
      "x",
      "y",
      "width",
      "height",
      "rx",
      "fill",
      "fill-opacity",
      "stroke",
      "stroke-width",
    ]),
  ],
  [
    "svg",
    new Set([
      "xmlns",
      "xmlns:aidoc",
      "viewbox",
      "role",
      "aria-labelledby",
      "data-safe-margin",
      "data-protected-margin",
      "data-step",
      "data-visual-system",
    ]),
  ],
  [
    "text",
    new Set([
      "x",
      "y",
      "fill",
      "font-family",
      "font-size",
      "font-weight",
      "text-anchor",
      "textlength",
      "lengthadjust",
      "letter-spacing",
    ]),
  ],
  ["title", new Set(["id"])],
  ["tspan", new Set(["fill"])],
]);
const displayFont = "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
const monospaceFont = "ui-monospace, SFMono-Regular, Menlo, monospace";

function absolutePath(relativePath) {
  return path.join(root, relativePath);
}

function readText(relativePath) {
  return readFileSync(absolutePath(relativePath), "utf8");
}

function readPng(relativePath) {
  return readFileSync(absolutePath(relativePath));
}

function parseStaticSvgStartTags(source) {
  const tags = [];
  const errors = [];
  let cursor = 0;

  while (cursor < source.length) {
    const opening = source.indexOf("<", cursor);
    if (opening < 0) {
      break;
    }
    if (source.startsWith("<?", opening) || source.startsWith("<!", opening)) {
      errors.push("processing instructions and declarations are forbidden");
      cursor = opening + 2;
      continue;
    }
    if (source.startsWith("</", opening)) {
      const closing = source.indexOf(">", opening + 2);
      if (closing < 0) {
        errors.push("unterminated closing tag");
        break;
      }
      cursor = closing + 1;
      continue;
    }

    const elementMatch = /^[A-Za-z_][A-Za-z0-9_.:-]*/u.exec(
      source.slice(opening + 1),
    );
    if (!elementMatch) {
      errors.push("invalid element name");
      cursor = opening + 1;
      continue;
    }

    const name = elementMatch[0].toLowerCase();
    const attributes = [];
    let index = opening + 1 + elementMatch[0].length;
    while (index < source.length) {
      const whitespaceStart = index;
      while (/[\t\n\r ]/u.test(source[index] ?? "")) {
        index += 1;
      }
      const hadSeparator = index > whitespaceStart;
      if (source[index] === ">") {
        index += 1;
        break;
      }
      if (source[index] === "/" && source[index + 1] === ">") {
        index += 2;
        break;
      }
      if (!hadSeparator) {
        errors.push(`attributes on ${name} must be whitespace-separated`);
      }

      const attributeMatch = /^[A-Za-z_][A-Za-z0-9_.:-]*/u.exec(
        source.slice(index),
      );
      if (!attributeMatch) {
        errors.push(`invalid attribute on ${name}`);
        index += 1;
        continue;
      }
      const attributeName = attributeMatch[0].toLowerCase();
      index += attributeMatch[0].length;
      while (/[\t\n\r ]/u.test(source[index] ?? "")) {
        index += 1;
      }
      if (source[index] !== "=") {
        errors.push(`attribute ${attributeName} on ${name} must have a value`);
        continue;
      }
      index += 1;
      while (/[\t\n\r ]/u.test(source[index] ?? "")) {
        index += 1;
      }
      const quote = source[index];
      if (quote !== '"' && quote !== "'") {
        errors.push(`attribute ${attributeName} on ${name} must be quoted`);
        continue;
      }
      const valueStart = index + 1;
      const valueEnd = source.indexOf(quote, valueStart);
      if (valueEnd < 0) {
        errors.push(`attribute ${attributeName} on ${name} is unterminated`);
        index = source.length;
        break;
      }
      const rawValue = source.slice(valueStart, valueEnd);
      if (rawValue.includes("<")) {
        errors.push(`attribute ${attributeName} on ${name} contains markup`);
      }
      attributes.push({
        name: attributeName,
        value: rawValue.replace(/[\t\n\r ]+/gu, " ").trim(),
      });
      index = valueEnd + 1;
    }
    tags.push({ name, attributes });
    cursor = Math.max(index, opening + 1);
  }

  return { tags, errors };
}

function localImageReferences(source) {
  return parseStaticSvgStartTags(source).tags.flatMap(({ attributes }) =>
    attributes
      .filter(({ name }) => ["href", "src", "xlink:href"].includes(name))
      .map(({ value }) => value),
  );
}

function attributeObject(tag) {
  return Object.fromEntries(
    tag.attributes.map(({ name, value }) => [name, value]),
  );
}

function staticSvgViolations(source, approvedReferences) {
  const parsed = parseStaticSvgStartTags(source);
  const violations = [...parsed.errors];
  for (const { name: elementName, attributes } of parsed.tags) {
    const allowedAttributes = allowedStaticSvgAttributes.get(elementName);
    if (!allowedAttributes) {
      violations.push(`unsupported SVG element: ${elementName}`);
      continue;
    }
    const attributeNames = new Set();
    for (const { name: attributeName, value } of attributes) {
      if (attributeNames.has(attributeName)) {
        violations.push(
          `duplicate ${attributeName} attribute on ${elementName}`,
        );
      }
      attributeNames.add(attributeName);
      if (!allowedAttributes.has(attributeName)) {
        violations.push(
          `unsupported ${attributeName} attribute on ${elementName}`,
        );
      }
      if (
        ["href", "src", "xlink:href"].includes(attributeName) &&
        (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value) ||
          value.split("/").includes(".."))
      ) {
        violations.push(`unsafe resource reference on ${elementName}`);
      }
      if (attributeName === "xmlns" && value !== "http://www.w3.org/2000/svg") {
        violations.push("unexpected default SVG namespace");
      }
      if (attributeName === "xmlns:aidoc" && value !== "urn:aidoc:assets") {
        violations.push("unexpected AiDoc metadata namespace");
      }
    }
  }
  if (unsafeSvgTextPattern.test(source)) {
    violations.push("unsafe active SVG text");
  }
  if (
    JSON.stringify(localImageReferences(source)) !==
    JSON.stringify(approvedReferences)
  ) {
    violations.push("resource references differ from the approved allowlist");
  }
  return violations;
}

function metadataValues(source, elementName) {
  return [
    ...source.matchAll(
      new RegExp(`<aidoc:${elementName}>([^<]+)</aidoc:${elementName}>`, "gu"),
    ),
  ].map(([, value]) => value);
}

function visibleCodeValues(source) {
  return [
    ...source.matchAll(
      /<g\b[^>]*data-visible-code="[^"]+"[^>]*>([\s\S]*?)<\/g>/gu,
    ),
  ].map(([, body]) => {
    const text = /<text\b[^>]*>([\s\S]*?)<\/text>/u.exec(body);
    assert.ok(text, "visible code group must contain a text element");
    return text[1]
      .replace(/<[^>]+>/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
  });
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
    ...gifContract(bytes),
  };
}

function gifContract(bytes) {
  const loopApplicationId = Buffer.from("NETSCAPE2.0", "ascii");
  const loopApplicationOffset = bytes.indexOf(loopApplicationId);
  const loopCount =
    loopApplicationOffset >= 0 && loopApplicationOffset + 15 <= bytes.length
      ? bytes.readUInt16LE(loopApplicationOffset + 13)
      : null;
  let durationCentiseconds = 0;
  let frameCount = 0;
  for (let index = 0; index + 7 < bytes.length; index += 1) {
    if (
      bytes[index] === 0x21 &&
      bytes[index + 1] === 0xf9 &&
      bytes[index + 2] === 0x04
    ) {
      durationCentiseconds += bytes.readUInt16LE(index + 4);
      frameCount += 1;
    }
  }
  return {
    loopCount,
    frameCount,
    durationSeconds: durationCentiseconds / 100,
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

test("enforces a static SVG profile across resource syntax variants", () => {
  const source = `<svg>
    <image href = 'https://example.invalid/remote.png' />
    <image href="local.png" />
    <use xlink:href = '#mark' />
  </svg>`;

  assert.deepEqual(localImageReferences(source), [
    "https://example.invalid/remote.png",
    "local.png",
    "#mark",
  ]);
  assert.notDeepEqual(staticSvgViolations(source, ["local.png"]), []);

  const multilineRemote = `<svg>
    <image data-href="approved.png"
           href="
//example.invalid/remote.png" />
  </svg>`;
  assert.deepEqual(localImageReferences(multilineRemote), [
    "//example.invalid/remote.png",
  ]);
  assert.notDeepEqual(
    staticSvgViolations(multilineRemote, ["approved.png"]),
    [],
  );

  const hostileSources = [
    `<?xml-stylesheet href="unapproved.css"?><svg />`,
    `<!DOCTYPE svg [<!ENTITY remote SYSTEM "https://example.invalid/x">]><svg />`,
    `<svg><image href="approved.png"><animate attributeName="href" values="approved.png;https://example.invalid/x.png" /></image></svg>`,
    `<svg><set attributeName="href" to="https://example.invalid/x.png" /></svg>`,
    `<svg xml:base="https://example.invalid/"><image href="approved.png" /></svg>`,
    `<svg style="background-image: url(https://example.invalid/x.png)" />`,
    `<svg><image href="file:///private/example.png" /></svg>`,
    `<svg><image href="ftp://example.invalid/x.png" /></svg>`,
  ];
  for (const hostileSource of hostileSources) {
    assert.notDeepEqual(
      staticSvgViolations(hostileSource, ["approved.png"]),
      [],
    );
  }
});

test("decodes the GIF loop extension instead of checking its label only", () => {
  const source = readFileSync(absolutePath("docs/assets/demo/aidoc-flow.gif"));
  const applicationOffset = source.indexOf(Buffer.from("NETSCAPE2.0", "ascii"));
  assert.ok(applicationOffset >= 0);

  const finiteLoop = Buffer.from(source);
  finiteLoop.writeUInt16LE(1, applicationOffset + 13);
  assert.equal(gifContract(finiteLoop).loopCount, 1);
  assert.equal(gifContract(source).loopCount, 0);
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
    const describedMarkSvgs = [
      markSvg,
      wordmarkSvg,
      readText("docs/assets/brand/aidoc-mark-on-dark.svg"),
      readText("docs/assets/brand/aidoc-mark-on-light.svg"),
    ];
    const approvedSvgReferences = new Map([
      [
        "docs/assets/social/aidoc-social-preview.svg",
        ["aidoc-social-preview-source.png"],
      ],
      [
        "docs/assets/demo/aidoc-flow-poster.svg",
        ["aidoc-flow-poster-source.png"],
      ],
    ]);

    const expectedPngDimensions = {
      "docs/assets/brand/aidoc-mark-dark.png": { width: 512, height: 512 },
      "docs/assets/brand/aidoc-mark-light.png": { width: 512, height: 512 },
      "docs/assets/brand/aidoc-avatar-source.png": {
        width: 1254,
        height: 1254,
      },
      "docs/assets/brand/aidoc-avatar.png": { width: 512, height: 512 },
      "docs/assets/social/aidoc-social-preview-source.png": {
        width: 1774,
        height: 887,
      },
      "docs/assets/social/aidoc-social-preview.png": {
        width: 1280,
        height: 640,
      },
      "docs/assets/demo/aidoc-flow-poster-source.png": {
        width: 1774,
        height: 887,
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
      "docs/assets/brand/aidoc-avatar-source.png": 2 * 1024 * 1024,
      "docs/assets/social/aidoc-social-preview-source.png": 2 * 1024 * 1024,
      "docs/assets/demo/aidoc-flow-poster-source.png": 2 * 1024 * 1024,
      "docs/assets/demo/aidoc-flow-poster.png": 1.25 * 1024 * 1024,
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
      /<desc id="desc">A document page connected to four semantic nodes\.<\/desc>/u,
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
    for (const describedMark of describedMarkSvgs) {
      assert.match(describedMark, /<desc[^>]*>[^<]*four semantic nodes/iu);
      assert.doesNotMatch(describedMark, /three AST nodes/iu);
    }
    for (const relativePath of svgPaths) {
      assert.deepEqual(
        staticSvgViolations(
          readText(relativePath),
          approvedSvgReferences.get(relativePath) ?? [],
        ),
        [],
        `${relativePath} must use the strict static SVG profile`,
      );
    }

    assert.doesNotMatch(allSvg, /OpenAI|Anthropic|GitHub|Claude logo/iu);
    assert.doesNotMatch(
      `${allSvg}\n${brandReadme}`,
      /\u2014/u,
      "static storefront assets must not contain a Unicode em dash",
    );

    assert.match(
      socialSvg,
      /data-visual-system="dimensional-code-to-docs-v1"/u,
    );
    assert.deepEqual(localImageReferences(socialSvg), [
      "aidoc-social-preview-source.png",
    ]);
    assert.deepEqual(metadataValues(socialSvg, "line"), [
      "AiDoc",
      "Documentation that keeps up with your code.",
      "Code change -> Impact plan -> Reviewable docs update",
    ]);
    assert.deepEqual(visibleCodeValues(socialSvg), [
      "createUser(email)",
      "createUser(email, role)",
    ]);
    const socialTextAttributes = parseStaticSvgStartTags(socialSvg)
      .tags.filter(({ name }) => name === "text")
      .map(attributeObject);
    assert.deepEqual(
      socialTextAttributes.map((attributes) => attributes["font-family"]),
      [monospaceFont, monospaceFont],
    );
    assert.ok(
      Number(socialTextAttributes[0].x) +
        Number(socialTextAttributes[0].textlength) <=
        374,
      "before code must remain inside its dark code row",
    );
    const afterCode = "createUser(email, role)";
    const afterCodeWidth =
      afterCode.length * Number(socialTextAttributes[1]["font-size"]) * 0.61 +
      (afterCode.length - 1) *
        Number(socialTextAttributes[1]["letter-spacing"]);
    assert.ok(
      Number(socialTextAttributes[1].x) + afterCodeWidth <= 381,
      "after code must remain inside its dark code row",
    );
    assert.deepEqual(metadataValues(posterSvg, "fact"), [
      "createUser(email)",
      "createUser(email, role)",
      "README.md",
      "docs/API.md",
      "Validated",
      "No provider calls",
      "No repository writes",
      "You decide what is applied",
    ]);
    assert.match(
      posterSvg,
      /data-visual-system="dimensional-code-to-docs-v1"/u,
    );
    assert.deepEqual(localImageReferences(posterSvg), [
      "aidoc-flow-poster-source.png",
    ]);
    assert.deepEqual(
      [...posterSvg.matchAll(/<text\b[^>]*>([^<]+)<\/text>/gu)].map(
        ([, textContent]) => textContent,
      ),
      [
        "No provider calls",
        "No repository writes",
        "You decide what is applied",
      ],
    );
    const posterTextAttributes = parseStaticSvgStartTags(posterSvg)
      .tags.filter(({ name }) => name === "text")
      .map(attributeObject);
    assert.deepEqual(
      posterTextAttributes.map((attributes) => attributes["font-family"]),
      [displayFont, displayFont, displayFont],
    );
    for (const [index, textContent] of [
      "No provider calls",
      "No repository writes",
      "You decide what is applied",
    ].entries()) {
      const attributes = posterTextAttributes[index];
      const estimatedRight =
        Number(attributes.x) +
        textContent.length * Number(attributes["font-size"]) * 0.5;
      assert.ok(
        estimatedRight <= 1240,
        `${textContent} exceeds the proof strip`,
      );
    }
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

    const approvedRasterSources = [
      readPng("docs/assets/social/aidoc-social-preview-source.png"),
      readPng("docs/assets/demo/aidoc-flow-poster-source.png"),
    ];
    assert.notDeepEqual(approvedRasterSources[0], approvedRasterSources[1]);
    for (const rasterSource of [
      ...approvedRasterSources,
      readPng("docs/assets/demo/aidoc-flow-scene.png"),
    ]) {
      assert.doesNotMatch(
        rasterSource.toString("latin1"),
        /OpenAI|gpt-image|c2pa\.icon/iu,
        "tracked raster sources must not retain provider branding metadata",
      );
    }

    assert.match(
      brandReadme,
      /Alt text:[^\n]*document page connected to four semantic nodes/iu,
    );
    assert.match(brandReadme, /clear space[^\n]*8 viewBox units/iu);
    assert.match(brandReadme, /minimum[^\n]*32[- ]pixel/iu);
    assert.match(brandReadme, /original design[^\n]*third-party logo/iu);
    assert.notDeepEqual(
      readPng("docs/assets/brand/aidoc-mark-dark.png"),
      readPng("docs/assets/brand/aidoc-mark-light.png"),
    );
    assert.notDeepEqual(
      readPng("docs/assets/brand/aidoc-avatar.png"),
      readPng("docs/assets/brand/aidoc-mark-dark.png"),
    );
    assert.notDeepEqual(
      readPng("docs/assets/brand/aidoc-avatar.png"),
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
    const combinedFrames = frameSources.join("\n");
    const plainHeadlines = [
      "Code changed",
      "Two docs affected",
      "Bounded draft",
      "Draft validated",
      "You review",
    ];
    const plainSubheads = [
      "createUser(email) -> createUser(email, role)",
      "prepare_documentation_update",
      "README.md + docs/API.md",
      "validate_documentation_draft",
      "You decide what is applied",
    ];

    frameSources.forEach((source, index) => {
      assert.match(source, /<svg\b[^>]*viewBox="0 0 1280 720"/u);
      assert.match(source, /data-visual-system="dimensional-code-to-docs-v1"/u);
      assert.match(source, /data-safe-margin="64"/u);
      assert.match(source, /data-protected-margin="80"/u);
      assert.match(source, new RegExp(`data-step="${index + 1}"`, "u"));
      assert.match(
        source,
        /<g\b[^>]*data-content-area="safe"[^>]*transform="translate\(64 64\)"[^>]*>/u,
      );
      assert.deepEqual(
        staticSvgViolations(source, [
          path.basename(animationRasterFrames[index]),
        ]),
        [],
        "animation frames must use the strict static SVG profile",
      );
      assert.deepEqual(metadataValues(source, "line"), [
        "AiDoc",
        plainHeadlines[index],
        plainSubheads[index],
        `${index + 1} / 5`,
        "No provider calls",
        "No repository writes",
        "You decide what is applied",
      ]);
      const imageTag = parseStaticSvgStartTags(source).tags.find(
        ({ name }) => name === "image",
      );
      assert.deepEqual(attributeObject(imageTag), {
        href: path.basename(animationRasterFrames[index]),
        x: "-64",
        y: "-64",
        width: "1280",
        height: "720",
        preserveaspectratio: "xMidYMid meet",
      });
    });

    assert.deepEqual(pngDimensions("docs/assets/demo/aidoc-flow-scene.png"), {
      width: 1774,
      height: 887,
    });
    assert.ok(
      statSync(absolutePath("docs/assets/demo/aidoc-flow-scene.png")).size <=
        2 * 1024 * 1024,
    );

    const rasterFrameSources = animationRasterFrames.map(readPng);
    animationRasterFrames.forEach((relativePath, index) => {
      assert.deepEqual(pngDimensions(relativePath), {
        width: 1280,
        height: 720,
      });
      assert.ok(
        statSync(absolutePath(relativePath)).size <= 1024 * 1024,
        `${relativePath} exceeds the 1 MiB frame-source budget`,
      );
      assert.equal(
        createHash("sha256").update(readPng(relativePath)).digest("hex"),
        animationRasterFrameHashes[index],
        `${relativePath} differs from the reviewed Photoshop export`,
      );
    });
    for (const rasterFrameSource of rasterFrameSources) {
      assert.doesNotMatch(
        rasterFrameSource.toString("latin1"),
        /OpenAI|gpt-image|c2pa\.icon|\/Users\/|Adobe Photoshop/iu,
        "tracked animation frames must not retain provider or private metadata",
      );
    }
    for (let index = 1; index < rasterFrameSources.length; index += 1) {
      assert.notDeepEqual(
        rasterFrameSources[index - 1],
        rasterFrameSources[index],
        "each animation stage must have distinct visual focus",
      );
    }

    for (const evidence of [
      "prepare_documentation_update",
      "validate_documentation_draft",
      "No provider calls",
      "No repository writes",
      "You decide what is applied",
    ]) {
      assert.match(
        combinedFrames,
        new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
      );
    }

    const gif = gifDimensions("docs/assets/demo/aidoc-flow.gif");
    assert.deepEqual(
      { width: gif.width, height: gif.height },
      { width: 960, height: 540 },
    );
    assert.ok(
      gif.bytes.includes(Buffer.from("NETSCAPE2.0", "ascii")),
      "GIF must contain an infinite-loop application extension",
    );
    assert.equal(gif.loopCount, 0, "GIF must loop indefinitely");
    assert.equal(gif.frameCount, 180, "GIF must contain 15 seconds at 12 fps");
    assert.ok(
      gif.durationSeconds >= 14.5 && gif.durationSeconds <= 15.5,
      `GIF must last about 15 seconds, received ${gif.durationSeconds}`,
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
