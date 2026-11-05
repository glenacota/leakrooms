/* The HUD writes values into the instrument panel defined in index.html.
   This file owns the element table and the two update functions. clockText
   formats run state, so the run owns it and the HUD re-exports it.

   The corner panel now carries the clock, the lives and the leaks marks only:
   the noise and radar readings moved to diegetic rings above the plumber
   (see render/passes/diegetic.js). */

import { G } from '../sim/state.js';
import { SETTINGS } from '../settings/store.js';
import { clockText, lives, runLives } from '../game/run.js';
import { buildHudSnap, hudVisibility } from './touch-hud-rules.js';


// Every HUD element the code writes to, looked up once.
export const HUD = {
  vClock: document.getElementById('val-clock'),
  clockWrap: document.getElementById('clock'),
  vLeaks: document.getElementById('val-leaks'),
  vLives: document.getElementById('val-lives'),
  hud: document.getElementById('hud')
};

/* Flash cues with priority tiers. A higher tier replaces what is on screen;
   an alert/guide/lore cue displaced by a higher one is held and re-shown when
   the slot frees, if it is still true. Danger repeats its icon alone after the
   first spoken instance. Info waits up to 1.5 s behind a higher cue. */
const CAT = {
  danger: { tier: 1, hold: 2800 },
  alert:  { tier: 2, hold: 3400 },
  guide:  { tier: 3, hold: 3400 },
  info:   { tier: 4, hold: 2000, wait: 1500 },
  lore:   { tier: 5, hold: 5200 },
};
const HOLDABLE = new Set(['alert', 'guide', 'lore']);
let cur = null;
let held = null;
let waiting = null;   // { cue } info queued behind a higher cue
let tmr = null;
let wtmr = null;      // info expiry timer
const dangerSaid = new Set();

function flashEl(){
  return document.getElementById('flashnote');
}

function draw(cue){
  const el = flashEl();
  if (!cue){
    el.classList.remove('on');
    el.textContent = '';
    el.style.opacity = '';
    return;
  }
  el.innerHTML = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><use href="#i-'+cue.cat+'"/></svg><span class="txt"></span>';
  const txt = el.querySelector('.txt');
  if (txt) txt.textContent = cue.text;
  else el.textContent = cue.text;
  el.dataset.cat = cue.cat;
  el.classList.toggle('icon', !!cue.icon);
  el.classList.toggle('quiet', !SETTINGS.flash);
  el.style.opacity = '1';
  el.classList.add('on');
}

function start(cue){
  cur = cue;
  draw(cue);
  clearTimeout(tmr);
  tmr = setTimeout(done, CAT[cue.cat].hold);
  if (tmr.unref) tmr.unref();
}

function done(){
  clearTimeout(wtmr);
  wtmr = null;
  const h = held;
  held = null;
  const w = waiting;
  waiting = null;
  cur = null;
  if (h && HOLDABLE.has(h.cat)){ start(h); return; }
  if (w){ start(w.cue); return; }
  draw(null);
}

function dropWaiting(){
  waiting = null;
  if (!cur) draw(null);
}

export function flashReset(){
  clearTimeout(tmr);
  clearTimeout(wtmr);
  cur = null;
  held = null;
  waiting = null;
  wtmr = null;
  dangerSaid.clear();
  draw(null);
}

export function flash(payload){
  if (typeof payload === 'string') payload = { cat: 'info', text: payload };
  const { cat, text } = payload;
  const tier = CAT[cat].tier;
  const ct = cur ? CAT[cur.cat].tier : 0;
  let icon = false;
  if (cat === 'danger'){
    if (dangerSaid.has(text)) icon = true;
    else dangerSaid.add(text);
  }
  const cue = { cat, text, icon };
  if (!cur){ start(cue); return; }
  if (tier <= ct){
    /* Newer cue is higher or equal priority: interrupt what is on screen. The
       displaced holdable cue goes into the single hold slot. */
    if (tier < ct && HOLDABLE.has(cur.cat) && !cur.icon &&
        (!held || CAT[cur.cat].tier < CAT[held.cat].tier)){
      held = cur;
    }
    start(cue);
  } else {
    /* Newer cue is lower priority: it waits. Holdable cues are re-shown when
       the slot frees; info waits up to its timeout, then drops. */
    if (HOLDABLE.has(cat)){
      if (!held || tier < CAT[held.cat].tier) held = cue;
    } else if (cat === 'info'){
      clearTimeout(wtmr);
      waiting = { cue };
      wtmr = setTimeout(dropWaiting, CAT[cat].wait);
      if (wtmr.unref) wtmr.unref();
    }
  }
}


let touchHudPanel = null;
let touchHudPrev = null;

/** Updates touch-mode HUD visibility once per simulation frame. */
export function tickTouchHud(){
  if (!touchHudPanel) touchHudPanel = document.querySelector('.crt-c');
  const touch = document.documentElement && document.documentElement.dataset.input === 'touch';
  if (!touch || !G){
    hudFlag(touchHudPanel, 'touchQuiet', 'hud-quiet', false);
    return;
  }
  const now = performance.now();
  const snap = buildHudSnap(G, lives, now);
  const r = hudVisibility(snap, touchHudPrev, now, SETTINGS.touchHud);
  touchHudPrev = { lives: snap.lives, lastTriggerMs: r.lastTriggerMs };
  hudFlag(touchHudPanel, 'touchQuiet', 'hud-quiet', !r.visible);
}

/* ---------- Write-only-when-changed helpers ----------
   updateHUD runs every frame, but most values stay the same for many frames.
   Writing to the DOM when nothing changed would force the browser to redo
   layout for no reason, so each write is skipped if it matches the last value
   written under the same key. */
const hudCache = Object.create(null);
function hudSet(el, key, prop, val){
  if (!el || hudCache[key] === val) return;
  hudCache[key] = val;
  if (prop === 'text') el.textContent = val;
  else if (prop === 'html') el.innerHTML = val;
  else el.style[prop] = val;
}
export function hudFlag(el, key, cls, on){
  if (!el || hudCache[key] === on) return;
  hudCache[key] = on;
  el.classList.toggle(cls, on);
}

/* Refreshes every readout from the current floor state (G). Called once per
   frame while playing. */
export function updateHUD(){
  if (!G) return;
  /* ---------- Leaks ----------
     One mark per leak on the floor. */
  hudSet(HUD.vLeaks, 'vLeaks', 'html', leaksHTML());

  /* ---------- Clock ---------- */
  hudSet(HUD.vClock, 'vClock', 'text', clockText(G.clock));
  hudFlag(HUD.clockWrap, 'clockLow', 'low',     G.clock <= 30);
  hudFlag(HUD.clockWrap, 'clockCrit', 'critical', G.clock <= 10);
  /* innerHTML is used here because the pips are small HTML spans, and the
     cache above means it is only parsed when a life is lost. */
  hudSet(HUD.vLives, 'vLives', 'html', livesHTML());
}

// The life pips as HTML: one dot per life in the run, with spent ones marked "gone".
export function livesHTML(){
  return Array.from({length:Math.max(1,runLives)},
    (_,i)=> `<span class="${i<lives?'':'gone'}">&#9679;</span>`).join('');
}

// The leaks marks as HTML: one per leak on the floor. The open ones are
// packed to the left and the sealed ones sit hollow on the right, so the lit
// run is the number still open and the row drains as the floor is fixed.
export function leaksHTML(){
  if (!G || !G.leaks) return '';
  const open = G.leaks.filter(L => !L.fixed);
  const done = G.leaks.filter(L => L.fixed);
  return open.concat(done)
    .map(L => `<span class="${L.fixed ? 'done' : 'open'}"></span>`).join('');
}

export function renderLives(){
  // Goes through the same cache as updateHUD, so the two can never disagree about what is on screen.
  hudSet(document.getElementById('val-lives'), 'vLives', 'html', livesHTML());
}
