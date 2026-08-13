import { EventEmitter } from "node:events";
import { OllamaProvider } from "../../../src/providers/ollama";
import { listOllamaModels } from "../../../src/providers/ollama";

class FakeResponse extends EventEmitter {
  constructor(
    readonly statusCode: number,
    readonly bodyChunks: readonly (string | Buffer)[],
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

function requestDouble(
  responses: readonly FakeResponse[],
  errors: readonly unknown[] = [],
): {
  requestImpl: jest.Mock;
  requests: FakeRequest[];
  options: Record<string, unknown>[];
} {
  const requests: FakeRequest[] = [];
  const options: Record<string, unknown>[] = [];
  let index = 0;
  const requestImpl = jest.fn((requestOptions: Record<string, unknown>) => {
    options.push(requestOptions);
    const request = Object.assign(new EventEmitter(), {
      write: jest.fn(),
      end: jest.fn(() => {
        const attempt = index++;
        const error = errors[attempt];
        if (error !== undefined) {
          request.emit("error", error);
          return;
        }
        const response = responses[Math.min(attempt, responses.length - 1)];
        request.emit("response", response);
        response.start();
      }),
      destroy: jest.fn(),
      setTimeout: jest.fn(),
    }) as FakeRequest;
    requests.push(request);
    return request;
  });
  return { requestImpl, requests, options };
}

function loopbackEndpoint() {
  return {
    url: new URL("http://127.0.0.1:11434"),
    origin: "http://127.0.0.1:11434",
    local: true,
    addresses: [{ address: "127.0.0.1", family: 4 as const }],
  };
}

describe("OllamaProvider retry", () => {
  beforeEach(() => jest.restoreAllMocks());

  it("retries on ECONNREFUSED pattern then succeeds", async () => {
    const double = requestDouble(
      [new FakeResponse(200, [JSON.stringify({ response: "hi" })])],
      [{ cause: { code: "ECONNREFUSED" }, message: "refused" }],
    );
    const provider = new OllamaProvider(
      "http://127.0.0.1:11434",
      "llama3",
      loopbackEndpoint(),
      undefined,
      undefined,
      double.requestImpl,
    );

    const result = await provider.generate("hi");
    expect(result).toBe("hi");
    expect(double.requestImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable errors", async () => {
    const double = requestDouble([new FakeResponse(400, [])]);
    const provider = new OllamaProvider(
      "http://127.0.0.1:11434",
      "llama3",
      loopbackEndpoint(),
      undefined,
      undefined,
      double.requestImpl,
    );

    await expect(provider.generate("hi")).rejects.toThrow();
    expect(double.requestImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects construction without an explicit model before any request", () => {
    expect(
      () =>
        new OllamaProvider(
          "http://127.0.0.1:11434",
          undefined,
          loopbackEndpoint(),
        ),
    ).toThrow(/Ollama model is required/);
  });

  it("discovers deterministic installed model names from /api/tags", async () => {
    const double = requestDouble([
      new FakeResponse(200, [
        JSON.stringify({
          models: [
            { name: "qwen2" },
            { name: "llama3" },
            { name: "qwen2" },
            { name: 42 },
            null,
          ],
        }),
      ]),
    ]);

    const models = await listOllamaModels(
      "http://127.0.0.1:11434",
      double.requestImpl,
    );
    expect(models).toEqual(["llama3", "qwen2"]);
    expect(Object.isFrozen(models)).toBe(true);
    expect(double.options[0]).toMatchObject({
      method: "GET",
      path: "/api/tags",
      hostname: "127.0.0.1",
      headers: { Host: "127.0.0.1:11434" },
    });
  });

  it("returns an empty list for unavailable or malformed discovery responses", async () => {
    const double = requestDouble([
      new FakeResponse(500, []),
      new FakeResponse(200, [JSON.stringify({ models: [{ name: "" }] })]),
    ]);

    await expect(
      listOllamaModels("http://127.0.0.1:11434", double.requestImpl),
    ).resolves.toEqual([]);
    await expect(
      listOllamaModels("http://127.0.0.1:11434", double.requestImpl),
    ).resolves.toEqual([]);
  });

  it("bounds generation and discovery response bodies", async () => {
    const oversizedResponse = requestDouble([
      new FakeResponse(200, [Buffer.alloc(1024 * 1024 + 1)]),
    ]);
    const provider = new OllamaProvider(
      "http://127.0.0.1:11434",
      "llama3",
      loopbackEndpoint(),
      undefined,
      undefined,
      oversizedResponse.requestImpl,
    );
    await expect(provider.generate("prompt")).rejects.toThrow(
      /response body is too large/,
    );

    const oversizedDiscovery = requestDouble([
      new FakeResponse(200, [Buffer.alloc(1024 * 1024 + 1)]),
    ]);
    await expect(
      listOllamaModels(
        "http://127.0.0.1:11434",
        oversizedDiscovery.requestImpl,
      ),
    ).resolves.toEqual([]);
  });

  it("rejects an oversized generation request before opening a socket", async () => {
    const double = requestDouble([
      new FakeResponse(200, [JSON.stringify({ response: "unexpected" })]),
    ]);
    const provider = new OllamaProvider(
      "http://127.0.0.1:11434",
      "llama3",
      loopbackEndpoint(),
      undefined,
      undefined,
      double.requestImpl,
    );

    await expect(provider.generate("x".repeat(1024 * 1024))).rejects.toThrow(
      /request body is too large/,
    );
    expect(double.requestImpl).not.toHaveBeenCalled();
  });

  it("revalidates discovery before connecting and rejects an unsafe rebind", async () => {
    const double = requestDouble([
      new FakeResponse(200, [JSON.stringify({ models: [] })]),
    ]);
    const lookup = jest
      .fn()
      .mockResolvedValue([{ address: "10.0.0.7", family: 4 }]);

    await expect(
      listOllamaModels("http://localhost:11434", double.requestImpl, lookup),
    ).resolves.toEqual([]);
    expect(double.requestImpl).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("pins IPv6 loopback discovery while retaining the original hostname", async () => {
    const double = requestDouble([
      new FakeResponse(200, [JSON.stringify({ models: [{ name: "qwen2" }] })]),
    ]);
    const lookup = jest.fn().mockResolvedValue([{ address: "::1", family: 6 }]);

    await expect(
      listOllamaModels("http://localhost:11434", double.requestImpl, lookup),
    ).resolves.toEqual(["qwen2"]);
    expect(double.options[0]).toMatchObject({
      hostname: "localhost",
      path: "/api/tags",
      headers: { Host: "localhost:11434" },
    });
    const pinnedLookup = double.options[0].lookup as (
      hostname: string,
      options: unknown,
      callback: (
        error: Error | null,
        address?: string,
        family?: number,
      ) => void,
    ) => void;
    await new Promise<void>((resolve, reject) => {
      pinnedLookup("localhost", {}, (error, address, family) => {
        if (error) reject(error);
        else if (address !== "::1" || family !== 6) {
          reject(new Error("unexpected pinned IPv6 address"));
        } else resolve();
      });
    });
  });

  it("revalidates a hostname on every attempt and blocks loopback rebinding", async () => {
    jest.useFakeTimers();
    try {
      const double = requestDouble(
        [new FakeResponse(200, [JSON.stringify({ response: "unexpected" })])],
        [{ code: "ECONNRESET", message: "secret prompt" }],
      );
      const lookup = jest
        .fn()
        .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }])
        .mockResolvedValueOnce([{ address: "10.0.0.7", family: 4 }]);
      const provider = new OllamaProvider(
        "http://localhost:11434",
        "llama3",
        {
          url: new URL("http://localhost:11434"),
          origin: "http://localhost:11434",
          local: true,
          addresses: [{ address: "127.0.0.1", family: 4 }],
        },
        lookup,
        undefined,
        double.requestImpl,
      );

      const resultPromise = provider.generate("prompt-secret");
      const settled = resultPromise.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await jest.runAllTimersAsync();
      const result = await settled;
      const error = "error" in result ? result.error : undefined;

      expect((error as Error).message).not.toContain("prompt-secret");
      expect(double.requestImpl).toHaveBeenCalledTimes(1);
      expect(lookup).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("pins a hostname request to the approved loopback address without another DNS lookup", async () => {
    const double = requestDouble([
      new FakeResponse(200, [JSON.stringify({ response: "ok" })]),
    ]);
    const lookup = jest
      .fn()
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const provider = new OllamaProvider(
      "http://localhost:11434",
      "llama3",
      undefined,
      lookup,
      undefined,
      double.requestImpl,
    );

    await expect(provider.generate("prompt")).resolves.toBe("ok");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(double.options[0].hostname).toBe("localhost");
    const pinnedLookup = double.options[0].lookup as (
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
        pinnedLookup("localhost", {}, (error, address, family) => {
          if (error) reject(error);
          else resolve({ address, family });
        });
      },
    );
    expect(pinned).toEqual({ address: "127.0.0.1", family: 4 });
  });

  it("maps socket failures to safe diagnostics while retaining retry classification", async () => {
    jest.useFakeTimers();
    try {
      const double = requestDouble(
        [],
        [
          { code: "ECONNREFUSED", message: "secret-key prompt body" },
          { code: "ECONNREFUSED", message: "secret-key prompt body" },
          { code: "ECONNREFUSED", message: "secret-key prompt body" },
          { code: "ECONNREFUSED", message: "secret-key prompt body" },
        ],
      );
      const provider = new OllamaProvider(
        "http://127.0.0.1:11434",
        "llama3",
        loopbackEndpoint(),
        undefined,
        undefined,
        double.requestImpl,
      );

      const resultPromise = provider.generate("prompt-secret");
      const settled = resultPromise.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await jest.runAllTimersAsync();
      const result = await settled;
      const error = "error" in result ? result.error : undefined;

      expect((error as Error).message).toContain("ECONNREFUSED");
      expect((error as Error).message).not.toContain("secret-key");
      expect((error as Error).message).not.toContain("prompt-secret");
      expect(double.requestImpl).toHaveBeenCalledTimes(4);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not replay a stream after output when the response then fails", async () => {
    const response = new FakeResponse(
      200,
      [JSON.stringify({ response: "partial" }) + "\n"],
      () => response.emit("error", { code: "ECONNRESET", message: "secret" }),
    );
    const double = requestDouble([response]);
    const provider = new OllamaProvider(
      "http://127.0.0.1:11434",
      "llama3",
      loopbackEndpoint(),
      undefined,
      undefined,
      double.requestImpl,
    );
    const tokens: string[] = [];

    const result = provider.generateStream!("prompt-secret", {}, (token) =>
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
});
