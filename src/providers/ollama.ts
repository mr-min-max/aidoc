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
          throw new Error(`ECONNREFUSED: cannot connect to Ollama at ${this.host}`, { cause: error });
        }
        throw new Error(`Ollama error: ${error.message}`, { cause: error });
      }
    };

    return withRetry(run, { maxRetries: 3 });
  }

  async generateStream(
    prompt: string,
    options: GenerateOptions,
    onToken: (token: string) => void
  ): Promise<string> {
    const fullPrompt = options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt;

    const run = async (): Promise<string> => {
      const response = await fetch(`${this.host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model, prompt: fullPrompt, stream: true,
          options: { temperature: options.temperature ?? 0.3, num_predict: options.maxTokens || 4096 },
        }),
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      let full = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const data = JSON.parse(line);
          if (data.response) { full += data.response; onToken(data.response); }
          if (data.done) return full;
        }
      }
      return full;
    };

    return withRetry(run, { maxRetries: 3 });
  }
}
