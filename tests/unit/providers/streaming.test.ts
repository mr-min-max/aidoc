import { EventEmitter } from "node:events";
import { OllamaProvider } from "../../../src/providers/ollama";

class FakeResponse extends EventEmitter {
  readonly statusCode = 200;

  constructor(readonly bodyChunks: readonly string[]) {
    super();
  }

  start(): void {
    for (const chunk of this.bodyChunks) this.emit("data", chunk);
    this.emit("end");
  }

  setEncoding(): void {}

  resume(): void {
    this.start();
  }

  destroy(): void {}
}

function requestDouble(response: FakeResponse): jest.Mock {
  return jest.fn(() => {
    const request = Object.assign(new EventEmitter(), {
      write: jest.fn(),
      end: jest.fn(() => {
        request.emit("response", response);
        response.start();
      }),
      destroy: jest.fn(),
      setTimeout: jest.fn(),
    });
    return request;
  });
}

describe("OllamaProvider.generateStream", () => {
  beforeEach(() => jest.restoreAllMocks());

  it("accumulates streamed tokens and calls onToken per chunk", async () => {
    // ndjson stream: two chunks then a [done]
    const chunks = [
      { response: "Hel" },
      { response: "lo" },
      { response: "", done: true },
    ];
    const requestImpl = requestDouble(
      new FakeResponse(chunks.map((chunk) => JSON.stringify(chunk) + "\n")),
    );
    const provider = new OllamaProvider(
      "http://127.0.0.1:11434",
      "llama3",
      {
        url: new URL("http://127.0.0.1:11434"),
        origin: "http://127.0.0.1:11434",
        local: true,
        addresses: [{ address: "127.0.0.1", family: 4 }],
      },
      undefined,
      undefined,
      requestImpl,
    );

    const tokens: string[] = [];
    const full = await provider.generateStream!("hi", {}, (t) =>
      tokens.push(t),
    );
    expect(full).toBe("Hello");
    expect(tokens).toEqual(["Hel", "lo"]);
    expect(requestImpl).toHaveBeenCalledTimes(1);
  });
});
