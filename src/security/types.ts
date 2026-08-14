/** Lists the supported ways the Trust Gate handles detected secret material. */
export const TRUST_POLICIES = ["warn", "redact", "strict"] as const;

/** Selects whether the Trust Gate reports, redacts, or blocks detected secrets. */
export type TrustPolicy = (typeof TRUST_POLICIES)[number];

export const REPOSITORY_WRITE_ERROR_CODES = [
  "TRUST_REPOSITORY_REQUIRED",
  "TRUST_INVALID_PATH",
  "TRUST_PATH_OUTSIDE_ROOT",
  "TRUST_UNSAFE_SYMLINK",
  "TRUST_INVALID_TARGET_TYPE",
  "TRUST_RACE_DETECTED",
  "TRUST_INSPECTION_FAILED",
  "TRUST_ATOMIC_WRITE_FAILED",
] as const;

export const ATOMIC_WRITE_STAGES = [
  "directory-create",
  "temp-create",
  "temp-write",
  "temp-sync",
  "permission",
  "replace",
  "cleanup",
] as const;

export type RepositoryWriteErrorCode =
  (typeof REPOSITORY_WRITE_ERROR_CODES)[number];
export type AtomicWriteStage = (typeof ATOMIC_WRITE_STAGES)[number];

const REPOSITORY_WRITE_MESSAGES = {
  TRUST_REPOSITORY_REQUIRED: "A Git worktree is required for file writes.",
  TRUST_INVALID_PATH: "The output path is invalid.",
  TRUST_PATH_OUTSIDE_ROOT:
    "The output path is outside the current Git worktree.",
  TRUST_UNSAFE_SYMLINK: "The output path contains an unsafe symbolic link.",
  TRUST_INVALID_TARGET_TYPE: "The output target type is not supported.",
  TRUST_RACE_DETECTED: "The output path changed during generation.",
  TRUST_INSPECTION_FAILED:
    "The repository output path could not be safely inspected.",
} as const satisfies Record<
  Exclude<RepositoryWriteErrorCode, "TRUST_ATOMIC_WRITE_FAILED">,
  string
>;

const INVALID_REPOSITORY_WRITE_ERROR_CONFIGURATION =
  "Invalid repository write error configuration.";

/** A stable, value-free error raised while preparing a repository file write. */
export class RepositoryWriteError extends Error {
  constructor(
    readonly code: RepositoryWriteErrorCode,
    readonly stage?: AtomicWriteStage,
  ) {
    super(repositoryWriteMessage(code, stage));
    this.name = "RepositoryWriteError";
  }
}

function repositoryWriteMessage(
  code: RepositoryWriteErrorCode,
  stage: AtomicWriteStage | undefined,
): string {
  if (code === "TRUST_ATOMIC_WRITE_FAILED") {
    if (stage === undefined || !ATOMIC_WRITE_STAGES.includes(stage)) {
      throw new TypeError(INVALID_REPOSITORY_WRITE_ERROR_CONFIGURATION);
    }
    return `Atomic file replacement failed (${stage}).`;
  }

  if (stage !== undefined) {
    throw new TypeError(INVALID_REPOSITORY_WRITE_ERROR_CONFIGURATION);
  }

  return REPOSITORY_WRITE_MESSAGES[code];
}

/** Classifies the sensitive material detected without exposing its raw value. */
export type SecretKind =
  | "openai_api_key"
  | "anthropic_api_key"
  | "github_token"
  | "private_key"
  | "credential_url"
  | "named_secret"
  | "sensitive_path";

/** Aggregates secret detections by kind; matched secret text is never included. */
export interface FindingSummary {
  kind: SecretKind;
  count: number;
}

/** Describes text after the configured Trust Gate policy has been applied. */
export interface TrustTextResult {
  text: string;
  findings: FindingSummary[];
  action: "allowed" | "warned" | "redacted";
}

const TRUST_VIOLATION_CODE = "TRUST_SECRET_BLOCKED" as const;
const TRUST_INVALID_PROVIDER_OUTPUT_CODE =
  "TRUST_INVALID_PROVIDER_OUTPUT" as const;
const TRUST_INVALID_PROVIDER_OUTPUT_MESSAGE =
  "Trust Gate rejected a non-string provider output.";
const TRUST_ERROR_CONFIGURATION = "Invalid Trust Gate error configuration.";
const TRUST_FINDING_KINDS = new Set<SecretKind>([
  "openai_api_key",
  "anthropic_api_key",
  "github_token",
  "private_key",
  "credential_url",
  "named_secret",
  "sensitive_path",
]);
const TRUST_VIOLATION_PAYLOADS = new WeakMap<
  object,
  { readonly code: typeof TRUST_VIOLATION_CODE; readonly message: string }
>();
const TRUST_INVALID_OUTPUT_PAYLOADS = new WeakMap<
  object,
  {
    readonly code: typeof TRUST_INVALID_PROVIDER_OUTPUT_CODE;
    readonly message: typeof TRUST_INVALID_PROVIDER_OUTPUT_MESSAGE;
  }
>();

function findTrustErrorPropertyDescriptor(
  object: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  const visited = new Set<object>();
  let current: object | null = object;
  while (current !== null) {
    if (visited.has(current)) throw new Error(TRUST_ERROR_CONFIGURATION);
    visited.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) return descriptor;
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

function readAuthenticTrustPayload(
  error: unknown,
  payloads: WeakMap<
    object,
    { readonly code: string; readonly message: string }
  >,
): { readonly code: string; readonly message: string } | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const payload = payloads.get(error);
  if (payload === undefined) return undefined;
  try {
    const codeDescriptor = Object.getOwnPropertyDescriptor(error, "code");
    const messageDescriptor = Object.getOwnPropertyDescriptor(error, "message");
    if (
      codeDescriptor === undefined ||
      !Object.hasOwn(codeDescriptor, "value") ||
      messageDescriptor === undefined ||
      !Object.hasOwn(messageDescriptor, "value") ||
      codeDescriptor.value !== payload.code ||
      messageDescriptor.value !== payload.message
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return { ...payload };
}

function isTrustErrorCandidate(
  error: unknown,
  codes: ReadonlySet<string>,
  messages: ReadonlySet<string>,
  payloads: WeakMap<object, unknown>,
): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (payloads.has(error)) return true;
  try {
    const codeDescriptor = findTrustErrorPropertyDescriptor(error, "code");
    const messageDescriptor = findTrustErrorPropertyDescriptor(
      error,
      "message",
    );
    if (
      (codeDescriptor !== undefined &&
        !Object.hasOwn(codeDescriptor, "value")) ||
      (messageDescriptor !== undefined &&
        !Object.hasOwn(messageDescriptor, "value"))
    ) {
      return true;
    }
    const code =
      codeDescriptor !== undefined && Object.hasOwn(codeDescriptor, "value")
        ? codeDescriptor.value
        : undefined;
    const message =
      messageDescriptor !== undefined &&
      Object.hasOwn(messageDescriptor, "value")
        ? messageDescriptor.value
        : undefined;
    return (
      (typeof code === "string" && codes.has(code)) ||
      (typeof message === "string" && messages.has(message))
    );
  } catch {
    return true;
  }
}

function snapshotTrustFindings(
  findings: FindingSummary[],
): readonly FindingSummary[] {
  if (!Array.isArray(findings)) {
    throw new TypeError(TRUST_ERROR_CONFIGURATION);
  }

  const snapshot: FindingSummary[] = [];
  for (const finding of findings) {
    if (typeof finding !== "object" || finding === null) {
      throw new TypeError(TRUST_ERROR_CONFIGURATION);
    }
    const kindDescriptor = Object.getOwnPropertyDescriptor(finding, "kind");
    const countDescriptor = Object.getOwnPropertyDescriptor(finding, "count");
    if (
      kindDescriptor === undefined ||
      !Object.hasOwn(kindDescriptor, "value") ||
      typeof kindDescriptor.value !== "string" ||
      !TRUST_FINDING_KINDS.has(kindDescriptor.value as SecretKind) ||
      countDescriptor === undefined ||
      !Object.hasOwn(countDescriptor, "value") ||
      typeof countDescriptor.value !== "number" ||
      !Number.isSafeInteger(countDescriptor.value) ||
      countDescriptor.value < 0
    ) {
      throw new TypeError(TRUST_ERROR_CONFIGURATION);
    }
    snapshot.push(
      Object.freeze({
        kind: kindDescriptor.value as SecretKind,
        count: countDescriptor.value,
      }),
    );
  }
  return Object.freeze(snapshot);
}

function trustViolationMessage(findings: readonly FindingSummary[]): string {
  return `Trust Gate blocked ${findings.reduce((sum, item) => sum + item.count, 0)} secret finding(s): ${findings.map((item) => item.kind).join(", ")}`;
}

/**
 * Signals that strict policy blocked text containing detected secrets.
 *
 * Its findings expose categories and counts only, never the matched values.
 */
export class TrustViolationError extends Error {
  declare readonly code: typeof TRUST_VIOLATION_CODE;
  declare readonly findings: FindingSummary[];

  constructor(findings: FindingSummary[]) {
    const snapshot = snapshotTrustFindings(findings);
    super(trustViolationMessage(snapshot));
    Object.defineProperty(this, "name", {
      configurable: true,
      value: "TrustViolationError",
      writable: true,
    });
    Object.defineProperty(this, "code", {
      configurable: true,
      enumerable: true,
      value: TRUST_VIOLATION_CODE,
      writable: true,
    });
    Object.defineProperty(this, "message", {
      configurable: true,
      enumerable: true,
      value: trustViolationMessage(snapshot),
      writable: true,
    });
    Object.defineProperty(this, "findings", {
      configurable: true,
      enumerable: true,
      value: snapshot,
      writable: true,
    });
    TRUST_VIOLATION_PAYLOADS.set(
      this,
      Object.freeze({
        code: TRUST_VIOLATION_CODE,
        message: trustViolationMessage(snapshot),
      }),
    );
  }

  static read(
    error: unknown,
  ): { readonly code: string; readonly message: string } | undefined {
    return readAuthenticTrustPayload(error, TRUST_VIOLATION_PAYLOADS);
  }

  static isCandidate(error: unknown): boolean {
    return isTrustErrorCandidate(
      error,
      new Set([TRUST_VIOLATION_CODE]),
      new Set<string>(),
      TRUST_VIOLATION_PAYLOADS,
    );
  }
}

/** Signals that an untyped JavaScript provider returned a value that cannot cross the Trust Gate. */
export class TrustInvalidProviderOutputError extends Error {
  declare readonly code: typeof TRUST_INVALID_PROVIDER_OUTPUT_CODE;

  constructor() {
    if (arguments.length !== 0) {
      throw new TypeError(TRUST_ERROR_CONFIGURATION);
    }
    super(TRUST_INVALID_PROVIDER_OUTPUT_MESSAGE);
    Object.defineProperty(this, "name", {
      configurable: true,
      value: "TrustInvalidProviderOutputError",
      writable: true,
    });
    Object.defineProperty(this, "code", {
      configurable: true,
      enumerable: true,
      value: TRUST_INVALID_PROVIDER_OUTPUT_CODE,
      writable: true,
    });
    Object.defineProperty(this, "message", {
      configurable: true,
      enumerable: true,
      value: TRUST_INVALID_PROVIDER_OUTPUT_MESSAGE,
      writable: true,
    });
    TRUST_INVALID_OUTPUT_PAYLOADS.set(
      this,
      Object.freeze({
        code: TRUST_INVALID_PROVIDER_OUTPUT_CODE,
        message: TRUST_INVALID_PROVIDER_OUTPUT_MESSAGE,
      }),
    );
  }

  static read(
    error: unknown,
  ): { readonly code: string; readonly message: string } | undefined {
    return readAuthenticTrustPayload(error, TRUST_INVALID_OUTPUT_PAYLOADS);
  }

  static isCandidate(error: unknown): boolean {
    return isTrustErrorCandidate(
      error,
      new Set([TRUST_INVALID_PROVIDER_OUTPUT_CODE]),
      new Set([TRUST_INVALID_PROVIDER_OUTPUT_MESSAGE]),
      TRUST_INVALID_OUTPUT_PAYLOADS,
    );
  }
}
