import { LLMProvider } from './types';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { OllamaProvider } from './ollama';

interface ProviderConfig {
  provider: 'openai' | 'anthropic' | 'ollama';
  apiKey?: string;
  model?: string;
  ollamaHost?: string;
}

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'openai': {
      const key = config.apiKey || process.env.OPENAI_API_KEY;
      if (!key) {
        throw new Error(
          'OpenAI API key is required.\n' +
          'Set it via:\n' +
          '  • Environment variable: export OPENAI_API_KEY="sk-..."\n' +
          '  • Config file: add "apiKey" to .aidocrc.json\n' +
          '  • .env file: OPENAI_API_KEY=sk-...'
        );
      }
      return new OpenAIProvider(key, config.model);
    }
    case 'anthropic': {
      const key = config.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!key) {
        throw new Error(
          'Anthropic API key is required.\n' +
          'Set it via:\n' +
          '  • Environment variable: export ANTHROPIC_API_KEY="sk-ant-..."\n' +
          '  • Config file: add "apiKey" to .aidocrc.json'
        );
      }
      return new AnthropicProvider(key, config.model);
    }
    case 'ollama':
      return new OllamaProvider(config.ollamaHost, config.model);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
