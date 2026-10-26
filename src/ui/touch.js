/* ============================================================
   THE TOUCH LAYER
   A floating stick on the left half of the screen, a radar button and a pause
   button. The stick writes to `pad` (sim/keys.js), which tickMovement reads
   next to the keys; the buttons call the same functions the keys call.

   Everything is Pointer Events on the #touch element. There are no window
   listeners here on purpose: input.js owns the window ones, and the test
   harness keeps only one handler per window event type.

   Input mode ('touch' or 'kbm') lives on <html data-input>. The layer shows
   only in touch mode during a run. Add ?input=touch to the URL to force touch
   mode on a desktop browser (use Chromium touch emulation to drive it). A
   forced mode is not switched off by a key or a mouse click, or the layer would
   vanish the first time the tester pressed ESC.
   ============================================================ */
import { STICK } from '../config/constants.js';
import { STATE } from '../game/run.js';
import { SETTINGS } from '../settings/store.js';
import { pad } from '../sim/keys.js';
import { on } from '../util/events.js';
import { stickMap, sprintThresholds } from '../util/stick.js';
import { toggleRadar } from './input.js';
import { togglePause } from './pause.js';
import { toggleFullscreen } from './fullscreen.js';

/* Which half of the screen the stick lives on. It is a setting; the buttons sit
   on the other side. */
const stickSide = () => SETTINGS.touchSide === 'right' ? 'right' : 'left';

let mode = 'kbm';
let forced = false;
let layer = null, ring = null, knob = null;

let stick = null;                 // { id, ox, oy } while a finger drives the stick
const held = new Map();           // pointerId -> { name, el } for fingers on a button

const root = () => document.documentElement;
const visible = () => mode === 'touch' && STATE === 'play';

/* Pixels. A fraction of the short side, so the stick feels the same in portrait
   and landscape, kept inside a range a thumb can use. */
function stickRadius(){
  const short = Math.min(window.innerWidth || 0, window.innerHeight || 0);
  return Math.max(STICK.RADIUS_MIN, Math.min(STICK.RADIUS_MAX, short * STICK.RADIUS_VMIN));
}

function onStickSide(x){
  const half = (window.innerWidth || 0) / 2;
  return stickSide() === 'left' ? x < half : x >= half;
}

/* The control under a finger, by walking up from the event target. A pointer
   that is captured reports the layer as its target, so this is only used on
   pointerdown. */
function controlAt(target){
  for (let n = target; n && n !== layer; n = n.parentNode){
    if (n.dataset && n.dataset.touch) return { name: n.dataset.touch, el: n };
  }
  return null;
}

/* Only the stick state is zeroed here, never the keys. A key press that flips
   the mode to keyboard calls this, and the key it carries must survive. */
function zeroPad(){ pad.x = 0; pad.y = 0; pad.sprint = false; }

/* Where the sprint line is, for the dashed marker in css/touch.css. It is the
   `on` threshold of the SPRINT PUSH preset, as a fraction of the ring's size. */
function paintSprintAt(){
  if (ring && ring.style && ring.style.setProperty)
    ring.style.setProperty('--sprint-at', String(sprintThresholds(SETTINGS.sprintPush).on));
}

function setSprintClass(on){
  ring.classList.toggle('sprint', on);
  ring.classList.toggle('sprinting', on);
}

function releaseStick(){
  stick = null;
  zeroPad();
  if (ring){ ring.hidden = true; setSprintClass(false); }
}

function releaseAll(){
  releaseStick();
  for (const c of held.values()) if (c.el.classList) c.el.classList.remove('down');
  held.clear();
}

/* Tells the stylesheet which side the stick is on, so the radar button can sit
   on the other one. Read again on every state change as well, because the saved
   setting is loaded after initTouch() runs. */
function layout(){
  if (layer && layer.dataset) layer.dataset.side = stickSide();
}

function refresh(){
  layout();
  const show = visible();
  if (layer) layer.hidden = !show;
  if (!show) releaseAll();
}

function setMode(next){
  if (next !== 'touch' && next !== 'kbm') return;
  if (forced && next !== 'touch') return;
  const changed = next !== mode;
  mode = next;
  if (root() && root().dataset) root().dataset.input = mode;
  if (changed) refresh();
}

function capture(e){
  /* Capture keeps the move and up events coming to the layer when the thumb
     slides over a button or off the screen edge. It throws for a pointer that
     is already gone, which is not worth a crash. */
  try { if (layer.setPointerCapture) layer.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
}

function onDown(e){
  if (e.pointerType === 'mouse'){ setMode('kbm'); return; }
  if (e.pointerType === 'touch') setMode('touch');
  if (!visible()) return;
  if (e.preventDefault) e.preventDefault();

  const c = controlAt(e.target);
  if (c){
    /* The fullscreen glyph acts on click (see initTouch), because the browser
       only allows fullscreen from a finished tap. Nothing is captured, so the
       click can reach it. */
    if (c.name === 'fullscreen') return;
    /* A finger that lands on a button belongs to that button until it lifts. It
       never becomes the stick. */
    if (held.has(e.pointerId)) return;
    held.set(e.pointerId, c);
    if (c.el.classList) c.el.classList.add('down');
    capture(e);
    if (c.name === 'radar') toggleRadar();
    else if (c.name === 'pause') togglePause();
    return;
  }

  // One stick finger at a time, and only on the stick side.
  if (stick || !onStickSide(e.clientX)) return;
  stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
  capture(e);
  const r = stickRadius();
  ring.style.left = e.clientX + 'px';
  ring.style.top = e.clientY + 'px';
  ring.style.width = ring.style.height = (2 * r) + 'px';
  knob.style.transform = 'translate(0px,0px)';
  paintSprintAt();
  ring.hidden = false;
}

function onMove(e){
  if (!stick || e.pointerId !== stick.id) return;
  const dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
  const r = stickRadius();
  const s = stickMap(dx, dy, r, pad.sprint, SETTINGS.sprintPush);
  pad.x = s.x; pad.y = s.y; pad.sprint = s.sprint;

  // The knob follows the thumb but stops at the ring.
  const len = Math.hypot(dx, dy);
  const k = len > r ? r / len : 1;
  knob.style.transform = `translate(${dx * k}px,${dy * k}px)`;
  setSprintClass(s.sprint);
}

function onUp(e){
  if (stick && e.pointerId === stick.id) releaseStick();
  const c = held.get(e.pointerId);
  if (c){
    if (c.el.classList) c.el.classList.remove('down');
    held.delete(e.pointerId);
  }
}

/* The rotate card (#rotate, shown by css/touch.css) covers the game while a touch
   device is held upright. Here the run is paused when that begins. Only the
   change INTO portrait pauses, and nothing resumes: the player taps RESUME on
   the pause screen once the phone is back sideways. `mq` is a MediaQueryList for
   the portrait-and-coarse query; it is a parameter so a test can drive it. */
export function bindRotate(mq){
  if (!mq || typeof mq.addEventListener !== 'function') return;
  const onChange = e => { if (e.matches && STATE === 'play') togglePause(); };
  mq.addEventListener('change', onChange);
  // Already upright at load: nothing is playing yet, so there is nothing to pause.
}

// Wires the layer. Called once from boot().
export function initTouch(){
  layer = document.getElementById('touch');
  ring = document.getElementById('touch-ring');
  knob = document.getElementById('touch-knob');
  if (!layer || !ring || !knob) return;

  layer.addEventListener('pointerdown', onDown);
  layer.addEventListener('pointermove', onMove);
  layer.addEventListener('pointerup', onUp);
  layer.addEventListener('pointercancel', onUp);
  layer.addEventListener('click', e => {
    const c = controlAt(e.target);
    if (c && c.name === 'fullscreen') toggleFullscreen();
  });
  // A long press must not open the browser menu over the controls.
  layer.addEventListener('contextmenu', e => { if (e.preventDefault) e.preventDefault(); });

  /* Before a layer exists a touch cannot reach it, so the first touch is seen
     on the document. A pointer that arrives while the layer is off is only
     used to switch modes. */
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') setMode('touch');
    else if (e.pointerType === 'mouse') setMode('kbm');
  }, true);

  on('state', refresh);
  on('input:mode', setMode);
  on('input:lost', releaseAll);
  /* A finger that is down when the side changes would be on the wrong half. */
  on('settings:changed', key => {
    if (key === 'touchSide' || key === '*'){ releaseAll(); layout(); }
    /* The new line applies from the next move. The finger stays down, so the
       marker is repainted and the latch is left alone. */
    if (key === 'sprintPush' || key === '*') paintSprintAt();
  });

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function'){
    bindRotate(window.matchMedia('(orientation: portrait) and (pointer: coarse)'));
  }

  const q = globalThis.location && globalThis.location.search;
  forced = !!q && new URLSearchParams(q).get('input') === 'touch';
  setMode(forced ? 'touch' : 'kbm');
  refresh();
}
