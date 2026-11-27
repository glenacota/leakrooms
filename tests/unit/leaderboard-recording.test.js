import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT, emit } from '../../src/util/events.js';
import { LEADERBOARD_KEY } from '../../src/settings/leaderboard-store.js';
import { loadGame } from '../helpers/harness.js';

await loadGame();

test('only terminal win and loss events save leaderboard results', () => {
  global.__store.clear();

  const won = {
    sealed:12, deaths:0, floors:5, time:300, terms:'NORMAL', parTime:900,
    runHistory:[],
  };
  emit(EVENT.win, won);

  const failed = {
    sealed:3, deaths:3, floors:1, time:400, terms:'HARD', parTime:900,
    runHistory:[],
  };
  emit(EVENT.dead, { lives:1, cause:'caught', report:failed });
  let records = JSON.parse(global.__store.get(LEADERBOARD_KEY));
  assert.equal(records.length, 1, 'non-terminal death was recorded');

  emit(EVENT.dead, { lives:0, cause:'caught', report:failed });
  records = JSON.parse(global.__store.get(LEADERBOARD_KEY));
  assert.deepEqual(records.map(({ terms, total, status, elapsedSeconds }) =>
    ({ terms, total, status, elapsedSeconds })), [
    { terms:'NORMAL', total:1650, status:'COMPLETED', elapsedSeconds:300 },
    { terms:'HARD', total:-450, status:'FAILED', elapsedSeconds:400 },
  ]);
  assert.ok(records.every(record => Number.isFinite(Date.parse(record.timestamp))),
    'terminal result has invalid timestamp');
});
