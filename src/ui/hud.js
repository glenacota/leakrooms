/* The HUD writes values into the instrument panel defined in index.html.
   This file owns the element table and the two update functions. clockText
   formats run state, so the run owns it and the HUD re-exports it.

   The corner panel now carries the clock, the lives and the pipe marks only:
   the noise and radar readings moved to diegetic rings above the plumber
   (see render/passes/diegetic.js). */

import { REPAIR_TIME } from '../config/tuning.js';
import { G } from '../sim/state.js';
import { SETTINGS } from '../settings/store.js';
import { clockText, lives, runLives } from '../game/run.js';
import { buildHudSnap, hudVisibility } from './touch-hud-rules.js';


// Every HUD element the code writes to, looked up once.
export const HUD = {
  vClock: document.getElementById('val-clock'),
  clockWrap: document.getElementById('clock'),
  vPipes: document.getElementById('val-pipes'),
  vLives: document.getElementById('val-lives'),
  prompt: document.getElementById('prompt'),
  hud: document.getElementById('hud')
};

/* Shows a short message in the middle of the screen for a few seconds.
   Subscribed to the 'flash' event, so the simulation can announce things
   without knowing about the DOM. */
let flashT = 0;
export function flash(text){
  const el=document.getElementById('flashnote');
  el.textContent = text;
  /* The flash intensity is an inline opacity, not a class change. The class
     still drives the fade-in transition (the CSS eases opacity toward 1 when
     .on is present); the inline value caps where that fade lands, so a player
     who finds the sudden bright text uncomfortable can dial it down without
     losing the message entirely. It is cleared when the timeout hides the note,
     so the next flash starts from a known state. */
  el.style.opacity = SETTINGS.flash ? '1' : '0';
  el.classList.add('on');
  clearTimeout(flashT);
  flashT = setTimeout(()=>{ el.classList.remove('on'); el.style.opacity=''; }, 3400);
  if (flashT.unref) flashT.unref();   // a browser returns a number
}


let touchHudPanel = null;
let touchHudPrev = null;

/** Updates touch-mode HUD visibility once per simulation frame. */
export function tickTouchHud(){
  if (!touchHudPanel) touchHudPanel = document.querySelector('.crt-tl');
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
  /* ---------- Pipes ----------
     One mark per pipe on the floor. The exact count is on the prompt line. */
  hudSet(HUD.vPipes, 'vPipes', 'html', pipesHTML());

  /* ---------- Clock ---------- */
  hudSet(HUD.vClock, 'vClock', 'text', clockText(G.clock));
  hudFlag(HUD.clockWrap, 'clockLow', 'low',     G.clock <= 30);
  hudFlag(HUD.clockWrap, 'clockCrit', 'critical', G.clock <= 10);
  /* innerHTML is used here because the pips are small HTML spans, and the
     cache above means it is only parsed when a life is lost. */
  hudSet(HUD.vLives, 'vLives', 'html', livesHTML());
}

/* The hint line near the bottom of the screen. It shows the first of five
   messages that applies. The repair message comes first because it is the one
   moment the player must NOT press a key, and this line is where they look
   to find out what the game wants. */
export function setPrompt(){
  const el=HUD.prompt;
  if (!G){ hudFlag(el, 'promptOn', 'on', false); return; }
  let working = 0;
  for (const L of G.leaks) if (!L.fixed && L.repair > 0.02) working++;
  let msg;
  if (working)              msg = 'SEALING \u2014 DO NOT MOVE';
  else if (G.atLeak)        msg = `STAND STILL \u2014 ${REPAIR_TIME} SECONDS`;
  else if (G.descend>0.02)  msg = 'STAY AT THE DOOR';
  /* At the door with pipes still open: the door will not cycle until every
     leak is sealed, so say so instead of sending the player back to the wet
     floor they are already standing on. */
  else if (G.leaksOpen>0 && atDoor()) msg = `DOOR LOCKED \u2014 ${G.leaksOpen} LEAK${G.leaksOpen===1?'':'S'} OPEN`;
  else if (G.leaksOpen>0)   msg = `${G.leaksOpen} LEAK${G.leaksOpen===1?'':'S'} LEFT \u2014 FOLLOW THE WET FLOOR`;
  else                      msg = 'ALL SEALED \u2014 BACK TO THE DOOR';
  hudSet(el, 'prompt', 'text', msg);
  hudFlag(el, 'promptOn', 'on', true);
}

/* True when the plumber is standing on the door tile (1.25 tiles, matching
   the hold distance in sim/door.js), so a door in a one-tile alcove still
   counts without pixel precision. */
function atDoor(){
  if (!G.plumber || !G.exitTiles) return false;
  for (const e of G.exitTiles){
    if (Math.hypot(e.x+0.5-G.plumber.x, e.y+0.5-G.plumber.y) < 1.25) return true;
  }
  return false;
}

// The life pips as HTML: one dot per life in the run, with spent ones marked "gone".
export function livesHTML(){
  return Array.from({length:Math.max(1,runLives)},
    (_,i)=> `<span class="${i<lives?'':'gone'}">&#9679;</span>`).join('');
}

// The pipe marks as HTML: one per pipe on the floor. The open ones are
// packed to the left and the sealed ones sit hollow on the right, so the lit
// run is the number still open and the row drains as the floor is fixed.
export function pipesHTML(){
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
