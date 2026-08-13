import { createHmac, timingSafeEqual } from "node:crypto";
import { posix as pathPosix } from "node:path";
import { canonicalStringify } from "../impact/canonical";
import { MAX_MAX_CONTEXT_BYTES, MIN_MAX_CONTEXT_BYTES } from "../impact/types";

export const MCP_PREPARATION_SCHEMA = "aidoc.mcp-preparation.v1" as const;
export const MCP_INVALID_PREPARATION = "MCP_INVALID_PREPARATION" as const;

const TOKEN_PREFIX = "v1";
const MAX_TOKEN_LENGTH = 4096;
const MAX_TARGET_BYTES = 1024;
const MAX_REF_BYTES = 1024;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export interface PreparationClaims {
  readonly schemaVersion: typeof MCP_PREPARATION_SCHEMA;
  readonly planDigest: string;
  readonly base?: string;
  readonly head?: string;
  readonly maxContextBytes: number;
  readonly target: string;
  readonly targetDigest: string;
}

/** Stable public error for every malformed or stale preparation token. */
export class MCPPreparationError extends Error {
  readonly code = MCP_INVALID_PREPARATION;

  constructor() {
    super("The MCP preparation is invalid.");
    this.name = "MCPPreparationError";
  }
}

/** Issues and verifies bounded opaque preparation claims for one MCP server. */
export class PreparationTokenCodec {
  private readonly secret: Uint8Array;

  constructor(secret: Uint8Array) {
    if (!(secret instanceof Uint8Array) || secret.byteLength === 0) {
      throw new MCPPreparationError();
    }
    this.secret = new Uint8Array(secret);
  }

  issue(claims: PreparationClaims): string {
    try {
      const normalized = validateClaims(claims);
      const canonicalClaims = canonicalStringify(normalized);
      const claimsSegment = encodeBase64Url(canonicalClaims);
      const signed = `${TOKEN_PREFIX}.${claimsSegment}`;
      const mac = createHmac("sha256", this.secret)
        .update(signed, "utf8")
        .digest("base64url");
      const token = `${signed}.${mac}`;
      if (token.length > MAX_TOKEN_LENGTH) throw new MCPPreparationError();
      return token;
    } catch (error: unknown) {
      if (error instanceof MCPPreparationError) throw error;
      throw new MCPPreparationError();
    }
  }

  verify(token: string): PreparationClaims {
    try {
      if (typeof token !== "string" || token.length === 0) {
        throw new MCPPreparationError();
      }
      if (token.length > MAX_TOKEN_LENGTH) throw new MCPPreparationError();

      const segments = token.split(".");
      if (segments.length !== 3 || segments[0] !== TOKEN_PREFIX) {
        throw new MCPPreparationError();
      }
      const claimsSegment = segments[1];
      const macSegment = segments[2];
      assertBase64Url(claimsSegment);
      assertBase64Url(macSegment);

      const expectedMac = createHmac("sha256", this.secret)
        .update(`${TOKEN_PREFIX}.${claimsSegment}`, "utf8")
        .digest();
      const actualMac = decodeBase64Url(macSegment);
      if (
        actualMac.byteLength !== expectedMac.byteLength ||
        !timingSafeEqual(actualMac, expectedMac)
      ) {
        throw new MCPPreparationError();
      }

      const claimsJson = decodeUtf8(claimsSegment);
      const parsed: unknown = JSON.parse(claimsJson);
      if (canonicalStringify(parsed) !== claimsJson) {
        throw new MCPPreparationError();
      }
      return validateClaims(parsed);
    } catch (error: unknown) {
      if (error instanceof MCPPreparationError) throw error;
      throw new MCPPreparationError();
    }
  }
}

function validateClaims(value: unknown): PreparationClaims {
  if (!isPlainRecord(value)) throw new MCPPreparationError();

  const keys = Reflect.ownKeys(value);
  const stringKeys = keys.filter(
    (key): key is string => typeof key === "string",
  );
  if (stringKeys.length !== keys.length) {
    throw new MCPPreparationError();
  }

  const allowed = new Set([
    "schemaVersion",
    "planDigest",
    "base",
    "head",
    "maxContextBytes",
    "target",
    "targetDigest",
  ]);
  if (!stringKeys.every((key) => allowed.has(key))) {
    throw new MCPPreparationError();
  }
  if (
    !hasOwnDataProperty(value, "schemaVersion") ||
    !hasOwnDataProperty(value, "planDigest") ||
    !hasOwnDataProperty(value, "maxContextBytes") ||
    !hasOwnDataProperty(value, "target") ||
    !hasOwnDataProperty(value, "targetDigest")
  ) {
    throw new MCPPreparationError();
  }

  const schemaVersion = readOwnValue(value, "schemaVersion");
  const planDigest = readOwnValue(value, "planDigest");
  const maxContextBytes = readOwnValue(value, "maxContextBytes");
  const target = readOwnValue(value, "target");
  const targetDigest = readOwnValue(value, "targetDigest");
  const base = readOptionalString(value, "base");
  const head = readOptionalString(value, "head");

  if (
    schemaVersion !== MCP_PREPARATION_SCHEMA ||
    typeof planDigest !== "string" ||
    !SHA256_HEX_PATTERN.test(planDigest) ||
    typeof maxContextBytes !== "number" ||
    !Number.isInteger(maxContextBytes) ||
    maxContextBytes < MIN_MAX_CONTEXT_BYTES ||
    maxContextBytes > MAX_MAX_CONTEXT_BYTES ||
    typeof target !== "string" ||
    !isSafeTarget(target) ||
    typeof targetDigest !== "string" ||
    !SHA256_HEX_PATTERN.test(targetDigest)
  ) {
    throw new MCPPreparationError();
  }

  return {
    schemaVersion,
    planDigest,
    ...(base === undefined ? {} : { base }),
    ...(head === undefined ? {} : { head }),
    maxContextBytes,
    target,
    targetDigest,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  try {
    return (
      Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null
    );
  } catch {
    return false;
  }
}

function hasOwnDataProperty(
  value: Record<string, unknown>,
  key: string,
): boolean {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor;
  } catch {
    throw new MCPPreparationError();
  }
}

function readOwnValue(value: Record<string, unknown>, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new MCPPreparationError();
    }
    return descriptor.value;
  } catch (error: unknown) {
    if (error instanceof MCPPreparationError) throw error;
    throw new MCPPreparationError();
  }
}

function readOptionalString(
  value: Record<string, unknown>,
  key: "base" | "head",
): string | undefined {
  if (!Object.hasOwn(value, key)) return undefined;
  const candidate = readOwnValue(value, key);
  if (typeof candidate !== "string" || !isSafeRef(candidate)) {
    throw new MCPPreparationError();
  }
  return candidate;
}

function isSafeTarget(value: string): boolean {
  if (
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > MAX_TARGET_BYTES ||
    hasControlCharacter(value) ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:\//u.test(value) ||
    !value.toLowerCase().endsWith(".md")
  ) {
    return false;
  }
  const normalized = pathPosix.normalize(value);
  return (
    normalized === value &&
    normalized !== "." &&
    normalized !== ".." &&
    !normalized.startsWith("../")
  );
}

function isSafeRef(value: string): boolean {
  return (
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= MAX_REF_BYTES &&
    !hasControlCharacter(value)
  );
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function assertBase64Url(value: string): void {
  if (value.length === 0 || !BASE64URL_PATTERN.test(value)) {
    throw new MCPPreparationError();
  }
}

function decodeBase64Url(value: string): Buffer {
  assertBase64Url(value);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new MCPPreparationError();
  }
  return decoded;
}

function decodeUtf8(value: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      decodeBase64Url(value),
    );
  } catch {
    throw new MCPPreparationError();
  }
}
