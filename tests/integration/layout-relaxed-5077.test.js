import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { playLayout } from '../helpers/layout-run.js';

/* Omniscient layout run: relaxed, seed 5077. Proves the five floors fit the real clock. */
const { A, G } = await loadGame();

test('layout relaxed seed 5077: five floors inside the real clock', () => {
  const r = playLayout(A, G, 'relaxed', 5077);
  assert.equal(r.clockOuts, 0, `clock ran out ${r.clockOuts} time(s): ${r.why}`);
  assert.equal(r.walked, A.LEVELS_N, `${r.walked}/${A.LEVELS_N} floors walked out: ${r.why}`);
  assert.equal(r.sealed, r.total, `${r.sealed}/${r.total} leaks sealed`);
});
