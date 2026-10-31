import { test } from "node:test";
import assert from "node:assert/strict";
import { confidence, scoreSource } from "./quality.ts";

test("source kinds", () => {
  const s = ["TinyFish"];
  assert.equal(scoreSource("https://www.tinyfish.ai/about", s).kind, "first-party");
  assert.equal(scoreSource("https://www.instagram.com/p/abc", s).kind, "social");
  assert.equal(scoreSource("https://www.iimjobs.com/j/x", s).kind, "jobs");
  assert.equal(scoreSource("https://www.tinyfish.ai/careers/eng", s).kind, "jobs");
  assert.equal(scoreSource("https://www.cbinsights.com/company/tiny-fish", s).kind, "directory");
  assert.equal(scoreSource("https://techcrunch.com/2026/01/a", s).kind, "news");
  assert.equal(scoreSource("https://example.org/post", s).kind, "web");
});

test("confidence rewards independent corroboration", () => {
  assert.equal(confidence([0.2], 1).label, "Low");
  assert.equal(confidence([0.6], 1).label, "Medium");
  assert.equal(confidence([0.7], 1).label, "Medium");
  assert.equal(confidence([0.7], 2).label, "High");
  assert.ok(confidence([0.95], 3).value <= 0.99);
});
