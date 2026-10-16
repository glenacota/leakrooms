import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../util/rng.js';
import { hash2 } from '../../util/hash.js';

test('mulberry32 deterministic', () => {
  const a = mulberry32(0xC0FFEE)();
  const b = mulberry32(0xC0FFEE)();
  // same seed -> same first output
  const r1 = mulberry32(0xC0FFEE);
  const r2 = mulberry32(0xC0FFEE);
  assert.equal(r1(), r2());
  assert.equal(r1(), r2());
  assert.equal(r1(), r2());
});

test('mulberry32 first 3 outputs pinned', () => {
  const r = mulberry32(0xC0FFEE);
  assert.equal(r(), 0.021141508361324668);
  assert.equal(r(), 0.6661099966149777);
  assert.equal(r(), 0.7799714196007699);
});

test('hash2 stable', () => {
  assert.equal(hash2(1, 2), hash2(1, 2));
  assert.equal(hash2(0, 0), hash2(0, 0));
  assert.notEqual(hash2(1, 2), hash2(2, 1));
});