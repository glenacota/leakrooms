import { BATT_MAX, LOUD, LS, NOISE_FS } from '../config/constants.js';
import { FLOOR_CLOCK, FLOORS, HUNT_BASE, HUNT_STEP, REPAIR_TIME } from '../config/tuning.js';
import { G } from '../sim/state.js';
import { clockText, lives, runLives } from '../game/run.js';

/* clockText is re-exported here rather than defined here: it formats run state,
   so the run owns it, and the HUD is the only reader that wants it by that name.
   What this module owns is the WRITING — the element table and the two passes. */
export { clockText } from '../game/run.js';

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


let flashT = 0;
export function flash(text){
  const el=document.getElementById('flashnote');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(flashT);
  flashT = setTimeout(()=>el.classList.remove('on'), 3400);
}

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

export function updateHUD(){
  if (!G) return;
  hudSet(HUD.batt, 'batt', 'width', (G.batt/BATT_MAX*100)+'%');
  hudSet(HUD.vBatt, 'vBatt', 'text', Math.ceil(G.batt));
  /* The NOISE bar, on the noise scale and not the battery one. Divided by
     BATT_MAX it drew 1% of itself for a sprint and 1.8% for the door, while the
     red test below still fired on the raw level and turned the bar hot at a
     level it could not show. Three marks now: the fill (what you are making),
     the water-blue floor (what the open pipes are making, everywhere — the
     number a searching Lifeform steers by), and the peak tick, because a sprint
     lasts 0.26s and the fill alone cannot say that it happened. */
  const nz = Math.max(0, Math.min(1, G.noise/NOISE_FS))*100;
  hudSet(HUD.vNoise, 'vNoise', 'text', String(Math.round(nz)).padStart(2,'0'));
  /* TWO FILLS, ONE BAR. The yellow is what YOU are making; the blue is what
     the open pipes are making, everywhere on the floor, at the level the
     Lifeform is steering by. Standing still beside a burst pipe used to fill
     this bar to its top, which reads as "you are screaming" when you are
     standing perfectly still and something is coming to the PIPE, not to you.
     The number above is the loudest of the two, because that is what the room
     actually sounds like. */
  hudSet(HUD.noise, 'noise', 'width', Math.max(0, Math.min(1, G.selfNoise/NOISE_FS))*100+'%');
  /* LOUD, on YOUR noise, and read from the constant. A pipe never reaches it
     by construction, so red still means "this is about you" — and the old 0.45
     was a stale copy of a threshold that lives at 0.5. */
  hudFlag(HUD.noiseWrap, 'noiseHot', 'hot', G.selfNoise>=LOUD);
  G.noisePeak = Math.max(G.noise, G.noisePeak - 0.004);
  hudSet(HUD.noisePeak, 'noisePeakL', 'left', Math.max(0, Math.min(100, G.noisePeak/NOISE_FS*100))+'%');
  hudSet(HUD.noisePeak, 'noisePeakO', 'opacity', '1');
  hudSet(HUD.noiseLeak, 'noiseLeak', 'width', (Math.max(0, Math.min(1, G.leakTotal/NOISE_FS))*100)+'%');
  /* the LOUD mark, positioned from the constant rather than typed into the
     stylesheet: it is the threshold the AI reads, and a hardcoded 50% went
     stale the moment full scale stopped being 1.0 */
  hudSet(HUD.noiseLoud, 'noiseLoud', 'left', (LOUD/NOISE_FS*100)+'%');
  /* Three pipe readouts, because they answer three different questions and a
     single "OPEN/SEALED" cannot answer any of them. PIPES is the tally you are
     working down. DOOR is whether the level can end at all — it stays shut until
     the last one is closed. FLOOD is a gauge of how much of the floor is under
     water: it keeps climbing while you are still working, and it drains after
     the last seal, so it is both the pressure and the proof the repair worked. */
  hudSet(HUD.vPipes, 'vPipes', 'text', `${G.pipes-G.leaksOpen}/${G.pipes}`);
  /* The door. OPEN means every pipe is sealed and the level can be ended, so
     OPEN is the good state and gets no colour; SEALED is the only one that
     shouts. The old version injected <span class="ok">OPEN</span> with ok being
     water-blue, next to a flood gauge also in water-blue — so the word that
     answers "can I leave yet" looked like it belonged to the thing keeping you
     here. Text plus a class, not markup, so the stylesheet can say what the
     states mean. */
  hudSet(HUD.vLeak, 'vLeak', 'text', G.leaksOpen===0 ? 'OPEN' : 'SEALED');
  hudFlag(HUD.vLeak, 'vLeakShut', 'shut', G.leaksOpen>0);
  hudSet(HUD.vFlood, 'vFlood', 'text', String(Math.round(G.floodCover*100)).padStart(2,'0'));
  hudSet(HUD.barFlood, 'barFlood', 'width', (G.floodCover*100)+'%');
  /* The clock. Whole seconds, and it changes COLOUR in the last thirty — the
     same thirty the flash announces — because a number that does not change
     colour is a number players stop seeing after the first level, and a number
     that changes SIZE is one that reflows its own box once a second for three
     minutes. Both flags live on the wrapper, so the stylesheet owns what
     "low" and "critical" look like and this never has to restate it. */
  hudSet(HUD.vClock, 'vClock', 'text', clockText(G.clock));
  hudFlag(HUD.clockWrap, 'clockLow', 'low',     G.clock <= 30);
  hudFlag(HUD.clockWrap, 'clockCrit', 'critical', G.clock <= 10);
  hudSet(HUD.vDepth, 'vDepth', 'text', `${G.floor+1}/${FLOORS}`);
  /* innerHTML, and the reason this one mattered most: a run of spans was being
     PARSED as HTML sixty times a second to redraw three bullet characters that
     change when you die. */
  hudSet(HUD.vLives, 'vLives', 'html', livesHTML());
}

/* The prompt line. One of five strings, and it holds whichever one applies for
   seconds at a time — so it was being rebuilt as a template literal and handed
   to the DOM every frame, which re-inserts the text node and re-lays-out the
   line every frame to say the same four words. The element reference is cached
   here too rather than looked up per frame. */
export function setPrompt(){
  const el=HUD.prompt;
  if (!G){ hudFlag(el, 'promptOn', 'on', false); return; }
  let working = 0;
  for (const L of G.leaks) if (!L.fixed && L.repair > 0.02) working++;
  /* The repair prompt is first because it is the only state in the game where
     the player must NOT press a key, and the prompt line is where they look to
     find out what the game wants. Everything else is a movement instruction. */
  let msg;
  if (working)              msg = 'wrenching \u2014 DO NOT MOVE';
  else if (G.atLeak)        msg = `hold still \u2014 ${REPAIR_TIME} seconds at the pipe`;
  else if (G.descend>0.02)  msg = 'cycling door \u2014 do not stop';
  else if (G.leaksOpen>0)   msg = `${G.leaksOpen} PIPE${G.leaksOpen===1?'':'S'} LEAKING \u2014 THE WATER RUNS DOWNHILL FROM THE BREAK`;
  else                      msg = 'the door will cycle \u2014 GET BACK TO THE ONE YOU CAME IN THROUGH';
  hudSet(el, 'prompt', 'text', msg);
  hudFlag(el, 'promptOn', 'on', true);
}
export function livesHTML(){
  return Array.from({length:Math.max(1,runLives)},
    (_,i)=> `<span class="${i<lives?'':'gone'}">&#9679;</span>`).join('');
}
export function renderLives(){
  /* Goes through the HUD cache like updateHUD does, so the two can never
     disagree about what the element is showing: whichever runs second sees a
     cache that already matches the DOM and correctly writes nothing. */
  hudSet(document.getElementById('val-lives'), 'vLives', 'html', livesHTML());
}
