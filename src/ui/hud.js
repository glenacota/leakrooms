/* The HUD writes values into the panel defined in index.html. This file
   owns the element table and the two update functions. clockText formats run
   state, so the run owns it and the HUD re-exports it.

   The panel is the boiler plate: a live scope on the left, drawn by
   src/render/hud-scope.js, and four readouts after it — the clock, the
   battery, the lives and the leaks.

   There is no flood, no door and no level readout here. The water is on
   the floor, where you can see it and walk in it. The door and the floor
   number are on the cards that announce them: the clear card, the pause
   stub, and the prompt line, which already says whether the door can cycle
   yet. The level is in the same place. A readout that repeats something
   the screen is already saying is a place for the eye to stop. */

import { BATT_MAX } from '../config/constants.js';
import { REPAIR_TIME } from '../config/tuning.js';
import { G } from '../sim/state.js';
import { SETTINGS } from '../settings/store.js';
import { clockText, lives, runLives } from '../game/run.js';

export { clockText } from '../game/run.js';

// Every HUD element the code writes to, looked up once. The scope is not in
// this table: it is a canvas the renderer draws into, and it has no value to
// write. See src/render/hud-scope.js.
export const HUD = {
  batt: document.getElementById('bar-batt'),
  vClock: document.getElementById('val-clock'),
  clockWrap: document.getElementById('clock'),
  vPipes: document.getElementById('val-pipes'),
  vLamps: document.getElementById('val-lamps'),
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
     losing the message entirely. It is cleared by the timeout that hides the
     note, so the next flash starts from a known state. */
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

  /* ---------- Battery ----------
     The trough is the readout, and the number beside it says how much is
     left in units, because a bar cannot say 40 from 45. */
  hudSet(HUD.batt, 'batt', 'width', (G.batt/BATT_MAX*100)+'%');
  hudFlag(HUD.batt, 'battLow', 'low', G.batt < 25);
  
  /* ---------- Clock ----------
     Shown in whole seconds. It changes colour in the last 30 seconds and
     blinks in the last 10. The flags go on the wrapper, and the stylesheet
     decides what "low" and "critical" look like. */
  hudSet(HUD.vClock, 'vClock', 'text', clockText(G.clock));
  hudFlag(HUD.clockWrap, 'clockLow', 'low',      G.clock <= 30);
  hudFlag(HUD.clockWrap, 'clockCrit', 'critical', G.clock <= 10);

  /* ---------- Leaks ----------
     The lamps are the reading: one per pipe on the floor, green once it is
     sealed and red and flickering while it is open. The count under them
     says how many are done. */
  hudSet(HUD.vLamps, 'vLamps', 'html', lampsHTML());
  hudSet(HUD.vPipes, 'vPipes', 'text', `${G.pipes-G.leaksOpen}/${G.pipes}`);

  /* ---------- Lives ---------- */
  hudSet(HUD.vLives, 'vLives', 'html', fusesHTML());

  /* The peak the scope draws as a hold line. It decays here, beside the
     rest of the noise bookkeeping, so the trace and the number it came
     from can never disagree. */
  G.noisePeak = Math.max(G.noise, G.noisePeak - 0.004);
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
  if (working)              msg = 'wrenching \u2014 DO NOT MOVE';
  else if (G.atLeak)        msg = `hold still \u2014 ${REPAIR_TIME} seconds at the pipe`;
  else if (G.descend>0.02)  msg = 'cycling door \u2014 do not stop';
  else if (G.leaksOpen>0)   msg = `${G.leaksOpen} PIPE${G.leaksOpen===1?'':'S'} LEAKING \u2014 THE WATER RUNS DOWNHILL FROM THE BREAK`;
  else                      msg = 'the door will cycle \u2014 GET BACK TO THE ONE YOU CAME IN THROUGH';
  hudSet(el, 'prompt', 'text', msg);
  hudFlag(el, 'promptOn', 'on', true);
}

/* The life pips as HTML: one dot per life in the run, with spent ones marked
   "gone". The pause screen uses these, because its stub is a printed ticket
   and not an instrument panel. */
export function livesHTML(){
  return Array.from({length:Math.max(1,runLives)},
    (_,i)=> `<span class="${i<lives?'':'gone'}">&#9679;</span>`).join('');
}

/* The lives as fuse caps, which is how the panel shows them: one per life in
   the run, the spent ones dark. */
export function fusesHTML(){
  return Array.from({length:Math.max(1,runLives)},
    (_,i)=> `<i class="fuse ${i<lives?'':'gone'}"></i>`).join('');
}

/* One lamp per pipe on the floor. A sealed pipe is a steady green lamp; an
   open pipe is a red one that flickers, because an open pipe is the thing
   the run is about. */
export function lampsHTML(){
  if (!G) return '';
  let out = '';
  for (const L of G.leaks) out += `<i class="lamp ${L.fixed ? 'sealed' : 'open'}"></i>`;
  return out;
}

export function renderLives(){
  // Goes through the same cache as updateHUD, so the two can never disagree about what is on screen.
  hudSet(document.getElementById('val-lives'), 'vLives', 'html', fusesHTML());
}
