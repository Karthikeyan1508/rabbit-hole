export interface KeyPoolOptions {
  cooldownMs?: number;
}

export class KeyPool {
  private keys: string[];
  private currentIndex = 0;
  private cooldowns: Map<string, number> = new Map();
  private defaultCooldownMs: number;

  constructor(keys: string[], options: KeyPoolOptions = {}) {
    // Filter and trim
    this.keys = keys.map((k) => k.trim()).filter((k) => k.length > 0);
    this.defaultCooldownMs = options.cooldownMs ?? 60_000; // 1 min default
  }

  public get count(): number {
    return this.keys.length;
  }

  /**
   * Acquire the next available key that is not in cooldown.
   */
  public getKey(): string | null {
    if (this.keys.length === 0) return null;

    const now = Date.now();
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      const key = this.keys[idx];
      const cd = this.cooldowns.get(key) || 0;

      if (now >= cd) {
        this.currentIndex = (idx + 1) % this.keys.length;
        return key;
      }
    }

    // If all keys are in cooldown, find the one with the earliest expiry
    let earliestKey = this.keys[0];
    let earliestTime = this.cooldowns.get(earliestKey) || 0;

    for (const key of this.keys) {
      const cd = this.cooldowns.get(key) || 0;
      if (cd < earliestTime) {
        earliestKey = key;
        earliestTime = cd;
      }
    }

    return earliestKey;
  }

  /**
   * Mark a key as failed (401, 402, 403, 429) and place it on cooldown.
   */
  public markFailed(key: string, customCooldownMs?: number): void {
    const cd = customCooldownMs ?? this.defaultCooldownMs;
    this.cooldowns.set(key, Date.now() + cd);
  }

  /**
   * Clear cooldown for a key upon confirmed success.
   */
  public markSuccess(key: string): void {
    this.cooldowns.delete(key);
  }
}

function parseEnvKeys(keysEnv?: string, singleKeyEnv?: string): string[] {
  const result: string[] = [];
  if (keysEnv) {
    result.push(...keysEnv.split(','));
  }
  if (singleKeyEnv) {
    result.push(singleKeyEnv);
  }
  return Array.from(new Set(result.map((k) => k.trim()).filter(Boolean)));
}

let groqPoolInstance: KeyPool | null = null;
let tinyfishPoolInstance: KeyPool | null = null;

export function getGroqKeyPool(): KeyPool {
  if (!groqPoolInstance) {
    const keys = parseEnvKeys(process.env.GROQ_API_KEYS, process.env.GROQ_API_KEY);
    groqPoolInstance = new KeyPool(keys);
  }
  return groqPoolInstance;
}

export function getTinyFishKeyPool(): KeyPool {
  if (!tinyfishPoolInstance) {
    const keys = parseEnvKeys(process.env.TINYFISH_API_KEYS, process.env.TINYFISH_API_KEY);
    tinyfishPoolInstance = new KeyPool(keys);
  }
  return tinyfishPoolInstance;
}

