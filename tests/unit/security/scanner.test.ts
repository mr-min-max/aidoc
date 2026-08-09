import {
  RedactionSession,
  applySecretPolicy,
  sanitizeDiagnostic,
} from "../../../src/security/scanner";
import { TrustViolationError } from "../../../src/security/types";

const fakeOpenAiKey = ["sk", "proj", "A".repeat(32)].join("-");
const fakeAnthropicKey = ["sk", "ant", "B".repeat(32)].join("-");
const fakeGithubToken = `ghp_${"C".repeat(36)}`;

describe("applySecretPolicy", () => {
  it("redacts provider tokens with stable typed placeholders", () => {
    const session = new RedactionSession();
    const result = applySecretPolicy(
      `${fakeOpenAiKey}\nagain=${fakeOpenAiKey}\n${fakeAnthropicKey}`,
      "redact",
      session,
    );

    expect(result.text).toBe(
      "<AIDOC_REDACTED:OPENAI_API_KEY:1>\n" +
        "again=<AIDOC_REDACTED:OPENAI_API_KEY:1>\n" +
        "<AIDOC_REDACTED:ANTHROPIC_API_KEY:1>",
    );
    expect(result.findings).toEqual([
      { kind: "openai_api_key", count: 2 },
      { kind: "anthropic_api_key", count: 1 },
    ]);
    expect(JSON.stringify(result)).not.toContain(fakeOpenAiKey);
  });

  it("uses fresh provider matchers for each scan", () => {
    const first = applySecretPolicy(
      fakeOpenAiKey,
      "redact",
      new RedactionSession(),
    );
    const second = applySecretPolicy(
      fakeOpenAiKey,
      "redact",
      new RedactionSession(),
    );

    expect(first.findings).toEqual([{ kind: "openai_api_key", count: 1 }]);
    expect(second.findings).toEqual([{ kind: "openai_api_key", count: 1 }]);
  });

  it("blocks strict content without returning the value", () => {
    const session = new RedactionSession();
    let thrown: unknown;
    try {
      applySecretPolicy(fakeGithubToken, "strict", session);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TrustViolationError);
    expect((thrown as TrustViolationError).code).toBe("TRUST_SECRET_BLOCKED");
    expect(String(thrown)).not.toContain(fakeGithubToken);
  });

  it("warns without changing the original text", () => {
    const session = new RedactionSession();
    const result = applySecretPolicy(fakeOpenAiKey, "warn", session);
    expect(result.text).toBe(fakeOpenAiKey);
    expect(result.action).toBe("warned");
  });

  it("redacts only a serialized named secret value", () => {
    const fakeSerializedSecret = ["fake", "serialized", "secret"].join("-");
    const input = `{"clientSecret":"${fakeSerializedSecret}","visible":"keep"}`;
    const result = applySecretPolicy(input, "redact", new RedactionSession());

    expect(result.findings).toEqual([{ kind: "named_secret", count: 1 }]);
    expect(result.action).toBe("redacted");
    expect(result.text).toBe(
      '{"clientSecret":"<AIDOC_REDACTED:NAMED_SECRET:1>","visible":"keep"}',
    );
    expect(JSON.stringify(result)).not.toContain(fakeSerializedSecret);
  });

  it("redacts an escaped quote inside a serialized named secret", () => {
    const fakeEscapedSecret = ["fake", "escaped", "secret"].join("-");
    const input = `{"clientSecret":"prefix\\"${fakeEscapedSecret}","visible":"keep"}`;
    const result = applySecretPolicy(input, "redact", new RedactionSession());

    expect(JSON.stringify(result).includes(fakeEscapedSecret)).toBe(false);
    expect(result.text).toBe(
      '{"clientSecret":"<AIDOC_REDACTED:NAMED_SECRET:1>","visible":"keep"}',
    );
  });

  it("prefers provider findings over overlapping named secret values", () => {
    const result = applySecretPolicy(
      `clientSecret=${fakeOpenAiKey}`,
      "redact",
      new RedactionSession(),
    );

    expect(result).toEqual({
      text: "clientSecret=<AIDOC_REDACTED:OPENAI_API_KEY:1>",
      findings: [{ kind: "openai_api_key", count: 1 }],
      action: "redacted",
    });
  });

  it("orders summaries by first accepted kind occurrence", () => {
    const fakeNamedSecret = ["fake", "named", "secret"].join("-");
    const result = applySecretPolicy(
      `clientSecret=${fakeNamedSecret}\n${fakeOpenAiKey}`,
      "redact",
      new RedactionSession(),
    );

    expect(result.findings).toEqual([
      { kind: "named_secret", count: 1 },
      { kind: "openai_api_key", count: 1 },
    ]);
  });

  it("detects private keys, credential URLs, named secrets, and sensitive paths", () => {
    const privateKey = [
      "-----BEGIN PRIVATE KEY-----",
      "ZmFrZS10ZXN0LWtleQ==",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const input = [
      privateKey,
      "https://build-user:fake-password@example.invalid/repo",
      "clientSecret=fake-client-secret-value",
      "changed: .env.production",
    ].join("\n");
    const result = applySecretPolicy(input, "redact", new RedactionSession());

    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "private_key",
      "credential_url",
      "named_secret",
      "sensitive_path",
    ]);
    expect(result.text).not.toContain("fake-password");
    expect(result.text).not.toContain("fake-client-secret-value");
  });

  it("does not match PEM blocks whose labels differ", () => {
    const mismatchedPem = [
      "-----BEGIN PRIVATE KEY-----",
      "ZmFrZS10ZXN0LWtleQ==",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const result = applySecretPolicy(
      mismatchedPem,
      "redact",
      new RedactionSession(),
    );

    expect(result).toEqual({
      text: mismatchedPem,
      findings: [],
      action: "allowed",
    });
  });

  it("prefers a higher-priority longer PEM match over a named key assignment", () => {
    const privateKey = [
      "-----BEGIN PRIVATE KEY-----",
      "ZmFrZS10ZXN0LWtleQ==",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const result = applySecretPolicy(
      `privateKey=${privateKey}`,
      "redact",
      new RedactionSession(),
    );

    expect(result).toEqual({
      text: "privateKey=<AIDOC_REDACTED:PRIVATE_KEY:1>",
      findings: [{ kind: "private_key", count: 1 }],
      action: "redacted",
    });
  });

  it("does not treat ordinary identifiers and documentation examples as secrets", () => {
    const input = [
      "tokenCount = 42",
      "passwordPolicy = strict",
      ".env.example",
      "https://example.invalid/docs",
      "const apiKeyName = 'OPENAI_API_KEY'",
    ].join("\n");
    const result = applySecretPolicy(input, "redact", new RedactionSession());
    expect(result).toEqual({ text: input, findings: [], action: "allowed" });
  });

  it("excludes only the exact .env.example documentation basename", () => {
    const input = [".env.example", ".env.example.local"].join("\n");
    const result = applySecretPolicy(input, "redact", new RedactionSession());

    expect(result.findings).toEqual([{ kind: "sensitive_path", count: 1 }]);
    expect(result.text).toBe(".env.example\n<AIDOC_REDACTED:SENSITIVE_PATH:1>");
  });

  it("sanitizes diagnostics regardless of the configured request policy", () => {
    const diagnostic = `provider rejected ${fakeOpenAiKey}`;
    const safe = sanitizeDiagnostic(diagnostic);
    expect(safe).toContain("<AIDOC_REDACTED:OPENAI_API_KEY:1>");
    expect(safe).not.toContain(fakeOpenAiKey);
  });

  it("does not re-redact an opaque Trust Gate placeholder", () => {
    const placeholder = ["<AIDOC_REDACTED:", "PRIVATE_KEY", ":1>"].join("");

    expect(
      applySecretPolicy(placeholder, "redact", new RedactionSession()),
    ).toEqual({ text: placeholder, findings: [], action: "allowed" });
  });

  it("does not re-redact an opaque placeholder used as a named field value", () => {
    const session = new RedactionSession();
    const initial = applySecretPolicy(
      `JWT_SECRET=${["opaque", "jwt", "value"].join("-")}`,
      "redact",
      session,
    );

    expect(applySecretPolicy(initial.text, "redact", session)).toEqual({
      text: initial.text,
      findings: [],
      action: "allowed",
    });
  });

  it("redacts canonical prefixed environment and serialized secret fields", () => {
    const jwtValue = ["opaque", "jwt", "value"].join("-");
    const githubValue = ["opaque", "github", "value"].join("-");
    const openAiValue = ["opaque", "openai", "value"].join("-");
    const input = [
      `JWT_SECRET=${jwtValue}`,
      `GITHUB_TOKEN: ${githubValue}`,
      `{"OPENAI_API_KEY":"${openAiValue}"}`,
    ].join("\n");

    const result = applySecretPolicy(input, "redact", new RedactionSession());

    expect(result.findings).toEqual([{ kind: "named_secret", count: 3 }]);
    expect(result.text).not.toContain(jwtValue);
    expect(result.text).not.toContain(githubValue);
    expect(result.text).not.toContain(openAiValue);
  });

  it("does not treat canonical field prefixes as a secret field match", () => {
    const input = ["TOKEN_COUNT=42", "JWT_SECRET_NAME=metadata"].join("\n");

    expect(applySecretPolicy(input, "redact", new RedactionSession())).toEqual({
      text: input,
      findings: [],
      action: "allowed",
    });
  });
});
