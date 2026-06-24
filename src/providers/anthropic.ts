import { LLMProvider, GenerateOptions } from './types';
import { withRetry } from '../core/retry';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';

  constructor(private apiKey: string, private model: string = 'claude-sonnet-4-20250514') {}

  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    // Dynamic import to make @anthropic-ai/sdk an optional peer dependency
    let Anthropic: any;
    try {
      const mod = await import('@anthropic-ai/sdk');
      Anthropic = mod.default;
    } catch {
      throw new Error(
        'Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk'
      );
    }

    const client = new Anthropic({ apiKey: this.apiKey });

    const run = async (): Promise<string> => {
      try {
        const response = await client.messages.create({
          model: this.model,
          max_tokens: options.maxTokens || 4096,
          system: options.systemPrompt,
          messages: [{ role: 'user', content: prompt }],
        });

        const textBlock = response.content.find((block: any) => block.type === 'text');
        return (textBlock as any)?.text || '';
      } catch (error: any) {
        const status = error.status ?? '';
        // Surface a 429 token so isRetryableError() matches and retries.
        if (status === 429) throw new Error('429 rate limited: Anthropic');
        throw new Error(`Anthropic API error: ${error.message}`);
      }
    };

    return withRetry(run, { maxRetries: 3 });
  }

  async generateStream(
    prompt: string,
    options: GenerateOptions,
    onToken: (token: string) => void
  ): Promise<string> {
    let Anthropic: any;
    try {
      const mod = await import('@anthropic-ai/sdk');
      Anthropic = mod.default;
    } catch {
      throw new Error('Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk');
    }
    const client = new Anthropic({ apiKey: this.apiKey });

    const run = async (): Promise<string> => {
      const stream = client.messages.stream({
        model: this.model, max_tokens: options.maxTokens || 4096,
        system: options.systemPrompt, messages: [{ role: 'user', content: prompt }],
      });
      let full = '';
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          full += event.delta.text; onToken(event.delta.text);
        }
      }
      return full;
    };

    return withRetry(run, { maxRetries: 3 });
  }
}
