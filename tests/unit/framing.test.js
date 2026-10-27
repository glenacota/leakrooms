/* Framing: how many tiles fit across and down the viewport. viewScale() is pure
   (no DOM, no state) so it can be tested without a run; canvas.js installs a
   DOM stub at module load, which loadGame() provides. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';

/* loadGame() installs the DOM stubs canvas.js needs at module load time. */
await loadGame();
const { viewScale } = await import('../../src/render/canvas.js');

const VIEW_T = 27;
const TILE = 40;
const VIEW_ROWS_MIN = 12;

test('[FRAMING] viewScale is width-limited on normal screens (equals the old value)', () => {
  assert.equal(viewScale(1920, 1080), 1920 / (VIEW_T * TILE));
  assert.equal(viewScale(1280, 720), 1280 / (VIEW_T * TILE));
  assert.equal(viewScale(1624, 750), 1624 / (VIEW_T * TILE));
});

test('[FRAMING] viewScale is row-limited on a short screen', () => {
  assert.equal(viewScale(1624, 670), 670 / (VIEW_ROWS_MIN * TILE));
});

test('[FRAMING] a 3:1 canvas is bounded by the row floor, not the width', () => {
  assert.equal(viewScale(1080, 360), 360 / (VIEW_ROWS_MIN * TILE));
  assert.equal(viewScale(2160, 720), 720 / (VIEW_ROWS_MIN * TILE));
});
