import test from 'node:test';
import assert from 'node:assert/strict';
import { LEADERBOARD_KEY } from '../../src/settings/leaderboard-store.js';
import { loadGame } from '../helpers/harness.js';

await loadGame();

const el = id => document.getElementById(id);

function fakeTimers(t){
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timers = new Map();
  let nextId = 0;
  global.setTimeout = (fn, delay) => {
    const id = ++nextId;
    timers.set(id, { fn, delay });
    return id;
  };
  global.clearTimeout = id => timers.delete(id);
  t.after(() => {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  });
  return timers;
}

function openBoard(){
  el('menu-leaderboard').click();
  return el('btn-clear-leaderboard');
}

test('leaderboard clear requires a second click before timeout', t => {
  const timers = fakeTimers(t);
  global.__store.clear();
  global.__store.set(LEADERBOARD_KEY, JSON.stringify([{
    terms:'NORMAL', total:100, status:'COMPLETED', elapsedSeconds:12,
    timestamp:'2026-01-01T00:00:00.000Z',
  }]));
  const button = openBoard();

  button.click();
  assert.equal(button.textContent, 'TAP AGAIN — CLEARS RECORDS');
  assert.ok(global.__store.has(LEADERBOARD_KEY), 'first click cleared saved records');
  assert.equal([...timers.values()][0].delay, 5000);

  button.click();
  assert.equal(button.textContent, 'CLEAR LOCAL RECORDS');
  assert.equal(global.__store.has(LEADERBOARD_KEY), false);
  assert.equal(el('leaderboard-message').textContent, 'Local records cleared.');
  el('btn-leaderboard-back').click();
});

test('leaderboard clear disarms on timeout, term change, and leaving the board', t => {
  const timers = fakeTimers(t);
  global.__store.clear();
  global.__store.set(LEADERBOARD_KEY, JSON.stringify([{
    terms:'NORMAL', total:100, status:'COMPLETED', elapsedSeconds:12,
    timestamp:'2026-01-01T00:00:00.000Z',
  }]));
  const button = openBoard();

  button.click();
  const [timerId, timer] = timers.entries().next().value;
  assert.equal(timer.delay, 5000);
  timers.delete(timerId);
  timer.fn();
  assert.equal(button.textContent, 'CLEAR LOCAL RECORDS');
  assert.ok(global.__store.has(LEADERBOARD_KEY), 'timeout cleared saved records');

  button.click();
  el('leaderboard-hard').click();
  assert.equal(button.textContent, 'CLEAR LOCAL RECORDS');
  assert.equal(timers.size, 0);

  button.click();
  el('btn-leaderboard-back').click();
  assert.equal(button.textContent, 'CLEAR LOCAL RECORDS');
  assert.equal(timers.size, 0);
  assert.ok(global.__store.has(LEADERBOARD_KEY), 'leaving the board cleared saved records');
});
