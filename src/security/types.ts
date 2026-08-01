/** Lists the supported ways the Trust Gate handles detected secret material. */
export const TRUST_POLICIES = ["warn", "redact", "strict"] as const;

/** Selects whether the Trust Gate reports, redacts, or blocks detected secrets. */
export type TrustPolicy = (typeof TRUST_POLICIES)[number];

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
