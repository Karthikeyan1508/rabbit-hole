import { test } from "node:test";
import assert from "node:assert/strict";
import { keyring } from "./keyring.ts";

test("keys rotate on failure and recover after the cooldown", () => {
  process.env.T_KEYS = "a, b ,c";
  process.env.T_KEY = "b";
  const r = keyring("T_KEYS", "T_KEY");
  assert.deepEqual(r.all(), ["a", "b", "c"]); // merged, de-duplicated, trimmed
  const t0 = 1_000_000;
  assert.equal(r.ordered(t0)[0], "a");
  r.bad("a", 60_000, t0);
  assert.deepEqual(r.ordered(t0 + 1), ["b", "c", "a"]);
  r.bad("b", 10_000, t0);
  r.bad("c", 30_000, t0);
  assert.deepEqual(r.ordered(t0 + 1), ["b", "c", "a"]); // all cooling: soonest recovery first
  assert.equal(r.ordered(t0 + 20_000)[0], "b"); // b is usable again
  assert.deepEqual(r.ordered(t0 + 61_000), ["a", "b", "c"]);
});
