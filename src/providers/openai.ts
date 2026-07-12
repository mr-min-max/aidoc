import OpenAI from "openai";
import { LLMProvider, GenerateOptions } from "./types.js";
import { withRetry } from "../core/retry.js";

/** OpenAI chat-completions provider with retry and streaming support. */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(
    apiKey: string,
    private model: string = "gpt-4o-mini",
  ) {
    this.client = new OpenAI({ apiKey });
  }

  /** Generates a non-streaming completion from the configured OpenAI model. */
  async generate(
    prompt: string,
    options: GenerateOptions = {},
  ): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const run = async (): Promise<string> => {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages,
          max_tokens: options.maxTokens,
          temperature: options.temperature ?? 0.3,
          ...(options.responseFormat === "json" && {
            response_format: { type: "json_object" as const },
          }),
        });
        return response.choices[0]?.message?.content || "";
      } catch (error: any) {
        if (error.status === 429) {
          // Message contains "429" so isRetryableError() will match and retry.
          throw new Error("429 rate limited: OpenAI", { cause: error });
        }
        throw new Error(`OpenAI API error: ${error.message}`, { cause: error });
      }
    };

    return withRetry(run, { maxRetries: 3 });
  }

  /** Streams completion tokens from the configured OpenAI model. */
  async generateStream(
    prompt: string,
    options: GenerateOptions,
    onToken: (token: string) => void,
  ): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options.systemPrompt)
      messages.push({ role: "system", content: options.systemPrompt });
    messages.push({ role: "user", content: prompt });

    const run = async (): Promise<string> => {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages,
        stream: true,
        max_tokens: options.maxTokens,
        temperature: options.temperature ?? 0.3,
      });
      let full = "";
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || "";
        if (token) {
          full += token;
          onToken(token);
        }
      }
      return full;
    };

    return withRetry(run, { maxRetries: 3 });
  }
}
