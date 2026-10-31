import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeUrl, canonicalizeUrl, calculateSourceScore } from '../src/lib/url-safety.ts';
import { findQuoteOffsets, normalizeWhitespace } from '../src/lib/pipeline.ts';
import { KeyPool } from '../src/lib/key-rotation.ts';

test('URL Safety Guard rejects invalid and private addresses', () => {
  // Reject non-http/https
  assert.equal(isSafeUrl('ftp://example.com'), false);
  assert.equal(isSafeUrl('javascript:alert(1)'), false);

  // Reject localhost & local domains
  assert.equal(isSafeUrl('http://localhost'), false);
  assert.equal(isSafeUrl('http://localhost:3000'), false);
  assert.equal(isSafeUrl('http://sub.localhost'), false);
  assert.equal(isSafeUrl('http://service.local'), false);
  assert.equal(isSafeUrl('http://api.internal'), false);

  // Reject private IPv4
  assert.equal(isSafeUrl('http://127.0.0.1'), false);
  assert.equal(isSafeUrl('http://10.0.1.5:8080'), false);
  assert.equal(isSafeUrl('http://192.168.1.1'), false);
  assert.equal(isSafeUrl('http://172.16.0.2'), false);

  // Reject private IPv6
  assert.equal(isSafeUrl('http://[::1]'), false);
  assert.equal(isSafeUrl('http://[fe80::1]'), false);

  // Accept safe public URLs
  assert.equal(isSafeUrl('https://stripe.com/about'), true);
  assert.equal(isSafeUrl('https://news.ycombinator.com'), true);
  assert.equal(isSafeUrl('http://example.com:80'), true);

  // Allowed domains filtering
  assert.equal(isSafeUrl('https://stripe.com', { allowedDomains: ['stripe.com'] }), true);
  assert.equal(isSafeUrl('https://other.com', { allowedDomains: ['stripe.com'] }), false);
});

test('Canonical URL removes tracking params and fragments', () => {
  const dirty = 'https://example.com/article?utm_source=twitter&foo=bar&utm_medium=social#heading-1';
  const clean = canonicalizeUrl(dirty);
  assert.equal(clean, 'https://example.com/article?foo=bar');

  // Trailing slash normalization
  assert.equal(canonicalizeUrl('https://example.com/'), 'https://example.com');
});

test('Source quality scoring distinguishes publisher types', () => {
  assert.equal(calculateSourceScore('https://stripe.com/news', 'stripe.com'), 0.95);
  assert.equal(calculateSourceScore('https://sec.gov/edgar/data'), 0.85);
  assert.equal(calculateSourceScore('https://stanford.edu/paper.pdf'), 0.85);
  assert.equal(calculateSourceScore('https://reuters.com/business/tech'), 0.7);
  assert.equal(calculateSourceScore('https://techcrunch.com/article'), 0.7);
  assert.equal(calculateSourceScore('https://crunchbase.com/org/stripe'), 0.6);
  assert.equal(calculateSourceScore('https://randomblog.org/post'), 0.5);
  assert.equal(calculateSourceScore('https://twitter.com/ceo/status/123'), 0.2);
  assert.equal(calculateSourceScore('https://greenhouse.io/jobs/123'), 0.25);
});

test('Quote verification: exact and whitespace quotes accepted, fabricated rejected', () => {
  const sourceText = `RabbitHole was conceived in October 2026 to turn fragmented claims
  into a rigorous, verified evidence graph. The founding team announced the initial beta on November 1.`;

  // 1. Exact quote accepted
  const exact = findQuoteOffsets('RabbitHole was conceived in October 2026', sourceText);
  assert.equal(exact.found, true);
  assert.equal(exact.exact, true);
  assert.ok(exact.startOffset >= 0);

  // 2. Whitespace quote accepted
  const whitespaceQuote = 'conceived   in \n October 2026';
  const wsResult = findQuoteOffsets(whitespaceQuote, sourceText);
  assert.equal(wsResult.found, true);

  // 3. Fabricated quote rejected
  const fabricated = 'RabbitHole raised $500M in Series D from Softbank';
  const fabResult = findQuoteOffsets(fabricated, sourceText);
  assert.equal(fabResult.found, false);

  // 4. Too short quote (< 8 chars) rejected
  const shortQuote = 'Rabbit';
  const shortResult = findQuoteOffsets(shortQuote, sourceText);
  assert.equal(shortResult.found, false);
});

test('Key rotation with cooldown and failure recovery', () => {
  const pool = new KeyPool(['key1', 'key2', 'key3'], { cooldownMs: 1000 });

  assert.equal(pool.count, 3);
  const first = pool.getKey();
  assert.equal(first, 'key1');

  // Mark key1 failed
  pool.markFailed('key1');

  // Next key should not be key1
  const second = pool.getKey();
  assert.equal(second, 'key2');

  const third = pool.getKey();
  assert.equal(third, 'key3');

  // Next one should cycle to key2 because key1 is still in cooldown
  const fourth = pool.getKey();
  assert.equal(fourth, 'key2');

  // Mark key1 success (or clear cooldown)
  pool.markSuccess('key1');
});

