/* Every event listener wired by bindDom runs without throwing. Each listener
   now lives beside the module that owns its effect, so this test keeps the bus
   seam covered after bindDom shrank to an orchestrator. Smoke only: DOM effects
   are asserted by ui-wiring.test.js, not here. */

import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';
import { emit, EVENT } from '../../src/util/events.js';

const { A } = await loadGame();

test('every bindDom listener runs without throwing', () => {
  const t = softAssert();

  const cases = [
    [EVENT.settingsChanged, '*'],
    [EVENT.screen, null],
    [EVENT.hud, true],
    [EVENT.lives],
    [EVENT.splashRepaint],
    [EVENT.resize],
    [EVENT.state, 'play'],
    [EVENT.flash, { cat: 'info', text: 'wiring test' }],
    [EVENT.sfx, 'seal'],
    [EVENT.sfx, 'unknown-voice'], // unknown sfx name must not throw
  ];

  for (const [type, ...args] of cases){
    let threw = null;
    try { emit(type, ...args); } catch (e){ threw = e; }
    t.assert(!threw, `${String(type)} threw: ${threw && threw.message}`);
  }

  console.log(`[bind-wiring] ${cases.length} events emitted, all listeners ran`);
  t.done();
});

test('state changes keep ambience on only for shell states', () => {
  const t = softAssert();
  const shellStates = new Set(['splash', 'binder', 'clear']);
  const calls = [];
  const originalAmbience = A.Audio_.ambience;
  A.Audio_.ambience = on => calls.push(on);

  for (const state of ['splash', 'binder', 'clear', 'play', 'pause', 'dead', 'win']){
    A.STATE = state;
    emit(EVENT.state, state);
    t.assert(calls.at(-1) === shellStates.has(state),
      `${state} passed ambience ${calls.at(-1)}, expected ${shellStates.has(state)}`);
  }

  A.Audio_.ambience = originalAmbience;
  console.log('[bind-wiring] shell states keep ambience on; run states keep it off');
  t.done();
});
