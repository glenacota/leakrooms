/* The HUD writes values into the instrument panel defined in index.html.
   This file owns the element table and the two update functions. clockText
   formats run state, so the run owns it and the HUD re-exports it. */

import { BATT_CELLS, BATT_LOW, BATT_MAX, LOUD, NOISE_FS } from '../config/constants.js';
import { REPAIR_TIME } from '../config/tuning.js';
import { G } from '../sim/state.js';
import { SETTINGS } from '../settings/store.js';
import { clockText, lives, runLives } from '../game/run.js';

export { clockText } from '../game/run.js';

// Every HUD element the code writes to, looked up once.
export const HUD = {
  batt: document.getElementById('bar-batt'),
  noise: document.getElementById('bar-noise'),
  noiseWrap: document.querySelector('.bar.noise'),
  noisePeak: document.getElementById('bar-noise-peak'),
  noiseLeak: document.getElementById('bar-noise-leak'),
  noiseLoud: document.querySelector('.bar.noise u.loud'),
  noiseLoudTag: document.getElementById('tag-loud'),
  vBatt: document.getElementById('val-batt'),
  vNoise: document.getElementById('val-noise'),
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
function hudFlag(el, key, cls, on){
  if (!el || hudCache[key] === on) return;
  hudCache[key] = on;
  el.classList.toggle(cls, on);
}

/* Refreshes every readout from the current floor state (G). Called once per
   frame while playing. */
export function updateHUD(){
  if (!G) return;
  /* ---------- Radar power ---------- */
  hudSet(HUD.batt, 'batt', 'html', battHTML());
  hudSet(HUD.vBatt, 'vBatt', 'text', `${Math.ceil(G.batt)}%`);
  /* Low charge is a warning, so the lit cells turn red. It is the same red
     the noise bar uses for the one thing that is about to cost you. */
  hudFlag(HUD.batt, 'battHot', 'hot', G.batt < BATT_LOW);

  /* ---------- Noise bar ----------
     The bar is scaled to NOISE_FS (the wrench, the loudest sustained noise),
     not to the battery maximum. It shows three things:
       yellow fill   the noise YOU are making (G.selfNoise)
       blue fill     the noise the open pipes make everywhere on the floor
       orange tick   the recent peak, because a sprint is so short that the
                     fill alone would not show it happened
     The number above the bar is the loudest of the two, since that is what
     the room actually sounds like. */
  const nz = Math.max(0, Math.min(1, G.noise/NOISE_FS))*100;
  hudSet(HUD.vNoise, 'vNoise', 'text', String(Math.round(nz)).padStart(2,'0'));
  hudSet(HUD.noise, 'noise', 'width', Math.max(0, Math.min(1, G.selfNoise/NOISE_FS))*100+'%');
  /* The bar turns red at LOUD, tested on your own noise. Pipes never reach
     LOUD by design, so red always means "this is about you". */
  hudFlag(HUD.noiseWrap, 'noiseHot', 'hot', G.selfNoise>=LOUD);
  hudSet(HUD.noisePeak, 'noisePeakL', 'left', Math.max(0, Math.min(100, G.noisePeak/NOISE_FS*100))+'%');
  hudSet(HUD.noiseLeak, 'noiseLeak', 'width', (Math.max(0, Math.min(1, G.leakTotal/NOISE_FS))*100)+'%');
  // The LOUD hairline is placed from the constant, so it always marks the real threshold.
  hudSet(HUD.noiseLoud, 'noiseLoud', 'left', (LOUD/NOISE_FS*100)+'%');
  // The LOUD tag names that same line, so it always sits on the hairline too.
  hudSet(HUD.noiseLoudTag, 'noiseLoudTag', 'left', (LOUD/NOISE_FS*100)+'%');

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

// The battery cells as HTML: one per step of the charge, lit from the left.
// There is always at least one lit cell while there is any charge at all, so
// a nearly dead battery never reads as an empty shell.
export function battHTML(){
  if (!G) return '';
  const q = Math.max(0, Math.min(1, G.batt/BATT_MAX));
  const lit = Math.ceil(q*BATT_CELLS);
  return Array.from({length:BATT_CELLS},
    (_,i)=> `<span class="${i<lit?'lit':''}"></span>`).join('');
}
export function renderLives(){
  // Goes through the same cache as updateHUD, so the two can never disagree about what is on screen.
  hudSet(document.getElementById('val-lives'), 'vLives', 'html', livesHTML());
}
