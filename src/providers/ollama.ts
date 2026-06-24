import { LLMProvider, GenerateOptions } from './types';
import { withRetry } from '../core/retry';

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';

  constructor(
    private host: string = 'http://localhost:11434',
    private model: string = 'llama3'
  ) {}

  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const fullPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${prompt}`
      : prompt;

    const run = async (): Promise<string> => {
      try {
        const response = await fetch(`${this.host}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            prompt: fullPrompt,
            stream: false,
            options: {
              temperature: options.temperature ?? 0.3,
              num_predict: options.maxTokens || 4096,
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = (await response.json()) as { response: string };
        return data.response;
      } catch (error: any) {
        // Preserve the ECONNREFUSED token so isRetryableError() can retry it.
        if (error.cause?.code === 'ECONNREFUSED') {
          throw new Error(`ECONNREFUSED: cannot connect to Ollama at ${this.host}`);
        }
        throw new Error(`Ollama error: ${error.message}`);
      }
    };

    return withRetry(run, { maxRetries: 3 });
  }
}
