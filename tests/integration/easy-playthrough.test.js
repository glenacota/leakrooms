import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { playLayout } from '../helpers/layout-run.js';
import { applyEasyFloor } from '../../src/game/floor.js';

const { A, G } = await loadGame();
A.setHeadless(false, false);

test('compact floors can be walked and sealed within the hard clock', () => {
  applyEasyFloor(true);
  const result = playLayout(A, G, 'hard', 4242);
  assert.equal(result.why, '');
  assert.equal(result.walked, 5);
  assert.equal(result.total, 14);
  assert.equal(result.sealed, 14);
  assert.equal(result.clockOuts, 0);
});
