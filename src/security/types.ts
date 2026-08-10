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

/**
 * Signals that strict policy blocked text containing detected secrets.
 *
 * Its findings expose categories and counts only, never the matched values.
 */
export class TrustViolationError extends Error {
  readonly code = "TRUST_SECRET_BLOCKED" as const;

  constructor(readonly findings: FindingSummary[]) {
    super(
      `Trust Gate blocked ${findings.reduce((sum, item) => sum + item.count, 0)} secret finding(s): ${findings.map((item) => item.kind).join(", ")}`,
    );
    this.name = "TrustViolationError";
  }
}

/** Signals that an untyped JavaScript provider returned a value that cannot cross the Trust Gate. */
export class TrustInvalidProviderOutputError extends Error {
  readonly code = "TRUST_INVALID_PROVIDER_OUTPUT" as const;

  constructor() {
    super("Trust Gate rejected a non-string provider output.");
    this.name = "TrustInvalidProviderOutputError";
  }
}
