import { LLMProvider, GenerateOptions } from './types';

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
      throw new Error(`Anthropic API error: ${error.message}`);
    }
  }
}
