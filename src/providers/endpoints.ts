import { lookup as defaultLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { AidocConfig } from "../config/schema";
import {
  ProviderConfigurationError,
  type ProviderConfigurationMessageVariant,
} from "./errors";

export interface ApprovedProviderEndpoint {
  readonly url: URL;
  readonly origin: string;
  readonly local: boolean;
  readonly addresses: readonly {
    readonly address: string;
    readonly family: 4 | 6;
  }[];
}

type Lookup = typeof import("node:dns/promises").lookup;

function invalidEndpoint(variant?: ProviderConfigurationMessageVariant): never {
  throw new ProviderConfigurationError("PROVIDER_INVALID_ENDPOINT", variant);
}

function notPublicEndpoint(): never {
  throw new ProviderConfigurationError("PROVIDER_ENDPOINT_NOT_PUBLIC");
}

function localHttpNotConfirmed(): never {
  throw new ProviderConfigurationError("PROVIDER_LOCAL_HTTP_NOT_CONFIRMED");
}

function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

function parseIPv4(address: string): number[] | undefined {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return undefined;
  }
  const values = parts.map((part) => Number(part));
  return values.every((value) => value >= 0 && value <= 255)
    ? values
    : undefined;
}

function isLoopbackIPv4(parts: number[]): boolean {
  return parts[0] === 127;
}

interface IPv4Prefix {
  readonly network: number;
  readonly mask: number;
}

function ipv4Prefix(address: string, bits: number): IPv4Prefix {
  const parts = parseIPv4(address);
  if (parts === undefined) {
    throw new Error("invalid built-in IPv4 prefix");
  }
  const value = parts.reduce((result, part) => (result * 256 + part) >>> 0, 0);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { network: value & mask, mask };
}

function matchesIPv4Prefix(parts: number[], prefix: IPv4Prefix): boolean {
  const value = parts.reduce((result, part) => (result * 256 + part) >>> 0, 0);
  return (value & prefix.mask) === prefix.network;
}

const NON_GLOBAL_IPV4_PREFIXES: readonly IPv4Prefix[] = [
  ipv4Prefix("0.0.0.0", 8),
  ipv4Prefix("10.0.0.0", 8),
  ipv4Prefix("100.64.0.0", 10),
  ipv4Prefix("127.0.0.0", 8),
  ipv4Prefix("169.254.0.0", 16),
  ipv4Prefix("172.16.0.0", 12),
  ipv4Prefix("192.0.0.0", 24),
  ipv4Prefix("192.0.2.0", 24),
  ipv4Prefix("192.88.99.0", 24),
  ipv4Prefix("192.168.0.0", 16),
  ipv4Prefix("198.18.0.0", 15),
  ipv4Prefix("198.51.100.0", 24),
  ipv4Prefix("203.0.113.0", 24),
  ipv4Prefix("224.0.0.0", 4),
  ipv4Prefix("240.0.0.0", 4),
];

const GLOBAL_IPV4_SPECIAL_EXCEPTIONS: readonly IPv4Prefix[] = [
  ipv4Prefix("192.0.0.9", 32),
  ipv4Prefix("192.0.0.10", 32),
];

function isNonPublicIPv4(parts: number[]): boolean {
  const matchesNonGlobalPrefix = NON_GLOBAL_IPV4_PREFIXES.some((prefix) =>
    matchesIPv4Prefix(parts, prefix),
  );
  if (!matchesNonGlobalPrefix) return false;
  return !GLOBAL_IPV4_SPECIAL_EXCEPTIONS.some((prefix) =>
    matchesIPv4Prefix(parts, prefix),
  );
}

function parseIPv6(address: string): bigint | undefined {
  const withoutZone = address.split("%")[0];
  if (withoutZone.length === 0) return undefined;
  const halves = withoutZone.split("::");
  if (halves.length > 2) return undefined;

  const parseHextets = (value: string): number[] | undefined => {
    if (!value) return [];
    const parts = value.split(":");
    const result: number[] = [];
    for (const part of parts) {
      if (part.includes(".")) {
        const ipv4 = parseIPv4(part);
        if (ipv4 === undefined || result.length > 5) return undefined;
        result.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(part)) return undefined;
        result.push(parseInt(part, 16));
      }
    }
    return result;
  };

  const left = parseHextets(halves[0]);
  const right = parseHextets(halves[1] ?? "");
  if (left === undefined || right === undefined) return undefined;
  const values =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
      : [...left];
  if (values.length !== 8) return undefined;

  return values.reduce((value, part) => (value << 16n) | BigInt(part), 0n);
}

function isLoopbackIPv6(value: bigint): boolean {
  return value === 1n;
}

interface IPv6Prefix {
  readonly prefix: bigint;
  readonly bits: number;
}

function ipv6Prefix(address: string, bits: number): IPv6Prefix {
  const value = parseIPv6(address);
  if (value === undefined) {
    throw new Error("invalid built-in IPv6 prefix");
  }
  return { prefix: value >> BigInt(128 - bits), bits };
}

function matchesIPv6Prefix(value: bigint, prefix: IPv6Prefix): boolean {
  return value >> BigInt(128 - prefix.bits) === prefix.prefix;
}

/*
 * This is deliberately a conservative copy of the current IANA IPv6
 * special-purpose and global-unicast policy. Translation and embedded-IPv4
 * space is rejected even where the registry marks the well-known translation
 * prefix globally reachable, so private IPv4 cannot be hidden behind an IPv6
 * spelling.
 */
const NON_GLOBAL_IPV6_PREFIXES: readonly IPv6Prefix[] = [
  ipv6Prefix("::", 96), // IPv4-compatible and other embedded IPv4 forms
  ipv6Prefix("::", 128),
  ipv6Prefix("::1", 128),
  ipv6Prefix("::ffff:0:0", 96),
  ipv6Prefix("64:ff9b::", 96),
  ipv6Prefix("64:ff9b:1::", 48),
  ipv6Prefix("100::", 64),
  ipv6Prefix("100:0:0:1::", 64),
  ipv6Prefix("2001:2::", 48),
  ipv6Prefix("2001:10::", 28), // deprecated, no current global status
  ipv6Prefix("2001:db8::", 32),
  ipv6Prefix("2002::", 16),
  ipv6Prefix("2d00::", 8),
  ipv6Prefix("3fff::", 20),
  ipv6Prefix("5f00::", 16),
  ipv6Prefix("fc00::", 7),
  ipv6Prefix("fe80::", 10),
  ipv6Prefix("ff00::", 8),
];

const ALLOCATED_GLOBAL_IPV6_PREFIXES: readonly IPv6Prefix[] = [
  ipv6Prefix("2001::", 23),
  ipv6Prefix("2001:200::", 23),
  ipv6Prefix("2001:400::", 23),
  ipv6Prefix("2001:600::", 23),
  ipv6Prefix("2001:800::", 22),
  ipv6Prefix("2001:c00::", 23),
  ipv6Prefix("2001:e00::", 23),
  ipv6Prefix("2001:1200::", 23),
  ipv6Prefix("2001:1400::", 22),
  ipv6Prefix("2001:1800::", 23),
  ipv6Prefix("2001:1a00::", 23),
  ipv6Prefix("2001:1c00::", 22),
  ipv6Prefix("2001:2000::", 19),
  ipv6Prefix("2001:4000::", 23),
  ipv6Prefix("2001:4200::", 23),
  ipv6Prefix("2001:4400::", 23),
  ipv6Prefix("2001:4600::", 23),
  ipv6Prefix("2001:4800::", 23),
  ipv6Prefix("2001:4a00::", 23),
  ipv6Prefix("2001:4c00::", 23),
  ipv6Prefix("2001:5000::", 20),
  ipv6Prefix("2001:8000::", 19),
  ipv6Prefix("2001:a000::", 20),
  ipv6Prefix("2001:b000::", 20),
  ipv6Prefix("2003::", 18),
  ipv6Prefix("2400::", 12),
  ipv6Prefix("2410::", 12),
  ipv6Prefix("2600::", 12),
  ipv6Prefix("2610::", 23),
  ipv6Prefix("2620::", 23),
  ipv6Prefix("2630::", 12),
  ipv6Prefix("2800::", 12),
  ipv6Prefix("2a00::", 12),
  ipv6Prefix("2a10::", 12),
  ipv6Prefix("2c00::", 12),
];

const NON_GLOBAL_2001_00_PREFIX = ipv6Prefix("2001::", 23);
const GLOBAL_2001_00_EXCEPTIONS: readonly IPv6Prefix[] = [
  ipv6Prefix("2001:1::1", 128),
  ipv6Prefix("2001:1::2", 128),
  ipv6Prefix("2001:1::3", 128),
  ipv6Prefix("2001:3::", 32),
  ipv6Prefix("2001:4:112::", 48),
  ipv6Prefix("2001:20::", 28),
  ipv6Prefix("2001:30::", 28),
];

function isNonPublicIPv6(value: bigint): boolean {
  if (matchesIPv6Prefix(value, NON_GLOBAL_2001_00_PREFIX)) {
    return !GLOBAL_2001_00_EXCEPTIONS.some((prefix) =>
      matchesIPv6Prefix(value, prefix),
    );
  }
  if (
    NON_GLOBAL_IPV6_PREFIXES.some((prefix) => matchesIPv6Prefix(value, prefix))
  ) {
    return true;
  }
  return !ALLOCATED_GLOBAL_IPV6_PREFIXES.some((prefix) =>
    matchesIPv6Prefix(value, prefix),
  );
}

function classifyAddress(address: string):
  | {
      address: string;
      family: 4 | 6;
      local: boolean;
      public: boolean;
    }
  | undefined {
  const family = isIP(address);
  if (family === 4) {
    const parts = parseIPv4(address);
    if (parts === undefined) return undefined;
    return {
      address,
      family: 4,
      local: isLoopbackIPv4(parts),
      public: !isNonPublicIPv4(parts),
    };
  }
  if (family === 6) {
    const value = parseIPv6(address);
    if (value === undefined) return undefined;
    const mapped = value >> 32n;
    const isMapped = mapped === 0xffffn;
    if (isMapped) {
      const ipv4Value = Number(value & 0xffffffffn);
      const parts = [
        (ipv4Value >>> 24) & 255,
        (ipv4Value >>> 16) & 255,
        (ipv4Value >>> 8) & 255,
        ipv4Value & 255,
      ];
      return {
        address,
        family: 6,
        local: isLoopbackIPv4(parts),
        public: !isNonPublicIPv4(parts) && !isNonPublicIPv6(value),
      };
    }
    return {
      address,
      family: 6,
      local: isLoopbackIPv6(value),
      public: !isNonPublicIPv6(value),
    };
  }
  return undefined;
}

function parsedUrl(rawUrl: string): URL {
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    return invalidEndpoint();
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return invalidEndpoint();
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    url.hostname.length === 0
  ) {
    return invalidEndpoint();
  }
  return url;
}

export async function approveCompatibleEndpoint(input: {
  rawUrl: string;
  allowLocalHttp: boolean;
  lookup?: Lookup;
}): Promise<ApprovedProviderEndpoint> {
  const url = parsedUrl(input.rawUrl);
  const hostname = normalizedHostname(url);
  const literal = classifyAddress(hostname);
  let classified: ReturnType<typeof classifyAddress>[];

  if (literal !== undefined) {
    classified = [literal];
  } else {
    let answers: Array<{ address: string; family: 4 | 6 }>;
    try {
      answers = (await (input.lookup ?? defaultLookup)(hostname, {
        all: true,
        verbatim: true,
      })) as unknown as Array<{ address: string; family: 4 | 6 }>;
    } catch {
      return notPublicEndpoint();
    }
    classified = answers.map((answer) => classifyAddress(answer.address));
  }

  if (
    classified.length === 0 ||
    classified.some((answer) => answer === undefined)
  ) {
    return notPublicEndpoint();
  }

  const addresses = classified as Array<
    NonNullable<ReturnType<typeof classifyAddress>>
  >;
  const local = addresses.every((answer) => answer.local);
  const isExplicitLocalHost =
    hostname === "localhost" || (literal !== undefined && local);

  if (local && !isExplicitLocalHost) {
    return notPublicEndpoint();
  }
  if (hostname === "localhost" && !local) {
    return notPublicEndpoint();
  }
  if (local && url.protocol !== "http:") {
    return notPublicEndpoint();
  }
  if (isExplicitLocalHost && !input.allowLocalHttp) {
    return localHttpNotConfirmed();
  }
  if (!local && addresses.some((answer) => !answer.public)) {
    return notPublicEndpoint();
  }
  if (url.protocol === "http:" && !local) {
    return invalidEndpoint("remote-http");
  }

  return {
    url,
    origin: url.origin,
    local,
    addresses: addresses.map(({ address, family }) => ({ address, family })),
  };
}

const QWEN_WORKSPACE_REGIONS = {
  "china-hongkong": "cn-hongkong",
  singapore: "ap-southeast-1",
  "japan-tokyo": "ap-northeast-1",
  "germany-frankfurt": "eu-central-1",
} as const;

function isDnsLabelSafe(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
}

export function buildQwenPaygEndpoint(input: {
  region: NonNullable<AidocConfig["qwenRegion"]>;
  workspaceId?: string;
}): URL {
  if (input.region === "china-beijing") {
    return new URL("https://dashscope.aliyuncs.com/compatible-mode/v1");
  }
  if (input.region === "us-virginia") {
    return new URL("https://dashscope-us.aliyuncs.com/compatible-mode/v1");
  }

  const regionHost = QWEN_WORKSPACE_REGIONS[input.region];
  if (regionHost === undefined) {
    throw new ProviderConfigurationError("PROVIDER_INVALID_ENDPOINT");
  }
  if (input.workspaceId === undefined || !isDnsLabelSafe(input.workspaceId)) {
    throw new ProviderConfigurationError("PROVIDER_INVALID_ENDPOINT");
  }
  return new URL(
    `https://${input.workspaceId}.${regionHost}.maas.aliyuncs.com/compatible-mode/v1`,
  );
}
