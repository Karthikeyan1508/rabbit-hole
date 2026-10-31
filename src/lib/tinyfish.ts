import { keyring } from "./keyring";

// Keys rotate (TINYFISH_API_KEYS=k1,k2,k3). A run belongs to the key that started it, so polling/cancel reuse that key.
const keys = keyring("TINYFISH_API_KEYS", "TINYFISH_API_KEY");
const runKey = new Map<string, string>();

async function call(url: string, init: RequestInit = {}, only?: string) {
  const order = only ? [only] : keys.ordered();
  if (!order.length) throw new Error("No TINYFISH_API_KEY configured");
  let res!: Response;
  let used = order[0];
  for (const key of order) {
    used = key;
    res = await fetch(url, { ...init, headers: { "X-API-Key": key, "Content-Type": "application/json" } });
    if (![401, 402, 403, 429].includes(res.status)) break; // auth, billing or rate limit: try the next key
    keys.bad(key, res.status === 429 ? 60_000 : 3_600_000);
  }
  return { res, key: used };
}

async function j(res: Response) {
  if (!res.ok) throw new Error(`TinyFish ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export type Hit = { url: string; title?: string; snippet?: string };

export async function search(query: string): Promise<Hit[]> {
  const r = await j((await call(`https://api.search.tinyfish.ai?query=${encodeURIComponent(query)}`)).res);
  return r.results ?? [];
}

export type Page = { url: string; final_url?: string; title?: string; text: string };

export async function fetchPages(urls: string[]): Promise<{ results: Page[]; errors: { url: string; error: string }[] }> {
  const r = await j((await call("https://api.fetch.tinyfish.ai", {
    method: "POST", body: JSON.stringify({ urls: urls.slice(0, 10), format: "markdown" }),
  })).res);
  return { results: (r.results ?? []).filter((p: Page) => typeof p.text === "string"), errors: r.errors ?? [] };
}

export async function startRun(url: string, goal: string, maxSeconds: number): Promise<string> {
  const { res, key } = await call("https://agent.tinyfish.ai/v1/automation/run-async", {
    method: "POST", body: JSON.stringify({ url, goal, agent_config: { max_duration_seconds: maxSeconds } }),
  });
  const r = await j(res);
  if (!r.run_id) throw new Error(`TinyFish run not created: ${JSON.stringify(r.error)}`);
  runKey.set(r.run_id, key);
  return r.run_id;
}

export const getRun = async (id: string) => j((await call(`https://agent.tinyfish.ai/v1/runs/${id}`, {}, runKey.get(id))).res);
export const cancelRun = async (id: string) => j((await call(`https://agent.tinyfish.ai/v1/runs/${id}/cancel`, { method: "POST" }, runKey.get(id))).res);
