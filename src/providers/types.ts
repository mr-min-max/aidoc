export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  responseFormat?: 'text' | 'json';
}

export interface LLMProvider {
  readonly name: string;
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  /** Streams tokens as they arrive. Optional — falls back to generate() if absent. */
  generateStream?(prompt: string, options: GenerateOptions, onToken: (token: string) => void): Promise<string>;
}
