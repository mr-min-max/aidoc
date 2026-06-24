import { OllamaProvider } from "../../../src/providers/ollama";

describe("OllamaProvider.generateStream", () => {
  beforeEach(() => jest.restoreAllMocks());

  it("accumulates streamed tokens and calls onToken per chunk", async () => {
    const provider = new OllamaProvider("http://localhost:11434", "llama3");
    // ndjson stream: two chunks then a [done]
    const chunks = [
      { response: "Hel" },
      { response: "lo" },
      { response: "", done: true },
    ];
    const body = new ReadableStream({
      start(controller) {
        chunks.forEach((c) =>
          controller.enqueue(Buffer.from(JSON.stringify(c) + "\n")),
        );
        controller.close();
      },
    });
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, body } as any);

    const tokens: string[] = [];
    const full = await provider.generateStream!("hi", {}, (t) =>
      tokens.push(t),
    );
    expect(full).toBe("Hello");
    expect(tokens).toEqual(["Hel", "lo"]);
  });
});
