import { getTinyFishKeyPool } from './key-rotation.ts';

export interface TinyFishSearchResult {
  title?: string;
  url: string;
  description?: string;
}

export interface TinyFishFetchItemResult {
  url: string;
  status?: number;
  markdown?: string;
  content?: string;
  error?: string;
}

/**
 * Searches using TinyFish Search API.
 * GET https://api.search.tinyfish.ai?query=...
 */
export async function tinyfishSearch(query: string): Promise<TinyFishSearchResult[]> {
  const pool = getTinyFishKeyPool();
  const maxAttempts = Math.max(pool.count, 1);

  for (let i = 0; i < maxAttempts; i++) {
    const key = pool.getKey();
    const headers: Record<string, string> = {};
    if (key) {
      headers['X-API-Key'] = key;
    }

    try {
      const url = `https://api.search.tinyfish.ai?query=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers });

      if (!res.ok) {
        if ([401, 402, 403, 429].includes(res.status)) {
          if (key) pool.markFailed(key);
        }
        throw new Error(`TinyFish Search HTTP ${res.status}`);
      }

      if (key) pool.markSuccess(key);
      const data = await res.json();
      return Array.isArray(data) ? data : data.results || [];
    } catch (err) {
      if (i === maxAttempts - 1) throw err;
    }
  }

  return [];
}

/**
 * Fetches URLs using TinyFish Fetch API.
 * POST https://api.fetch.tinyfish.ai
 * Body: {"urls":["..."],"format":"markdown"}
 */
export async function tinyfishFetch(urls: string[]): Promise<TinyFishFetchItemResult[]> {
  if (urls.length === 0) return [];

  const pool = getTinyFishKeyPool();
  const maxAttempts = Math.max(pool.count, 1);

  for (let i = 0; i < maxAttempts; i++) {
    const key = pool.getKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (key) {
      headers['X-API-Key'] = key;
    }

    try {
      const res = await fetch('https://api.fetch.tinyfish.ai', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          urls,
          format: 'markdown',
        }),
      });

      if (!res.ok) {
        if ([401, 402, 403, 429].includes(res.status)) {
          if (key) pool.markFailed(key);
        }
        throw new Error(`TinyFish Fetch HTTP ${res.status}`);
      }

      if (key) pool.markSuccess(key);
      const data = await res.json();
      return Array.isArray(data) ? data : data.results || [];
    } catch (err) {
      if (i === maxAttempts - 1) throw err;
    }
  }

  return [];
}

/**
 * TinyFish Agent client with key-locking.
 */
export async function tinyfishAgentRun(instruction: string): Promise<{ runId: string; apiKeyUsed: string | null }> {
  const pool = getTinyFishKeyPool();
  const key = pool.getKey();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers['X-API-Key'] = key;

  const res = await fetch('https://agent.tinyfish.ai/v1/automation/run-async', {
    method: 'POST',
    headers,
    body: JSON.stringify({ instruction }),
  });

  if (!res.ok) {
    if (key && [401, 402, 403, 429].includes(res.status)) pool.markFailed(key);
    throw new Error(`TinyFish Agent Run HTTP ${res.status}`);
  }

  const data = await res.json();
  return { runId: data.id || data.runId, apiKeyUsed: key };
}

export async function tinyfishAgentPoll(runId: string, apiKey: string | null): Promise<any> {
  const headers: Record<string, string> = {};
  if (apiKey) headers['X-API-Key'] = apiKey;

  const res = await fetch(`https://agent.tinyfish.ai/v1/runs/${runId}`, { headers });
  if (!res.ok) throw new Error(`TinyFish Agent Poll HTTP ${res.status}`);
  return res.json();
}

export async function tinyfishAgentCancel(runId: string, apiKey: string | null): Promise<any> {
  const headers: Record<string, string> = {};
  if (apiKey) headers['X-API-Key'] = apiKey;

  const res = await fetch(`https://agent.tinyfish.ai/v1/runs/${runId}/cancel`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) throw new Error(`TinyFish Agent Cancel HTTP ${res.status}`);
  return res.json();
}
