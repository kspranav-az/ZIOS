import { describe, expect, it, vi } from 'vitest';
import { GeminiLlmProvider } from './gemini.provider';

const fakeGenerateContent = vi.fn();
const fakeGetGenerativeModel = vi.fn(() => ({ generateContent: fakeGenerateContent }));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: fakeGetGenerativeModel,
  })),
}));

describe('GeminiLlmProvider', () => {
  it('throws when no API key is provided', () => {
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    expect(() => new GeminiLlmProvider()).toThrow(/GEMINI_API_KEY/);
    process.env.GEMINI_API_KEY = original;
  });

  it('uses the default model and returns parsed tokens from usage metadata', async () => {
    fakeGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => '{"recommendation": 4}',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
      },
    });

    const provider = new GeminiLlmProvider('test-key', 'gemini-1.5-flash');
    const result = await provider.complete({
      task: 'judge_score',
      promptText: 'score this',
      variables: { transcript: [] },
    });

    expect(result.text).toBe('{"recommendation": 4}');
    expect(result.tokensIn).toBe(100);
    expect(result.tokensOut).toBe(20);
    expect(result.model).toBe('gemini-1.5-flash');
    expect(fakeGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-1.5-flash',
        generationConfig: expect.objectContaining({ responseMimeType: 'application/json' }),
      }),
    );
  });

  it('applies provider override model from policy', async () => {
    fakeGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => '{"title": "Engineer"}',
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10 },
      },
    });

    const provider = new GeminiLlmProvider('test-key', 'gemini-1.5-flash');
    await provider.complete({
      task: 'analyze_jd',
      promptText: 'analyze this jd',
      variables: { jdText: '...' },
      policy: { model: 'gemini-1.5-pro', temperature: 0.5 },
    });

    expect(fakeGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-1.5-pro',
        generationConfig: expect.objectContaining({ temperature: 0.5 }),
      }),
    );
  });

  it('estimates tokens when usage metadata is absent', async () => {
    fakeGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => '{"foo": "bar"}',
        usageMetadata: undefined,
      },
    });

    const provider = new GeminiLlmProvider('test-key');
    const result = await provider.complete({
      task: 'judge_score',
      promptText: 'short',
      variables: {},
    });

    expect(result.tokensIn).toBeGreaterThan(0);
    expect(result.tokensOut).toBeGreaterThan(0);
  });

  it('wraps provider errors in ApiException', async () => {
    fakeGenerateContent.mockRejectedValueOnce(new Error('quota exceeded'));

    const provider = new GeminiLlmProvider('test-key');
    await expect(
      provider.complete({ task: 'analyze_jd', promptText: 'x', variables: {} }),
    ).rejects.toThrow('LLM_PROVIDER_ERROR');
  });
});
