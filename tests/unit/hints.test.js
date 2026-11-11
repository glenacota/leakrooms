import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { retryFloor, setFloorIdx, setLives, startRun, transition } from '../../src/game/run.js';
import { FLOOR, MAP_H, MAP_W, PLUMBER, SPRINT_STAMINA, WALL, WALL_OVERLAP } from '../../src/config/constants.js';
import { clearInput, keys, pad } from '../../src/sim/keys.js';
import { on } from '../../src/util/events.js';
import { tickCues } from '../../src/ui/hints.js';
import { flash, flashReset } from '../../src/ui/hud.js';

const { A, G, els } = await loadGame();

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

const staminaText = `RUNNING DRAINS ENERGY (${SPRINT_STAMINA} SEC MAX). WALK TO RECOVER`;

function prepareSprintFloor(){
  G.lifeforms = [];
  G.wantVision = false;
  clearInput();
}

function sprintStep(){
  keys.shift = true;
  keys.d = true;
  A.update(1/60);
}

test('[HINTS] stamina guide follows sprint once per floor per run, including retries', () => {
  startRun();
  prepareSprintFloor();
  const cues = [];
  const unsub = on('flash', cue => {
    if (cue.text === staminaText) cues.push(cue);
  });
  try {
    keys.shift = true;
    A.update(1/60);
    assert.equal(cues.length, 0, 'sprint without movement does not consume stamina');
    G.plumber.stamina = 0;
    keys.d = true;
    A.update(1/60);
    assert.equal(cues.length, 0, 'sprinting at zero does not consume stamina');
    G.plumber.stamina = SPRINT_STAMINA;
    sprintStep();
    assert.deepEqual(cues, [{ cat: 'guide', text: staminaText }]);
    sprintStep();
    assert.equal(cues.length, 1, 'continuous sprint does not repeat the guide');

    retryFloor();
    prepareSprintFloor();
    sprintStep();
    assert.equal(cues.length, 1, 'retrying the same floor does not repeat the guide');

    setFloorIdx(1);
    A.buildFloor(1, 4242);
    prepareSprintFloor();
    pad.x = 1;
    pad.sprint = true;
    A.update(1/60);
    assert.equal(cues.length, 2, 'touch sprint on another floor emits the guide');

    setFloorIdx(0);
    A.buildFloor(0, 4242);
    prepareSprintFloor();
    sprintStep();
    assert.equal(cues.length, 2, 'returning to an announced floor does not repeat it');

    setLives(0);
    retryFloor();
    prepareSprintFloor();
    sprintStep();
    assert.equal(cues.length, 3, 'retrying after the last life starts a new run');
  } finally {
    unsub();
    clearInput();
    flashReset();
  }
});

test('[HINTS] sprinting into a wall still emits the stamina guide', () => {
  startRun();
  prepareSprintFloor();
  let spot;
  for (let y = 1; y < MAP_H - 1 && !spot; y++){
    for (let x = 1; x < MAP_W - 1; x++){
      if (G.grid[y * MAP_W + x] === FLOOR && G.grid[y * MAP_W + x + 1] === WALL){
        spot = [x + 1 - (PLUMBER.RADIUS - WALL_OVERLAP) - 0.001, y + 0.5];
        break;
      }
    }
  }
  assert.ok(spot, 'floor has a walkable tile beside a wall');
  [G.plumber.x, G.plumber.y] = spot;
  let emitted = 0;
  const unsub = on('flash', cue => { if (cue.text === staminaText) emitted++; });
  try {
    sprintStep();
    assert.equal(G.plumber.x, spot[0], 'wall blocks the plumber');
    assert.ok(G.plumber.stamina < SPRINT_STAMINA);
    assert.equal(emitted, 1);
  } finally {
    unsub();
    clearInput();
    flashReset();
  }
});

test('[HINTS] danger takes priority over the stamina guide', () => {
  startRun();
  prepareSprintFloor();
  const oldSetTimeout = global.setTimeout;
  const oldClearTimeout = global.clearTimeout;
  const timers = new Map();
  let nextTimer = 0;
  flashReset();
  global.setTimeout = fn => { const id = ++nextTimer; timers.set(id, fn); return id; };
  global.clearTimeout = id => timers.delete(id);
  try {
    flash({ cat: 'danger', text: 'DANGER' });
    sprintStep();
    assert.equal(flashText(), 'DANGER');
    assert.equal(flashCat(), 'danger');
    const [id, done] = timers.entries().next().value;
    timers.delete(id);
    done();
    assert.equal(flashText(), staminaText);
    assert.equal(flashCat(), 'guide');
  } finally {
    flashReset();
    global.setTimeout = oldSetTimeout;
    global.clearTimeout = oldClearTimeout;
    clearInput();
  }
});
