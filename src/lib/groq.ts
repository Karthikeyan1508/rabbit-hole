import { z } from 'zod';
import { getGroqKeyPool } from './key-rotation.ts';

const DEFAULT_MODEL = process.env.LLM_MODEL || 'openai/gpt-oss-120b';
const FALLBACK_MODEL = process.env.LLM_FALLBACK_MODEL || 'openai/gpt-oss-20b';

export interface GroqCompletionOptions {
  model?: string;
  maxTokens?: number;
}

/**
 * Calls Groq chat completions with rotation, JSON object enforcement,
 * temperature 0, and Zod schema validation.
 */
export async function groqStructuredCall<T>(
  schema: z.ZodType<T>,
  systemPrompt: string,
  userPrompt: string,
  options: GroqCompletionOptions = {}
): Promise<T> {
  const pool = getGroqKeyPool();
  const models = [options.model || DEFAULT_MODEL, FALLBACK_MODEL];
  const maxAttempts = Math.max(pool.count * 2, 2);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = pool.getKey();
    const currentModel = attempt >= pool.count ? models[1] : models[0];

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (key) {
        headers['Authorization'] = `Bearer ${key}`;
      }

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: currentModel,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      if (!res.ok) {
        if ([401, 402, 403, 429].includes(res.status)) {
          if (key) pool.markFailed(key);
        }
        const errText = await res.text().catch(() => '');
        throw new Error(`Groq HTTP ${res.status}: ${errText}`);
      }

      if (key) pool.markSuccess(key);

      const json = await res.json();
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Groq returned empty response content');
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(content);
      } catch (parseErr: any) {
        throw new Error(`Failed to parse Groq JSON: ${parseErr.message}`);
      }

      const validation = schema.safeParse(parsedJson);
      if (!validation.success) {
        throw new Error(`Groq JSON failed schema validation: ${validation.error.message}`);
      }

      return validation.data;
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError || new Error('All Groq completion attempts failed');
}
