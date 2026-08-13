import { EventEmitter } from "node:events";
import type { ApprovedProviderEndpoint } from "../../../src/providers/endpoints";
import {
  OpenAICompatibleProvider,
  MAX_PROVIDER_BODY_BYTES,
} from "../../../src/providers/compatible";

class FakeResponse extends EventEmitter {
  constructor(
    readonly statusCode: number,
    readonly bodyChunks: readonly (string | Buffer)[],
    readonly headers: Record<string, string> = {},
    readonly beforeEnd?: () => void,
  ) {
    super();
  }

  start(): void {
    for (const chunk of this.bodyChunks) this.emit("data", chunk);
    this.beforeEnd?.();
    this.emit("end");
  }

  setEncoding(): void {
    // Node IncomingMessage compatibility for the transport test double.
  }

  resume(): void {
    this.start();
  }

  destroy(): void {
    // Node IncomingMessage compatibility for bounded-body aborts.
  }
}

type FakeRequest = EventEmitter & {
  write: jest.Mock;
  end: jest.Mock;
  destroy: jest.Mock;
  setTimeout: jest.Mock;
};

function requestDouble(responses: readonly FakeResponse[]): {
  requestImpl: jest.Mock;
  requests: FakeRequest[];
  options: Record<string, unknown>[];
} {
  const requests: FakeRequest[] = [];
  const options: Record<string, unknown>[] = [];
  let index = 0;
  const requestImpl = jest.fn(
    (
      requestOptions: Record<string, unknown>,
      callback: (response: FakeResponse) => void,
    ) => {
      options.push(requestOptions);
      const request = Object.assign(new EventEmitter(), {
        write: jest.fn(),
        end: jest.fn(() => {
          const response = responses[Math.min(index++, responses.length - 1)];
          callback(response);
          (request as EventEmitter).emit("response", response);
          response.start();
        }),
        destroy: jest.fn(),
        setTimeout: jest.fn(),
      }) as FakeRequest;
      requests.push(request);
      return request;
    },
  );
  return { requestImpl, requests, options };
}

function endpoint(
  rawUrl = "https://api.example.test/v1",
  address = "93.184.216.34",
): ApprovedProviderEndpoint {
  const url = new URL(rawUrl);
  return {
    url,
    origin: url.origin,
    local: url.protocol === "http:",
    addresses: [{ address, family: 4 }],
  };
}

function provider(
  requestImpl: jest.Mock,
  lookup = jest
    .fn()
    .mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
  extra: Partial<
    ConstructorParameters<typeof OpenAICompatibleProvider>[0]
  > = {},
): { provider: OpenAICompatibleProvider; lookup: jest.Mock } {
  return {
    provider: new OpenAICompatibleProvider({
      name: "openai-compatible",
      apiKey: "fake-compatible-key",
      model: "custom-model",
      endpoint: endpoint(),
      allowLocalHttp: false,
      lookup,
      requestImpl,
      ...extra,
    }),
    lookup,
  };
}

describe("OpenAI-compatible transport protocol and origin binding", () => {
  it("posts the exact Chat Completions shape and pins the approved address", async () => {
    const response = new FakeResponse(200, [
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
    ]);
    const double = requestDouble([response]);
    const { provider: transport } = provider(double.requestImpl);

    await expect(
      transport.generate("prompt-value", {
        systemPrompt: "system-value",
        maxTokens: 2048,
        temperature: 0.2,
        responseFormat: "json",
      }),
    ).resolves.toBe("ok");

    expect(double.requestImpl).toHaveBeenCalledTimes(1);
    const requestOptions = double.options[0];
    expect(requestOptions.method).toBe("POST");
    expect(requestOptions.hostname).toBe("api.example.test");
    expect(requestOptions.servername).toBe("api.example.test");
    expect(requestOptions.path).toBe("/v1/chat/completions");
    expect(requestOptions.headers).toMatchObject({
      Host: "api.example.test",
      Authorization: "Bearer fake-compatible-key",
    });
    const body = JSON.parse(
      Buffer.concat(
        double.requests[0].write.mock.calls.map(([value]) =>
          Buffer.from(value),
        ),
      ).toString(),
    );
    expect(body).toEqual({
      model: "custom-model",
      messages: [
        { role: "system", content: "system-value" },
        { role: "user", content: "prompt-value" },
      ],
      max_tokens: 2048,
      temperature: 0.2,
      stream: false,
      response_format: { type: "json_object" },
    });

    const lookup = requestOptions.lookup as (
      hostname: string,
      options: unknown,
      callback: (
        error: Error | null,
        address?: string,
        family?: number,
      ) => void,
    ) => void;
    const pinned = await new Promise<{ address?: string; family?: number }>(
      (resolve, reject) => {
        lookup("api.example.test", {}, (error, address, family) => {
          if (error) reject(error);
          else resolve({ address, family });
        });
      },
    );
    expect(pinned).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("re-approves the configured endpoint for each retry", async () => {
    jest.useFakeTimers();
    try {
      const double = requestDouble([
        new FakeResponse(429, ["rate-limit-body"]),
        new FakeResponse(200, [
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        ]),
      ]);
      const { provider: transport, lookup } = provider(double.requestImpl);

      const resultPromise = transport.generate("prompt");
      await jest.runAllTimersAsync();

      await expect(resultPromise).resolves.toBe("ok");
      expect(double.requestImpl).toHaveBeenCalledTimes(2);
      expect(lookup).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("preserves an allowlisted network code for retry without exposing the raw error", async () => {
    jest.useFakeTimers();
    try {
      const response = new FakeResponse(200, [
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      ]);
      let attempt = 0;
      const requestImpl = jest.fn((requestOptions: Record<string, unknown>) => {
        const request = Object.assign(new EventEmitter(), {
          write: jest.fn(),
          end: jest.fn(() => {
            if (attempt++ === 0) {
              request.emit("error", {
                code: "ECONNRESET",
                message: "secret-api-key-and-prompt",
              });
              return;
            }
            request.emit("response", response);
            response.start();
          }),
          destroy: jest.fn(),
          setTimeout: jest.fn(),
        }) as FakeRequest;
        void requestOptions;
        return request;
      });
      const { provider: transport } = provider(requestImpl);

      const resultPromise = transport.generate("prompt-secret");
      await jest.runAllTimersAsync();

      await expect(resultPromise).resolves.toBe("ok");
      expect(requestImpl).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("aborts timed-out requests with a bounded retry-safe diagnostic", async () => {
    jest.useFakeTimers();
    try {
      const requests: FakeRequest[] = [];
      const requestImpl = jest.fn(() => {
        const request = Object.assign(new EventEmitter(), {
          write: jest.fn(),
          end: jest.fn(() => request.emit("timeout")),
          destroy: jest.fn(),
          setTimeout: jest.fn(),
        }) as FakeRequest;
        requests.push(request);
        return request;
      });
      const { provider: transport } = provider(requestImpl);

      const resultPromise = transport.generate("prompt-secret");
      const settled = resultPromise.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await jest.runAllTimersAsync();
      const outcome = await settled;
      const error = "error" in outcome ? outcome.error : undefined;

      expect((error as Error).message).toContain("ETIMEDOUT");
      expect((error as Error).message).not.toContain("prompt-secret");
      expect(requestImpl).toHaveBeenCalledTimes(4);
      expect(
        requests.every((request) => request.destroy.mock.calls.length > 0),
      ).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects redirects without following or forwarding credentials", async () => {
    const response = new FakeResponse(302, [], {
      location: "https://other.example.test/chat/completions",
    });
    const double = requestDouble([response]);
    const { provider: transport } = provider(double.requestImpl);

    const error = await transport
      .generate("prompt")
      .catch((value: unknown) => value);
    expect((error as Error).message).toContain(
      "PROVIDER_CROSS_ORIGIN_REDIRECT",
    );
    expect(double.requestImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed and non-string response text without secrets", async () => {
    const response = new FakeResponse(200, [
      JSON.stringify({ choices: [{ message: { content: { secret: "x" } } }] }),
    ]);
    const double = requestDouble([response]);
    const { provider: transport } = provider(double.requestImpl);

    const error = await transport
      .generate("prompt-secret")
      .catch((value: unknown) => value);
    expect((error as Error).message).toMatch(
      /openai-compatible provider returned no text/,
    );
    expect((error as Error).message).not.toContain("prompt-secret");
    expect((error as Error).message).not.toContain("fake-compatible-key");
  });

  it("enforces the request and response body limits", async () => {
    const requestDoubleValue = requestDouble([
      new FakeResponse(200, [
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      ]),
    ]);
    const { provider: requestLimited } = provider(
      requestDoubleValue.requestImpl,
    );
    await expect(
      requestLimited.generate("x".repeat(MAX_PROVIDER_BODY_BYTES)),
    ).rejects.toThrow(/request body is too large/);
    expect(requestDoubleValue.requestImpl).not.toHaveBeenCalled();

    const responseLimitedDouble = requestDouble([
      new FakeResponse(200, [Buffer.alloc(MAX_PROVIDER_BODY_BYTES + 1)]),
    ]);
    const { provider: responseLimited } = provider(
      responseLimitedDouble.requestImpl,
    );
    await expect(responseLimited.generate("prompt")).rejects.toThrow(
      /response body is too large/,
    );
  });
});

describe("OpenAI-compatible streaming", () => {
  it("accumulates ordered SSE deltas and handles [DONE]", async () => {
    const body = [
      'event: message\ndata: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const double = requestDouble([new FakeResponse(200, body)]);
    const { provider: transport } = provider(double.requestImpl);
    const tokens: string[] = [];

    await expect(
      transport.generateStream!("prompt", {}, (token) => tokens.push(token)),
    ).resolves.toBe("Hello");
    expect(tokens).toEqual(["Hel", "lo"]);
  });

  it("emits a complete delta before the terminal frame and response end", async () => {
    const tokens: string[] = [];
    let tokensBeforeEnd: string[] = [];
    const response = new FakeResponse(
      200,
      [
        'data: {"choices":[{"delta":{"content":"first"}}]}\n\n',
        "data: [DONE]\n\n",
      ],
      {},
      () => {
        tokensBeforeEnd = [...tokens];
      },
    );
    const double = requestDouble([response]);
    const { provider: transport } = provider(double.requestImpl);

    await expect(
      transport.generateStream!("prompt", {}, (token) => tokens.push(token)),
    ).resolves.toBe("first");
    expect(tokensBeforeEnd).toEqual(["first"]);
  });

  it("does not replay a stream after output when the response then fails", async () => {
    const tokens: string[] = [];
    const response = new FakeResponse(
      200,
      ['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'],
      {},
      () => response.emit("error", { code: "ECONNRESET", message: "secret" }),
    );
    const double = requestDouble([response]);
    const { provider: transport } = provider(double.requestImpl);

    const result = transport.generateStream!("prompt-secret", {}, (token) =>
      tokens.push(token),
    );
    const settled = result.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    const outcome = await settled;
    const error = "error" in outcome ? outcome.error : undefined;

    expect((error as Error).message).toMatch(/stream failed after output/);
    expect(tokens).toEqual(["partial"]);
    expect(double.requestImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed or prematurely terminated SSE safely", async () => {
    const malformed = requestDouble([
      new FakeResponse(200, ["data: {not-json}\n\n"]),
    ]);
    const { provider: malformedProvider } = provider(malformed.requestImpl);
    await expect(
      malformedProvider.generateStream!("prompt-secret", {}, jest.fn()),
    ).rejects.toThrow(/openai-compatible provider stream/);

    const premature = requestDouble([
      new FakeResponse(200, ['data: {"choices":[]}\n\n']),
    ]);
    const { provider: prematureProvider } = provider(premature.requestImpl);
    await expect(
      prematureProvider.generateStream!("prompt", {}, jest.fn()),
    ).rejects.toThrow(/stream failed/);
  });
});
