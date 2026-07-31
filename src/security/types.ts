export const TRUST_POLICIES = ["warn", "redact", "strict"] as const;
export type TrustPolicy = (typeof TRUST_POLICIES)[number];

export type SecretKind =
  | "openai_api_key"
  | "anthropic_api_key"
  | "github_token"
  | "private_key"
  | "credential_url"
  | "named_secret"
  | "sensitive_path";

export interface FindingSummary {
  kind: SecretKind;
  count: number;
}

export interface TrustTextResult {
  text: string;
  findings: FindingSummary[];
  action: "allowed" | "warned" | "redacted";
}

export class TrustViolationError extends Error {
  readonly code = "TRUST_SECRET_BLOCKED" as const;

  constructor(readonly findings: FindingSummary[]) {
    super(
      `Trust Gate blocked ${findings.reduce((sum, item) => sum + item.count, 0)} secret finding(s): ${findings.map((item) => item.kind).join(", ")}`,
    );
    this.name = "TrustViolationError";
  }
}
