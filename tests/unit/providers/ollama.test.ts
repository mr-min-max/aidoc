import { OllamaProvider } from '../../../src/providers/ollama';

describe('OllamaProvider retry', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('retries on ECONNREFUSED pattern then succeeds', async () => {
    const provider = new OllamaProvider('http://localhost:11434', 'llama3');
    const ok = { ok: true, json: async () => ({ response: 'hi' }) };

    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce({ cause: { code: 'ECONNREFUSED' }, message: 'refused' })
      .mockResolvedValueOnce(ok as any);

    const result = await provider.generate('hi');
    expect(result).toBe('hi');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable errors', async () => {
    const provider = new OllamaProvider('http://localhost:11434', 'llama3');
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false, status: 400, statusText: 'Bad Request',
    } as any);

    await expect(provider.generate('hi')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
