import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { transition } from '../../src/game/run.js';
import { on } from '../../src/util/events.js';
import { tickCues } from '../../src/ui/hints.js';

const { G, els } = await loadGame();

const flashText = () => els['flashnote'].textContent;
const flashCat  = () => els['flashnote'].dataset.cat;

/* Reset everything that persists between tests: the once-per-run announcement
   (transition('splash') runs the same reset a new run does), the stale flash
   on screen, and a quiet floor 0 so no door-locked or floor-1 teaching cue
   fires while we are only watching the radar cue. */
function setup(){
  transition('splash');
  document.getElementById('flashnote').textContent = '';
  G.wet = 0; G.time = 0; G.atLeak = false; G.descend = 0;
  G.openLeaks = 0; G.exitTiles = [];
  G.radar = false;
}

function switchRadar(on){
  G.radar = on;
  tickCues();
}

test('[HINTS] switching the radar on flashes the loud-radar guide cue once per run', () => {
  setup();
  let emissions = 0;
  const unsub = on('flash', () => { emissions++; });
  switchRadar(true);
  assert.equal(emissions, 1, 'the first switch-on emits exactly one flash');
  assert.equal(flashText(), 'THE RADAR IS LOUD!');
  assert.equal(flashCat(), 'danger');
  unsub();
});

test('[HINTS] the radar cue does not repeat while the run continues', () => {
  setup();
  let emissions = 0;
  const unsub = on('flash', () => { emissions++; });
  switchRadar(true);
  assert.equal(emissions, 1, 'the first switch-on emits');

  switchRadar(true); switchRadar(true);   // same logic re-run
  assert.equal(emissions, 1, 'repeated switch-on does not re-emit');

  G.radar = false; switchRadar(false);   // switch it off
  switchRadar(true);                      // and back on
  assert.equal(emissions, 1, 'switching off and on again still emits once per run');
  unsub();
});

test('[HINTS] a new run resets the radar announcement', () => {
  setup();
  let emissions = 0;
  const unsub = on('flash', () => { emissions++; });
  switchRadar(true);
  assert.equal(emissions, 1, 'first run emits');

  transition('splash');   // end the run: resets once-per-run announcements
  setup();                // quiet floor again
  switchRadar(true);
  assert.equal(emissions, 2, 'a new run can announce the radar again');
  unsub();
});

test('[HINTS] the radar cue never fires when the radar stays off', () => {
  setup();
  let emissions = 0;
  const unsub = on('flash', () => { emissions++; });
  switchRadar(false);
  switchRadar(false);
  assert.equal(emissions, 0, 'no radar, no cue');
  unsub();
});
