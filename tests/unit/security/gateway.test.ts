import {
  GatewayOptions,
  TrustEvent,
  TrustGateway,
} from "../../../src/security/gateway";
import { GenerateOptions, LLMProvider } from "../../../src/providers/types";
import * as scanner from "../../../src/security/scanner";

const fakeSecret = ["sk", "proj", "D".repeat(32)].join("-");

class RecordingProvider implements LLMProvider {
  readonly name = "recording";
  calls: Array<{ prompt: string; systemPrompt?: string }> = [];
  response = "# Safe";
  failure?: Error;

  async generate(
    prompt: string,
    options: GenerateOptions = {},
  ): Promise<string> {
    this.calls.push({ prompt, systemPrompt: options.systemPrompt });
    if (this.failure) throw this.failure;
    return this.response;
  }
}

class StreamingProvider extends RecordingProvider {
  completed = false;

  constructor(private readonly chunks: string[]) {
    super();
  }

  async generateStream(
    prompt: string,
    options: GenerateOptions,
    onToken: (token: string) => void,
  ): Promise<string> {
    this.calls.push({ prompt, systemPrompt: options.systemPrompt });
    this.chunks.forEach(onToken);
    this.completed = true;
    return this.chunks.join("");
  }
}

function expectValueFreeEvent(event: TrustEvent): void {
  expect(Object.keys(event).sort()).toEqual([
    "action",
    "findings",
    "operation",
    "origin",
    "policy",
    "stage",
  ]);
}

describe("TrustGateway", () => {
  it("redacts system and user messages before transport", async () => {
    const provider = new RecordingProvider();
    const gateway = new TrustGateway(provider, {
      policy: "redact",
      origin: "cli",
    });

    await gateway.generate({
      operation: "readme",
      systemPrompt: `system ${fakeSecret}`,
      prompt: `user ${fakeSecret}`,
    });

    expect(provider.calls).toHaveLength(1);
    expect(JSON.stringify(provider.calls)).not.toContain(fakeSecret);
  });

  it("makes zero provider calls when strict input is blocked", async () => {
    const provider = new RecordingProvider();
    const gateway = new TrustGateway(provider, {
      policy: "strict",
      origin: "action",
    });

    await expect(
      gateway.generate({
        operation: "api",
        systemPrompt: "safe",
        prompt: fakeSecret,
      }),
    ).rejects.toMatchObject({ code: "TRUST_SECRET_BLOCKED" });

    expect(provider.calls).toHaveLength(0);
  });

  it("redacts provider output before returning it", async () => {
    const provider = new RecordingProvider();
    provider.response = `# Generated\n${fakeSecret}`;
    const gateway = new TrustGateway(provider, {
      policy: "redact",
      origin: "mcp",
    });

    const output = await gateway.generate({
      operation: "readme",
      systemPrompt: "safe",
      prompt: "safe",
    });

    expect(output).not.toContain(fakeSecret);
  });

  it("blocks strict output after the provider has returned it", async () => {
    const provider = new RecordingProvider();
    provider.response = fakeSecret;
    const gateway = new TrustGateway(provider, {
      policy: "strict",
      origin: "mcp",
    });

    await expect(
      gateway.generate({
        operation: "readme",
        systemPrompt: "safe",
        prompt: "safe",
      }),
    ).rejects.toMatchObject({ code: "TRUST_SECRET_BLOCKED" });

    expect(provider.calls).toHaveLength(1);
  });

  it("snapshots strict options so event hooks cannot weaken streamed output", async () => {
    const provider = new StreamingProvider([
      fakeSecret.slice(0, 12),
      fakeSecret.slice(12, 28),
      fakeSecret.slice(28),
    ]);
    let hookUsedOptionsReceiver = false;
    const gatewayOptions: GatewayOptions = {
      policy: "strict",
      origin: "cli",
      onEvent: function (this: unknown, event) {
        hookUsedOptionsReceiver ||= this === gatewayOptions;
        if (event.stage === "input") gatewayOptions.policy = "warn";
      },
    };
    const gateway = new TrustGateway(provider, gatewayOptions);
    const approved: string[] = [];

    await expect(
      gateway.generateStream(
        {
          operation: "readme",
          systemPrompt: "safe",
          prompt: "safe",
        },
        {},
        (content) => approved.push(content),
      ),
    ).rejects.toMatchObject({ code: "TRUST_SECRET_BLOCKED" });

    expect(gatewayOptions.policy).toBe("warn");
    expect(hookUsedOptionsReceiver).toBe(false);
    expect(approved).toEqual([]);
  });

  it("preserves strict rejection when its event hook throws", async () => {
    const provider = new RecordingProvider();
    const gateway = new TrustGateway(provider, {
      policy: "strict",
      origin: "action",
      onEvent: (event) => {
        if (event.stage === "input") {
          throw new Error(`hook rejected ${fakeSecret}`);
        }
      },
    });

    let thrown: unknown;
    try {
      await gateway.generate({
        operation: "api",
        systemPrompt: "safe",
        prompt: fakeSecret,
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "TRUST_SECRET_BLOCKED" });
    expect(String(thrown)).not.toContain(fakeSecret);
    expect(provider.calls).toHaveLength(0);
  });

  it("approves a completed stream once after scanning chunks together", async () => {
    const provider = new StreamingProvider([
      "# Generated\n",
      fakeSecret.slice(0, 12),
      fakeSecret.slice(12, 28),
      fakeSecret.slice(28),
    ]);
    const gateway = new TrustGateway(provider, {
      policy: "redact",
      origin: "cli",
    });
    const approved: string[] = [];

    const output = await gateway.generateStream(
      {
        operation: "readme",
        systemPrompt: "safe",
        prompt: "safe",
      },
      { temperature: 0.3 },
      (content) => {
        expect(provider.completed).toBe(true);
        approved.push(content);
      },
    );

    expect(provider.calls).toHaveLength(1);
    expect(approved).toEqual([output]);
    expect(output).not.toContain(fakeSecret);
    expect(approved[0]).not.toContain(fakeSecret);
  });

  it("falls back to one approved callback when the provider cannot stream", async () => {
    const provider = new RecordingProvider();
    provider.response = `# Generated\n${fakeSecret}`;
    const gateway = new TrustGateway(provider, {
      policy: "redact",
      origin: "cli",
    });
    const approved: string[] = [];

    const output = await gateway.generateStream(
      {
        operation: "readme",
        systemPrompt: "safe",
        prompt: "safe",
      },
      { temperature: 0.3 },
      (content) => approved.push(content),
    );

    expect(provider.calls).toHaveLength(1);
    expect(approved).toEqual([output]);
    expect(output).not.toContain(fakeSecret);
  });

  it("emits value-free input and output metadata with aggregated findings", async () => {
    const provider = new RecordingProvider();
    provider.response = `# Generated\n${fakeSecret}`;
    const events: TrustEvent[] = [];
    const gateway = new TrustGateway(provider, {
      policy: "redact",
      origin: "cli",
      onEvent: (event) => events.push(event),
    });

    await gateway.generate({
      operation: "readme",
      systemPrompt: `system ${fakeSecret}`,
      prompt: `user ${fakeSecret}`,
    });

    expect(events).toEqual([
      {
        stage: "input",
        operation: "readme",
        origin: "cli",
        policy: "redact",
        action: "redacted",
        findings: [{ kind: "openai_api_key", count: 2 }],
      },
      {
        stage: "output",
        operation: "readme",
        origin: "cli",
        policy: "redact",
        action: "redacted",
        findings: [{ kind: "openai_api_key", count: 1 }],
      },
    ]);
    events.forEach(expectValueFreeEvent);
    expect(JSON.stringify(events)).not.toContain(fakeSecret);
  });

  it("sanitizes provider errors before rethrowing and emitting metadata", async () => {
    const provider = new RecordingProvider();
    provider.failure = new Error(`provider rejected ${fakeSecret}`);
    const events: TrustEvent[] = [];
    const gateway = new TrustGateway(provider, {
      policy: "redact",
      origin: "cli",
      onEvent: (event) => events.push(event),
    });

    let thrown: unknown;
    try {
      await gateway.generate({
        operation: "readme",
        systemPrompt: "safe",
        prompt: "safe",
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain(fakeSecret);
    expect((thrown as Error).message).toContain(
      "<AIDOC_REDACTED:OPENAI_API_KEY:1>",
    );
    expect(events).toContainEqual({
      stage: "error",
      operation: "readme",
      origin: "cli",
      policy: "redact",
      action: "blocked",
      findings: [{ kind: "openai_api_key", count: 1 }],
    });
    events.forEach(expectValueFreeEvent);
    expect(JSON.stringify(events)).not.toContain(fakeSecret);
  });

  it("preserves a sanitized provider error when its event hook throws", async () => {
    const provider = new RecordingProvider();
    provider.failure = new Error(`provider rejected ${fakeSecret}`);
    const gateway = new TrustGateway(provider, {
      policy: "redact",
      origin: "cli",
      onEvent: (event) => {
        if (event.stage === "error") {
          throw new Error(`hook leaked ${fakeSecret}`);
        }
      },
    });

    let thrown: unknown;
    try {
      await gateway.generate({
        operation: "readme",
        systemPrompt: "safe",
        prompt: "safe",
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(
      "<AIDOC_REDACTED:OPENAI_API_KEY:1>",
    );
    expect((thrown as Error).message).not.toContain(fakeSecret);
    expect(provider.calls).toHaveLength(1);
  });

  it("rejects a non-string custom-provider result before it can be serialized", async () => {
    let serializationCalls = 0;
    const unsafeOutput = {
      toString: () => "# harmless",
      toJSON: () => {
        serializationCalls += 1;
        return fakeSecret;
      },
    };
    const provider: LLMProvider = {
      name: "object-result-provider",
      generate: async () => unsafeOutput as unknown as string,
    };
    const gateway = new TrustGateway(provider, {
      policy: "redact",
      origin: "mcp",
    });

    await expect(
      gateway.generate({
        operation: "readme",
        systemPrompt: "safe",
        prompt: "safe",
      }),
    ).rejects.toMatchObject({ code: "TRUST_INVALID_PROVIDER_OUTPUT" });

    expect(serializationCalls).toBe(0);
  });

  it("rejects a non-string streamed custom-provider result before the callback", async () => {
    let serializationCalls = 0;
    const unsafeOutput = {
      toString: () => "# harmless",
      toJSON: () => {
        serializationCalls += 1;
        return fakeSecret;
      },
    };
    const provider: LLMProvider = {
      name: "object-stream-provider",
      generate: async () => "# unused",
      generateStream: async () => unsafeOutput as unknown as string,
    };
    const gateway = new TrustGateway(provider, {
      policy: "redact",
      origin: "mcp",
    });
    const approved: string[] = [];

    await expect(
      gateway.generateStream(
        {
          operation: "readme",
          systemPrompt: "safe",
          prompt: "safe",
        },
        {},
        (content) => approved.push(content),
      ),
    ).rejects.toMatchObject({ code: "TRUST_INVALID_PROVIDER_OUTPUT" });

    expect(approved).toEqual([]);
    expect(serializationCalls).toBe(0);
  });

  it("uses a fixed diagnostic when a provider message getter throws", async () => {
    const provider = new RecordingProvider();
    const hostileSecret = ["sk", "proj", "H".repeat(32)].join("-");
    const hostileError = new Error("unused");
    Object.defineProperty(hostileError, "message", {
      get: () => {
        throw new Error(hostileSecret);
      },
    });
    provider.failure = hostileError;
    const gateway = new TrustGateway(provider, {
      policy: "redact",
      origin: "cli",
    });

    await expect(
      gateway.generate({
        operation: "readme",
        systemPrompt: "safe",
        prompt: "safe",
      }),
    ).rejects.toMatchObject({ message: "Unknown error." });
  });

  it("uses a fixed diagnostic when a provider proxy rejects prototype inspection", async () => {
    const provider = new RecordingProvider();
    const hostileSecret = ["sk", "proj", "P".repeat(32)].join("-");
    provider.failure = new Proxy(new Error("safe provider failure"), {
      getPrototypeOf: () => {
        throw new Error(hostileSecret);
      },
    }) as Error;
    const gateway = new TrustGateway(provider, {
      policy: "redact",
      origin: "cli",
    });

    await expect(
      gateway.generate({
        operation: "readme",
        systemPrompt: "safe",
        prompt: "safe",
      }),
    ).rejects.toMatchObject({ message: "Unknown error." });
  });

  it("uses a fixed diagnostic for a non-string provider message", async () => {
    const provider = new RecordingProvider();
    const hostileError = new Error("unused");
    Object.defineProperty(hostileError, "message", {
      value: { secret: ["sk", "proj", "N".repeat(32)].join("-") },
    });
    provider.failure = hostileError;
    const gateway = new TrustGateway(provider, {
      policy: "redact",
      origin: "cli",
    });

    await expect(
      gateway.generate({
        operation: "readme",
        systemPrompt: "safe",
        prompt: "safe",
      }),
    ).rejects.toMatchObject({ message: "Unknown error." });
  });

  it("uses a fixed diagnostic when diagnostic sanitization fails", async () => {
    const provider = new RecordingProvider();
    const hostileSecret = ["sk", "proj", "Z".repeat(32)].join("-");
    provider.failure = new Error("safe provider failure");
    const sanitize = jest
      .spyOn(scanner, "sanitizeDiagnostic")
      .mockImplementation(() => {
        throw new Error(hostileSecret);
      });
    const gateway = new TrustGateway(provider, {
      policy: "redact",
      origin: "cli",
    });

    try {
      await expect(
        gateway.generate({
          operation: "readme",
          systemPrompt: "safe",
          prompt: "safe",
        }),
      ).rejects.toMatchObject({ message: "Unknown error." });
    } finally {
      sanitize.mockRestore();
    }
  });
});
