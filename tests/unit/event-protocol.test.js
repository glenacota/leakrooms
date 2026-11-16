import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';
import { EVENT, on } from '../../src/util/events.js';

await loadGame();
const { transition } = await import('../../src/game/run.js');

test('run transition emits screen, HUD, then state', () => {
  const events = [];
  const off = [
    on(EVENT.screen, value => events.push(['screen', value])),
    on(EVENT.hud, value => events.push(['hud', value])),
    on(EVENT.state, value => events.push(['state', value])),
  ];
  try {
    transition('pause');
    assert.deepEqual(events, [
      ['screen', 'pause'],
      ['hud', false],
      ['state', 'pause'],
    ]);
  } finally {
    for (const unsubscribe of off) unsubscribe();
  }
});
