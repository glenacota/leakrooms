/* The HUD writes values into the sidebar defined in index.html. This file
   owns the element table and the two update functions. clockText formats run
   state, so the run owns it and the HUD re-exports it. */

import { BATT_MAX, LOUD, NOISE_FS } from '../config/constants.js';
import { FLOORS, REPAIR_TIME } from '../config/tuning.js';
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
  vBatt: document.getElementById('val-batt'),
  vNoise: document.getElementById('val-noise'),
  vClock: document.getElementById('val-clock'),
  clockWrap: document.getElementById('clock'),
  vPipes: document.getElementById('val-pipes'),
  vLeak: document.getElementById('val-leak'),
  vFlood: document.getElementById('val-flood'),
  barFlood: document.getElementById('bar-flood'),
  vDepth: document.getElementById('val-depth'),
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
  hudSet(HUD.batt, 'batt', 'width', (G.batt/BATT_MAX*100)+'%');
  hudSet(HUD.vBatt, 'vBatt', 'text', Math.ceil(G.batt));

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
  G.noisePeak = Math.max(G.noise, G.noisePeak - 0.004);
  hudSet(HUD.noisePeak, 'noisePeakL', 'left', Math.max(0, Math.min(100, G.noisePeak/NOISE_FS*100))+'%');
  hudSet(HUD.noiseLeak, 'noiseLeak', 'width', (Math.max(0, Math.min(1, G.leakTotal/NOISE_FS))*100)+'%');
  // The LOUD hairline is placed from the constant, so it always marks the real threshold.
  hudSet(HUD.noiseLoud, 'noiseLoud', 'left', (LOUD/NOISE_FS*100)+'%');

  /* ---------- Pipes, door and flood ----------
     Three readouts answer three different questions:
       LEAKS  how many pipes are sealed (the work list)
       DOOR   whether the level can end yet
       FLOOD  how much of the floor is under water; it keeps rising while
              pipes are open and drains after the last seal */
  hudSet(HUD.vPipes, 'vPipes', 'text', `${G.pipes-G.leaksOpen}/${G.pipes}`);
  /* OPEN is the good state and has no colour; SEALED is the one that stops
     you, so it is the only one that is red. The text and a CSS class are set
     here and the stylesheet decides how the states look. */
  hudSet(HUD.vLeak, 'vLeak', 'text', G.leaksOpen===0 ? 'OPEN' : 'SEALED');
  hudFlag(HUD.vLeak, 'vLeakShut', 'shut', G.leaksOpen>0);
  hudSet(HUD.vFlood, 'vFlood', 'text', String(Math.round(G.floodCover*100)).padStart(2,'0'));
  hudSet(HUD.barFlood, 'barFlood', 'width', (G.floodCover*100)+'%');

  /* ---------- Clock ----------
     Shown in whole seconds. It changes colour in the last 30 seconds (the same
     moment the warning flashes) and blinks in the last 10. The flags go on the
     wrapper, and the stylesheet decides what "low" and "critical" look like. */
  hudSet(HUD.vClock, 'vClock', 'text', clockText(G.clock));
  hudFlag(HUD.clockWrap, 'clockLow', 'low',     G.clock <= 30);
  hudFlag(HUD.clockWrap, 'clockCrit', 'critical', G.clock <= 10);
  hudSet(HUD.vDepth, 'vDepth', 'text', `${G.floor+1}/${FLOORS}`);
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
  if (working)              msg = 'wrenching \u2014 DO NOT MOVE';
  else if (G.atLeak)        msg = `hold still \u2014 ${REPAIR_TIME} seconds at the pipe`;
  else if (G.descend>0.02)  msg = 'cycling door \u2014 do not stop';
  else if (G.leaksOpen>0)   msg = `${G.leaksOpen} PIPE${G.leaksOpen===1?'':'S'} LEAKING \u2014 THE WATER RUNS DOWNHILL FROM THE BREAK`;
  else                      msg = 'the door will cycle \u2014 GET BACK TO THE ONE YOU CAME IN THROUGH';
  hudSet(el, 'prompt', 'text', msg);
  hudFlag(el, 'promptOn', 'on', true);
}

// The life pips as HTML: one dot per life in the run, with spent ones marked "gone".
export function livesHTML(){
  return Array.from({length:Math.max(1,runLives)},
    (_,i)=> `<span class="${i<lives?'':'gone'}">&#9679;</span>`).join('');
}
export function renderLives(){
  // Goes through the same cache as updateHUD, so the two can never disagree about what is on screen.
  hudSet(document.getElementById('val-lives'), 'vLives', 'html', livesHTML());
}