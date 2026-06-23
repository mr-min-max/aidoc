import { createProvider } from '../../../src/providers/factory';

describe('createProvider', () => {
  it('should create OpenAI provider', () => {
    const provider = createProvider({ provider: 'openai', apiKey: 'test-key' });
    expect(provider.name).toBe('openai');
  });

  it('should create Anthropic provider', () => {
    const provider = createProvider({ provider: 'anthropic', apiKey: 'test-key' });
    expect(provider.name).toBe('anthropic');
  });

  it('should create Ollama provider without API key', () => {
    const provider = createProvider({ provider: 'ollama' });
    expect(provider.name).toBe('ollama');
  });

  it('should throw without apiKey for OpenAI', () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(() => createProvider({ provider: 'openai' })).toThrow('API key');
    if (original) process.env.OPENAI_API_KEY = original;
  });

  it('should throw without apiKey for Anthropic', () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => createProvider({ provider: 'anthropic' })).toThrow('API key');
    if (original) process.env.ANTHROPIC_API_KEY = original;
  });
});
