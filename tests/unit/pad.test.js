import test from 'node:test';
import assert from 'node:assert/strict';
import { keys, pad, clearInput } from '../../src/sim/keys.js';

test('[INPUT] pad starts zeroed', () => {
  assert.deepEqual({ ...pad }, { x: 0, y: 0, sprint: false });
});

test('[INPUT] clearInput empties keys and zeroes the pad', () => {
  keys.w = true; keys.shift = true; keys.a = false;
  pad.x = 0.5; pad.y = -1; pad.sprint = true;
  clearInput();
  assert.deepEqual(Object.keys(keys), [], 'keys still hold entries');
  assert.deepEqual({ ...pad }, { x: 0, y: 0, sprint: false });
});

test('[INPUT] a second clearInput changes nothing', () => {
  clearInput();
  clearInput();
  assert.deepEqual(Object.keys(keys), []);
  assert.deepEqual({ ...pad }, { x: 0, y: 0, sprint: false });
});
