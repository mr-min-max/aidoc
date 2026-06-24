import { OpenAIProvider } from '../../../src/providers/openai';

// Mock the openai module
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    })),
  };
});

describe('OpenAIProvider retry', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retries on 429 then succeeds', async () => {
    const provider = new OpenAIProvider('test-key', 'gpt-4o-mini');
    const create = (provider as any).client.chat.completions.create as jest.Mock;

    create
      .mockRejectedValueOnce({ status: 429, message: 'Rate limited' })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' } }],
      });

    const result = await provider.generate('hi', { maxTokens: 10 });
    expect(result).toBe('ok');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-retryable error', async () => {
    const provider = new OpenAIProvider('test-key', 'gpt-4o-mini');
    const create = (provider as any).client.chat.completions.create as jest.Mock;
    create.mockRejectedValue({ status: 401, message: 'Invalid key' });

    await expect(provider.generate('hi')).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
