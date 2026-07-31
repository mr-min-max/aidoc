import {
  FindingSummary,
  SecretKind,
  TrustPolicy,
  TrustTextResult,
  TrustViolationError,
} from "./types";

interface SecretMatch {
  kind: SecretKind;
  start: number;
  end: number;
  value: string;
  priority: number;
}

const providerPatterns: ReadonlyArray<{
  kind: SecretKind;
  pattern: RegExp;
  priority: number;
}> = [
  {
    kind: "openai_api_key",
    pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g,
    priority: 30,
  },
  {
    kind: "anthropic_api_key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    priority: 30,
  },
  {
    kind: "github_token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
    priority: 30,
  },
];

const privateKeyPattern =
  /-----BEGIN ((?:[A-Z0-9][A-Z0-9 ]* )?PRIVATE KEY)-----[\s\S]*?-----END \1-----/g;
const credentialUrlPattern =
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^@\s/]+@[^\s/]+(?:\/[^\s]*)?/gi;
const namedSecretPattern =
  /(?<![A-Za-z0-9_$])["']?(?:apiKey|api_key|api-key|accessToken|access_token|access-token|authToken|auth_token|auth-token|clientSecret|client_secret|client-secret|password|passphrase|secret|token|privateKey|private_key|private-key)["']?(?![A-Za-z0-9_$])\s*(?:=|:)\s*(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)'|([^\s,;}\]\r\n]+))/gi;
const sensitiveBasenamePattern =
  /(?<![A-Za-z0-9._-])(?:\.env(?:\.(?!example(?=$|[\\/\s,;:)"'\]}`<>]))[A-Za-z0-9_.-]+)?|\.npmrc|\.pypirc|\.netrc|id_(?:rsa|dsa|ecdsa|ed25519))(?=$|[\\/\s,;:)"'\]}`<>])/g;
const awsCredentialsPattern =
  /(?<![A-Za-z0-9._-])\.aws[\\/]credentials(?=$|[\\/\s,;:)"'\]}`<>])/g;

export class RedactionSession {
  private readonly values = new Map<SecretKind, Map<string, number>>();

  placeholder(kind: SecretKind, value: string): string {
    const byValue = this.values.get(kind) ?? new Map<string, number>();
    this.values.set(kind, byValue);
    if (!byValue.has(value)) byValue.set(value, byValue.size + 1);
    return `<AIDOC_REDACTED:${kind.toUpperCase()}:${byValue.get(value)}>`;
  }
}

export function applySecretPolicy(
  text: string,
  policy: TrustPolicy,
  session: RedactionSession,
): TrustTextResult {
  const matches = selectMatches(collectMatches(text));
  const findings = summarizeMatches(matches);

  if (policy === "strict" && findings.length > 0) {
    throw new TrustViolationError(findings);
  }

  if (findings.length === 0) {
    return { text, findings, action: "allowed" };
  }

  if (policy === "warn") {
    return { text, findings, action: "warned" };
  }

  return {
    text: redactMatches(text, matches, session),
    findings,
    action: "redacted",
  };
}

export function sanitizeDiagnostic(text: string): string {
  return applySecretPolicy(text, "redact", new RedactionSession()).text;
}

function collectMatches(text: string): SecretMatch[] {
  return [
    ...collectPatternMatches(text, "private_key", privateKeyPattern, 40),
    ...collectProviderMatches(text),
    ...collectPatternMatches(text, "credential_url", credentialUrlPattern, 25),
    ...collectNamedSecretMatches(text),
    ...collectPatternMatches(
      text,
      "sensitive_path",
      sensitiveBasenamePattern,
      10,
    ),
    ...collectPatternMatches(text, "sensitive_path", awsCredentialsPattern, 10),
  ];
}

function collectProviderMatches(text: string): SecretMatch[] {
  return providerPatterns.flatMap(({ kind, pattern, priority }) =>
    collectPatternMatches(text, kind, pattern, priority).filter(
      ({ value }) =>
        !(kind === "openai_api_key" && value.startsWith("sk-ant-")),
    ),
  );
}

function collectPatternMatches(
  text: string,
  kind: SecretKind,
  pattern: RegExp,
  priority: number,
): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const matcher = freshGlobalPattern(pattern);

  for (let match = matcher.exec(text); match; match = matcher.exec(text)) {
    matches.push({
      kind,
      start: match.index,
      end: match.index + match[0].length,
      value: match[0],
      priority,
    });
  }

  return matches;
}

function collectNamedSecretMatches(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const matcher = freshGlobalPattern(namedSecretPattern);

  for (let match = matcher.exec(text); match; match = matcher.exec(text)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (!value) continue;

    const valueOffset = match[0].lastIndexOf(value);
    matches.push({
      kind: "named_secret",
      start: match.index + valueOffset,
      end: match.index + valueOffset + value.length,
      value,
      priority: 15,
    });
  }

  return matches;
}

function freshGlobalPattern(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function selectMatches(matches: SecretMatch[]): SecretMatch[] {
  const ordered = [...matches].sort(
    (left, right) =>
      left.start - right.start ||
      right.priority - left.priority ||
      right.end - right.start - (left.end - left.start),
  );
  const accepted: SecretMatch[] = [];

  for (const candidate of ordered) {
    if (
      accepted.some(
        (existing) =>
          candidate.start < existing.end && candidate.end > existing.start,
      )
    ) {
      continue;
    }
    accepted.push(candidate);
  }

  return accepted;
}

function summarizeMatches(matches: SecretMatch[]): FindingSummary[] {
  const summaries = new Map<SecretKind, FindingSummary>();

  for (const match of matches) {
    const existing = summaries.get(match.kind);
    if (existing) {
      existing.count += 1;
    } else {
      summaries.set(match.kind, { kind: match.kind, count: 1 });
    }
  }

  return [...summaries.values()];
}

function redactMatches(
  text: string,
  matches: SecretMatch[],
  session: RedactionSession,
): string {
  let cursor = 0;
  let redacted = "";

  for (const match of matches) {
    redacted += text.slice(cursor, match.start);
    redacted += session.placeholder(match.kind, match.value);
    cursor = match.end;
  }

  return redacted + text.slice(cursor);
}
