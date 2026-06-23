import OpenAI from 'openai';
import { LLMProvider, GenerateOptions } from './types';

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
        throw new Error('Rate limited by OpenAI. Please wait and try again.');
      }
      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }
}
