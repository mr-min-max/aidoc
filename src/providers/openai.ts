import OpenAI from 'openai';
import { LLMProvider, GenerateOptions } from './types';
import { withRetry } from '../core/retry';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private client: OpenAI;

  constructor(apiKey: string, private model: string = 'gpt-4o-mini') {
    this.client = new OpenAI({ apiKey });
  }

  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const run = async (): Promise<string> => {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages,
          max_tokens: options.maxTokens,
          temperature: options.temperature ?? 0.3,
          ...(options.responseFormat === 'json' && {
            response_format: { type: 'json_object' as const },
          }),
        });
        return response.choices[0]?.message?.content || '';
      } catch (error: any) {
        if (error.status === 429) {
          // Message contains "429" so isRetryableError() will match and retry.
          throw new Error('429 rate limited: OpenAI');
        }
        throw new Error(`OpenAI API error: ${error.message}`);
      }
    };

    return withRetry(run, { maxRetries: 3 });
  }

  async generateStream(
    prompt: string,
    options: GenerateOptions,
    onToken: (token: string) => void
  ): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const run = async (): Promise<string> => {
      const stream = await this.client.chat.completions.create({
        model: this.model, messages, stream: true,
        max_tokens: options.maxTokens, temperature: options.temperature ?? 0.3,
      });
      let full = '';
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || '';
        if (token) { full += token; onToken(token); }
      }
      return full;
    };

    return withRetry(run, { maxRetries: 3 });
  }
}
