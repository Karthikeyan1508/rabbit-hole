import { test } from "node:test";
import assert from "node:assert/strict";
import { locate, normalize, keyOf, independentCount } from "./verify.ts";
import { isSafeUrl, canon } from "./urlguard.ts";

const snap = normalize("VoltNest AI\n\n offers the   Battery Analytics Platform to utilities.");

test("locate finds exact and whitespace-variant quotes", () => {
  assert.deepEqual(locate(snap, "offers the Battery Analytics Platform"), [12, 49]);
  assert.ok(locate(snap, "OFFERS THE battery analytics platform"));
});

test("locate rejects fabricated or too-short quotes", () => {
  assert.equal(locate(snap, "VoltNest acquired Acme in 2024"), null);
  assert.equal(locate(snap, "AI"), null);
});

test("keys and independence", () => {
  assert.equal(keyOf("Volt-Nest AI, Inc."), "voltnestaiinc");
  assert.equal(independentCount(["a.com", "a.com", "b.com"]), 2);
});

test("url guard", () => {
  assert.ok(isSafeUrl("https://example.com/x"));
  for (const u of ["http://localhost/", "http://127.0.0.1/", "http://169.254.169.254/", "ftp://a.com", "http://10.0.0.1", "not a url"])
    assert.equal(isSafeUrl(u), false, u);
  assert.equal(isSafeUrl("https://evil.com", ["example.com"]), false);
  assert.equal(canon("https://a.com/p/?utm_source=x#h"), "https://a.com/p");
});
