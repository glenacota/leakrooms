import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDeath, CAUGHT_TILES } from '../helpers/player-bot.js';

/* The cause of a player-run death. The bot's runs are reported, not gated, so
   a wrong label here would mislead a diagnosis without failing anything. */

const frame = (d, state = 'HUNT') => ({ state, d, inView: false });

test('a lifeform within the catch distance is a catch, even on the clock', () => {
  const death = { clockOut: true, recent: [frame(9), frame(CAUGHT_TILES)] };
  assert.equal(classifyDeath(death), 'caught');
});

test('a clock-out with no lifeform close is a clock death', () => {
  const death = { clockOut: true, recent: [frame(12, 'WALK'), frame(11, 'WALK')] };
  assert.equal(classifyDeath(death), 'clock');
});

test('no lifeform close and not the clock is unexplained', () => {
  const death = { clockOut: false, recent: [frame(30, 'WALK')] };
  assert.equal(classifyDeath(death), 'unexplained');
});

test('an empty history is unexplained, not a catch', () => {
  assert.equal(classifyDeath({ clockOut: false, recent: [] }), 'unexplained');
});

test('a lifeform just past the catch distance is not a catch', () => {
  const death = { clockOut: false, recent: [frame(CAUGHT_TILES + 0.01)] };
  assert.equal(classifyDeath(death), 'unexplained');
});
