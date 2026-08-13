import { randomBytes } from "node:crypto";
import {
  MCP_INVALID_PREPARATION,
  MCP_PREPARATION_SCHEMA,
  PreparationTokenCodec,
  type PreparationClaims,
} from "../../../src/mcp/preparation-token";

const secret = new Uint8Array(32).fill(7);

function claims(): PreparationClaims {
  return {
    schemaVersion: MCP_PREPARATION_SCHEMA,
    planDigest: "a".repeat(64),
    base: "HEAD~1",
    head: "HEAD",
    maxContextBytes: 12000,
    target: "docs/API.md",
    targetDigest: "b".repeat(64),
  };
}

function expectInvalid(action: () => unknown): void {
  try {
    action();
    throw new Error("expected invalid preparation");
  } catch (error: unknown) {
    expect(error).toMatchObject({ code: MCP_INVALID_PREPARATION });
    expect(error).not.toMatchObject({ token: expect.anything() });
    expect(String(error)).not.toContain("sentinel");
  }
}

describe("PreparationTokenCodec", () => {
  it("round-trips canonical claims and is deterministic", () => {
    const codec = new PreparationTokenCodec(secret);
    const token = codec.issue(claims());
    const reordered = {
      targetDigest: "b".repeat(64),
      target: "docs/API.md",
      maxContextBytes: 12000,
      head: "HEAD",
      base: "HEAD~1",
      planDigest: "a".repeat(64),
      schemaVersion: MCP_PREPARATION_SCHEMA,
    } as PreparationClaims;

    expect(token).toBe(codec.issue(reordered));
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    expect(token.length).toBeLessThanOrEqual(4096);
    expect(codec.verify(token)).toEqual(claims());
  });

  it.each([
    [
      "changed payload",
      (token: string) =>
        `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`,
    ],
    [
      "changed signature",
      (token: string) =>
        `${token.slice(0, -2)}${token.slice(-2) === "aa" ? "bb" : "aa"}`,
    ],
    ["wrong secret", (token: string) => token],
    ["malformed segments", () => "v1.only-two-segments"],
    ["invalid base64", () => "v1.%%%.$$$"],
    [
      "invalid JSON",
      () => `v1.${Buffer.from("not-json").toString("base64url")}.AA`,
    ],
  ])("rejects %s with the fixed preparation error", (label, mutate) => {
    const codec = new PreparationTokenCodec(secret);
    const token = codec.issue(claims());
    if (label === "wrong secret") {
      expectInvalid(() =>
        new PreparationTokenCodec(randomBytes(32)).verify(token),
      );
    } else {
      expectInvalid(() => codec.verify(mutate(token)));
    }
  });

  it("rejects duplicate and extra claim properties", () => {
    const codec = new PreparationTokenCodec(secret);
    const canonical = JSON.stringify(claims());
    const duplicate = canonical.replace(
      `"schemaVersion":"${MCP_PREPARATION_SCHEMA}"`,
      `"schemaVersion":"${MCP_PREPARATION_SCHEMA}","schemaVersion":"${MCP_PREPARATION_SCHEMA}"`,
    );
    const duplicateToken = `v1.${Buffer.from(duplicate).toString("base64url")}.AA`;
    const extra = { ...claims(), extra: "sentinel" };
    const extraToken = `v1.${Buffer.from(JSON.stringify(extra)).toString("base64url")}.AA`;

    expectInvalid(() => codec.verify(duplicateToken));
    expectInvalid(() => codec.verify(extraToken));
  });

  it.each([
    ["plan digest", { planDigest: "not-a-digest" }],
    ["target digest", { targetDigest: "not-a-digest" }],
    ["absolute target", { target: "/tmp/secret.md" }],
    ["parent target", { target: "../secret.md" }],
    ["non-markdown target", { target: "README.txt" }],
    ["too-small budget", { maxContextBytes: 1023 }],
    ["too-large budget", { maxContextBytes: 1048577 }],
  ])("rejects invalid %s claims", (_label, change) => {
    const codec = new PreparationTokenCodec(secret);
    expectInvalid(() =>
      codec.issue({ ...claims(), ...change } as PreparationClaims),
    );
  });

  it("rejects an overlong token before decoding unbounded input", () => {
    const codec = new PreparationTokenCodec(secret);
    expectInvalid(() => codec.verify(`v1.${"A".repeat(4090)}.AA`));
  });
});
