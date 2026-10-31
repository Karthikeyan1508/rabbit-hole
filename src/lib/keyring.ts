// Several API keys behind one name: set FOO_API_KEYS=k1,k2,k3 (the single FOO_API_KEY still works, and both are merged).
// A key that hits a rate limit or auth error "cools down" and the next key is tried at once.
const cooling = new Map<string, number>(); // key -> epoch ms when it may be used again

export function keyring(plural: string, single: string) {
  const all = () => [...new Set(`${process.env[plural] ?? ""},${process.env[single] ?? ""}`.split(/[\s,]+/).filter(Boolean))];
  const ready = (k: string, now = Date.now()) => (cooling.get(k) ?? 0) <= now;
  return {
    all,
    ready,
    /** Usable keys first (in the order given), then the ones that recover soonest. */
    ordered: (now = Date.now()) => {
      const ks = all();
      return [...ks.filter(k => ready(k, now)), ...ks.filter(k => !ready(k, now)).sort((a, b) => cooling.get(a)! - cooling.get(b)!)];
    },
    bad: (key: string, ms: number, now = Date.now()) => void cooling.set(key, now + ms),
  };
}
