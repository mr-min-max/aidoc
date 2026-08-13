import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageCreateParamsStreaming,
  RawMessageStreamEvent,
  TextBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { withRetry } from "../core/retry";
import { GenerateOptions, LLMProvider } from "./types";

const DEFAULT_MODEL = "claude-sonnet-5";

interface AnthropicClient {
  messages: {
    create(params: MessageCreateParamsNonStreaming): Promise<Message>;
    stream(
      params: MessageCreateParamsStreaming,
    ): AsyncIterable<RawMessageStreamEvent>;
  };
}

type AnthropicConstructor = new (options: {
  apiKey: string;
}) => AnthropicClient;

function safeStatus(error: unknown): number | undefined {
  try {
    if (typeof error !== "object" || error === null) return undefined;
    const status = Reflect.get(error, "status");
    return typeof status === "number" && Number.isInteger(status)
      ? status
      : undefined;
  } catch {
    return undefined;
  }
}

function safeCode(error: unknown): string | undefined {
  try {
    if (typeof error !== "object" || error === null) return undefined;
    const code = Reflect.get(error, "code");
    return typeof code === "string" ? code.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function providerError(phase: "request" | "stream", error: unknown): Error {
  const status = safeStatus(error);
  if (status !== undefined && status >= 100 && status <= 599) {
    return new Error(`Anthropic provider ${phase} failed (HTTP ${status})`);
  }
  const code = safeCode(error);
  if (
    code === "etimedout" ||
    code === "econnreset" ||
    code === "econnrefused" ||
    code === "timeout" ||
    code === "aborted" ||
    code === "abort_err"
  ) {
    return new Error(`Anthropic provider ${phase} failed (network timeout)`);
  }
  return new Error(`Anthropic provider ${phase} failed`);
}

function requestParams(
  model: string,
  prompt: string,
  options: GenerateOptions,
  stream: false,
): MessageCreateParamsNonStreaming;
function requestParams(
  model: string,
  prompt: string,
  options: GenerateOptions,
  stream: true,
): MessageCreateParamsStreaming;
function requestParams(
  model: string,
  prompt: string,
  options: GenerateOptions,
  stream: boolean,
): MessageCreateParamsNonStreaming | MessageCreateParamsStreaming {
  return {
    model,
    max_tokens: options.maxTokens ?? 4096,
    messages: [{ role: "user", content: prompt }],
    ...(stream ? { stream: true } : {}),
    ...(options.systemPrompt === undefined
      ? {}
      : { system: options.systemPrompt }),
    ...(options.temperature === undefined
      ? {}
      : { temperature: options.temperature }),
  } as MessageCreateParamsNonStreaming | MessageCreateParamsStreaming;
}

function messageText(response: unknown): string {
  if (typeof response !== "object" || response === null) {
    throw new Error("Anthropic provider returned no text");
  }
  let content: unknown;
  try {
    content = Reflect.get(response, "content");
  } catch {
    throw new Error("Anthropic provider returned no text");
  }
  if (!Array.isArray(content)) {
    throw new Error("Anthropic provider returned no text");
  }

  const textBlocks = content.filter((block): block is TextBlock => {
    if (typeof block !== "object" || block === null) return false;
    try {
      return (
        Reflect.get(block, "type") === "text" &&
        typeof Reflect.get(block, "text") === "string"
      );
    } catch {
      return false;
    }
  });
  const text = textBlocks.map((block) => block.text).join("");
  if (text.trim() === "") {
    throw new Error("Anthropic provider returned no text");
  }
  return text;
}

async function loadClient(apiKey: string): Promise<AnthropicClient> {
  try {
    const mod = await import("@anthropic-ai/sdk");
    const Anthropic = mod.default as unknown as AnthropicConstructor;
    return new Anthropic({ apiKey });
  } catch {
    throw new Error("Anthropic provider is unavailable");
  }
}

/** Anthropic Messages provider with retry and truthful streaming support. */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  /** Generates a non-streaming completion through the Messages API. */
  async generate(
    prompt: string,
    options: GenerateOptions = {},
  ): Promise<string> {
    const client = await loadClient(this.apiKey);
    const run = async (): Promise<string> => {
      try {
        const response = await client.messages.create(
          requestParams(this.model, prompt, options, false),
        );
        return messageText(response);
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          error.message === "Anthropic provider returned no text"
        ) {
          throw error;
        }
        throw providerError("request", error);
      }
    };

    return withRetry(run, { maxRetries: 3 });
  }

  /** Streams only Anthropic text_delta events in provider order. */
  async generateStream(
    prompt: string,
    options: GenerateOptions,
    onToken: (token: string) => void,
  ): Promise<string> {
    let emitted = false;
    const emit = (token: string): void => {
      emitted = true;
      onToken(token);
    };
    const client = await loadClient(this.apiKey);
    const run = async (): Promise<string> => {
      let sawTerminalEvent = false;
      try {
        const stream = client.messages.stream(
          requestParams(this.model, prompt, options, true),
        );
        let full = "";
        for await (const event of stream) {
          if (event.type === "content_block_delta") {
            if (event.delta.type !== "text_delta") continue;
            if (typeof event.delta.text !== "string") {
              throw new Error(
                "Anthropic provider stream returned invalid text",
              );
            }
            if (event.delta.text.length > 0) {
              full += event.delta.text;
              emit(event.delta.text);
            }
            continue;
          }

          if (event.type === "message_stop") {
            sawTerminalEvent = true;
            continue;
          }

          if ((event.type as string) === "error") {
            throw new Error("Anthropic provider stream failed");
          }
        }

        if (!sawTerminalEvent) {
          throw new Error("Anthropic provider stream ended prematurely");
        }
        if (full.trim() === "") {
          throw new Error("Anthropic provider returned no text");
        }
        return full;
      } catch (error: unknown) {
        if (emitted) {
          return Promise.reject(
            new Error("Anthropic provider stream failed after output"),
          );
        }
        if (
          error instanceof Error &&
          (error.message === "Anthropic provider returned no text" ||
            error.message ===
              "Anthropic provider stream returned invalid text" ||
            error.message === "Anthropic provider stream failed" ||
            error.message === "Anthropic provider stream ended prematurely")
        ) {
          throw error;
        }
        throw providerError("stream", error);
      }
    };

    return withRetry(run, { maxRetries: 3 });
  }
}
