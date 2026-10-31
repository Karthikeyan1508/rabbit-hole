import { test } from "node:test";
import assert from "node:assert/strict";
import { isDue } from "./due.ts";

test("isDue", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  assert.equal(isDue(null, 24, now), true);
  assert.equal(isDue("2026-10-29T11:00:00Z", 24, now), false);
  assert.equal(isDue("2026-10-28T11:00:00Z", 24, now), true);
  assert.equal(isDue(null, 0, now), false); // 0 = monitoring off
});
