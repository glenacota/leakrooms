import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { pad, keys } from '../../src/sim/keys.js';
import { transition } from '../../src/game/run.js';
import { emit, on } from '../../src/util/events.js';
import { bindRotate } from '../../src/ui/touch.js';
import { readCss, readHtml } from '../helpers/src-text.js';
import fs from 'node:fs';

const { A, G } = await loadGame();

/* The harness has no <html>, and no window size. The touch layer reads both. */
document.documentElement = { dataset: {} };
window.innerWidth = 1000;
window.innerHeight = 600;                // radius = 600 * 0.11 = 66 px

const layer = document.getElementById('touch');
const ring = document.getElementById('touch-ring');
const fire = (type, ev) => layer._fire(type, ev);

const button = name => ({ dataset: { touch: name }, classList: { add(){}, remove(){} } });
const ev = (id, x, y, extra = {}) => ({
  pointerId: id, pointerType: 'touch', clientX: x, clientY: y,
  target: layer, preventDefault(){}, ...extra,
});
const mode = () => document.documentElement.dataset.input;
const zero = () => pad.x === 0 && pad.y === 0 && pad.sprint === false;

/* A run in progress, in touch mode, with nobody touching anything. */
function startTouchRun(){
  A.buildFloor(0, 4242);
  emit('input:mode', 'touch');
  transition('play');
  assert.equal(layer.hidden, false, 'the layer did not show for touch mode in play');
}

/* The harness had no <html> at boot, so nothing was written to dataset yet. */
test('[TOUCH] the layer starts hidden', () => {
  assert.equal(layer.hidden, true);
  assert.equal(ring.hidden, true);
});

test('[TOUCH] the stick writes pad and zeroes it on release', () => {
  startTouchRun();
  fire('pointerdown', ev(1, 200, 300));
  assert.equal(ring.hidden, false, 'no ring under the thumb');
  assert.ok(zero(), 'pad moved before the thumb did');

  // Half the radius to the right: rescaled past the dead zone, no sprint.
  fire('pointermove', ev(1, 200 + 33, 300));
  assert.ok(pad.x > 0 && pad.x < 1 && pad.y === 0, `pad is ${pad.x},${pad.y}`);
  assert.equal(pad.sprint, false);

  // Straight down is +y, the same sign as the S key.
  fire('pointermove', ev(1, 200, 300 + 40));
  assert.ok(pad.y > 0 && pad.x === 0, `pad is ${pad.x},${pad.y}`);

  // Past the sprint line, then back to 0.85 of the radius: the latch holds.
  fire('pointermove', ev(1, 200 + 66, 300));
  assert.equal(pad.sprint, true);
  assert.ok(Math.abs(pad.x - 1) < 1e-9);
  fire('pointermove', ev(1, 200 + 56, 300));
  assert.equal(pad.sprint, true, 'the sprint latch dropped at 0.85');

  fire('pointerup', ev(1, 200, 300));
  assert.ok(zero());
  assert.equal(ring.hidden, true);
});

test('[TOUCH] the right half does not start a stick', () => {
  startTouchRun();
  fire('pointerdown', ev(1, 800, 300));
  assert.equal(ring.hidden, true);
  fire('pointermove', ev(1, 860, 300));
  assert.ok(zero());
});

test('[TOUCH] pointercancel and input:lost zero the pad and hide the ring', () => {
  startTouchRun();
  fire('pointerdown', ev(1, 200, 300));
  fire('pointermove', ev(1, 266, 300));
  assert.ok(!zero());
  fire('pointercancel', ev(1, 266, 300));
  assert.ok(zero());
  assert.equal(ring.hidden, true);

  fire('pointerdown', ev(2, 200, 300));
  fire('pointermove', ev(2, 266, 300));
  assert.ok(!zero());
  emit('input:lost');
  assert.ok(zero());
  assert.equal(ring.hidden, true);
  // The old finger is forgotten: its move does nothing, a new one works.
  fire('pointermove', ev(2, 266, 300));
  assert.ok(zero());
  fire('pointerdown', ev(3, 200, 300));
  fire('pointermove', ev(3, 200, 330));
  assert.ok(pad.y > 0);
  fire('pointerup', ev(3, 200, 330));
});

test('[TOUCH] window blur drops the stick too', () => {
  startTouchRun();
  fire('pointerdown', ev(1, 200, 300));
  fire('pointermove', ev(1, 266, 300));
  global.window._h.blur();
  assert.ok(zero());
  assert.equal(ring.hidden, true);
  // blur paused the run; put it back for the next test
  transition('play');
});

test('[TOUCH] a second finger on the stick half is ignored', () => {
  startTouchRun();
  fire('pointerdown', ev(1, 200, 300));
  fire('pointerdown', ev(2, 100, 100));
  fire('pointermove', ev(2, 160, 100));         // would be +x from finger 2
  assert.ok(zero(), 'the second finger moved the stick');
  fire('pointermove', ev(1, 200, 300 + 40));
  assert.ok(pad.y > 0 && pad.x === 0, 'the first finger stopped driving the stick');
  fire('pointerup', ev(2, 160, 100));            // the stranger lifting changes nothing
  assert.ok(pad.y > 0);
  fire('pointerup', ev(1, 200, 340));
  assert.ok(zero());
});

test('[TOUCH] a button press does not disturb the stick, and the stick works after', () => {
  startTouchRun();
  fire('pointerdown', ev(1, 200, 300));
  fire('pointermove', ev(1, 200, 340));
  const before = { x: pad.x, y: pad.y, sprint: pad.sprint };

  fire('pointerdown', ev(2, 900, 500, { target: button('radar') }));
  assert.deepEqual({ x: pad.x, y: pad.y, sprint: pad.sprint }, before);
  // The button finger sliding left across the stick half must not become the stick.
  fire('pointermove', ev(2, 100, 500));
  assert.deepEqual({ x: pad.x, y: pad.y, sprint: pad.sprint }, before);
  fire('pointerup', ev(2, 100, 500));
  assert.deepEqual({ x: pad.x, y: pad.y, sprint: pad.sprint }, before);

  fire('pointermove', ev(1, 200, 320));
  assert.ok(pad.y > 0 && pad.y < before.y, 'the stick did not follow after the button lifted');
  fire('pointerup', ev(1, 200, 320));

  // And a stick finger landing on a button area goes to the button, not the stick.
  fire('pointerdown', ev(3, 100, 100, { target: button('pause') }));
  assert.equal(ring.hidden, true, 'a finger on a button started a stick');
  transition('play');
});

test('[TOUCH] the radar button toggles G.radar through toggleRadar', () => {
  startTouchRun();
  G.batt = 100; G.radar = false;
  fire('pointerdown', ev(1, 900, 500, { target: button('radar') }));
  assert.equal(G.radar, true);
  fire('pointerup', ev(1, 900, 500));
  fire('pointerdown', ev(1, 900, 500, { target: button('radar') }));
  assert.equal(G.radar, false);
  fire('pointerup', ev(1, 900, 500));

  G.batt = 0;
  fire('pointerdown', ev(1, 900, 500, { target: button('radar') }));
  assert.equal(G.radar, false);
  assert.equal(document.getElementById('flashnote').textContent, 'NO POWER — THE RADAR IS DEAD');
  fire('pointerup', ev(1, 900, 500));
});

test('[TOUCH] the pause button pauses, and the layer goes away', () => {
  startTouchRun();
  fire('pointerdown', ev(1, 900, 100, { target: button('pause') }));
  assert.equal(A.STATE, 'pause');
  assert.equal(layer.hidden, true);
  transition('play');
});

test('[TOUCH] the layer is hidden outside play and the pad is zeroed on the way out', () => {
  startTouchRun();
  fire('pointerdown', ev(1, 200, 300));
  fire('pointermove', ev(1, 266, 300));
  assert.ok(!zero());
  transition('pause');
  assert.equal(layer.hidden, true);
  assert.ok(zero());
  assert.equal(ring.hidden, true);
  // A touch while hidden does nothing.
  fire('pointerdown', ev(2, 200, 300));
  assert.equal(ring.hidden, true);
  transition('play');
  assert.equal(layer.hidden, false);
});

test('[TOUCH] a keydown flips the mode back to keyboard and keeps the key', () => {
  startTouchRun();
  assert.equal(mode(), 'touch');
  global.window._h.keydown({ key: 'w', code: 'KeyW', preventDefault(){} });
  assert.equal(mode(), 'kbm');
  assert.equal(layer.hidden, true);
  assert.equal(keys['w'], true, 'the key that switched modes was lost');
  keys['w'] = false;

  // A touch brings it back.
  fire('pointerdown', ev(1, 200, 300));       // layer hidden: this one only switches mode
  assert.equal(mode(), 'touch');
  assert.equal(layer.hidden, false);
});

test('[TOUCH] a mouse press on the layer flips the mode to keyboard', () => {
  startTouchRun();
  fire('pointerdown', ev(1, 200, 300, { pointerType: 'mouse' }));
  assert.equal(mode(), 'kbm');
  assert.equal(layer.hidden, true);
  assert.ok(zero());
});

test('[TOUCH] the long-press menu is blocked on the layer', () => {
  let blocked = false;
  fire('contextmenu', { preventDefault(){ blocked = true; } });
  assert.equal(blocked, true);
});

test('[TOUCH] the stick side follows the setting, live, and the radar goes opposite', async () => {
  const { setOption, resetSettings } = await import('../../src/settings/store.js');
  startTouchRun();
  // Left (the default): a finger on the right half does not start a stick.
  fire('pointerdown', ev(1, 800, 300));
  assert.equal(ring.hidden, true);
  assert.equal(layer.dataset.side, 'left');

  // A finger that is down when the side changes is released.
  fire('pointerdown', ev(2, 200, 300));
  fire('pointermove', ev(2, 266, 300));
  assert.ok(!zero());
  setOption('touchSide', 'right');
  assert.ok(zero());
  assert.equal(ring.hidden, true);
  assert.equal(layer.dataset.side, 'right');

  // Right: the right half works, the left half does not.
  fire('pointerdown', ev(3, 200, 300));
  assert.equal(ring.hidden, true);
  fire('pointerdown', ev(4, 800, 300));
  assert.equal(ring.hidden, false);
  fire('pointermove', ev(4, 800, 340));
  assert.ok(pad.y > 0);
  fire('pointerup', ev(4, 800, 340));

  resetSettings();
  assert.equal(layer.dataset.side, 'left');
});

test('[TOUCH] portrait shows the rotate card, pauses the run once, and rotating back does not resume', () => {
  // The card and its media query ship.
  assert.ok(/id="rotate"/.test(readHtml()), 'no #rotate card in the markup');
  const css = fs.readFileSync(new URL('../../css/touch.css', import.meta.url), 'utf8');
  assert.ok(/@media\s*\(orientation:\s*portrait\)\s*and\s*\(pointer:\s*coarse\)\s*\{\s*#rotate\s*\{\s*display:\s*flex/.test(css),
    'the card is not shown by a portrait + coarse query');
  assert.ok(/#rotate\s*\{[^}]*z-index:\s*30/.test(css), 'the card is not above the screens');

  const mq = { matches: false, fns: [], addEventListener(t, f){ this.fns.push(f); },
    set(v){ this.matches = v; for (const f of this.fns) f({ matches: v }); } };
  bindRotate(mq);
  assert.equal(mq.fns.length, 1);

  startTouchRun();
  let changes = 0;
  const off = on('state', () => { changes++; });
  mq.set(true);                          // turned upright
  assert.equal(A.STATE, 'pause');
  assert.equal(changes, 1, 'the run was not paused exactly once');
  mq.set(true);                          // a second event while upright must not toggle again
  assert.equal(A.STATE, 'pause');
  mq.set(false);                         // turned back sideways
  assert.equal(A.STATE, 'pause', 'rotating back resumed the run on its own');
  assert.equal(changes, 1);
  off();

  // Upright outside a run does nothing.
  transition('splash');
  mq.set(true);
  assert.equal(A.STATE, 'splash');
  // A query list that cannot listen is ignored, not an error.
  assert.doesNotThrow(() => { bindRotate(null); bindRotate({}); });
});
