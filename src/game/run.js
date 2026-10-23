/* ============================================================
   THE RUN
   Everything about the player's current attempt: which screen or state
   the game is in, lives, totals, and every way a run starts, ends,
   rewinds or continues.
   ============================================================ */

import { BATT_MAX } from '../config/constants.js';
import { LEVELS, LEVELS_N } from '../config/levels.js';
import { DIFFICULTIES } from '../config/presets.js';
import { FLOOR_CLOCK, FLOORS } from '../config/tuning.js';
import { SETTINGS } from '../settings/store.js';
import { Audio_ } from '../audio/index.js';
import { emit, on } from '../util/events.js';
import { initFlood } from '../sim/flood.js';
import { keys } from '../sim/keys.js';
import { snapMask } from '../sim/vision.js';
import { G } from '../sim/state.js';
import { buildFloor } from './floor.js';

/* The variables below are live bindings. Other modules can read them,
   but only this file may assign to them. Changes go through the setter
   functions at the bottom, so there is one place where the run changes. */

// One of: splash | order | clear | play | pause | dead | win
export let STATE='splash';

// The seed that builds every floor of the run (floor N uses this seed plus N).
export let RUN_SEED = (Math.random()*1e9)|0;
export let lives = 3, floorIdx = 0, runTime = 0;

/* How many life pips the HUD draws. It follows the difficulty (5 on
   RELAXED, 1 on HARD), so it cannot be a hardcoded three. */
export let runLives = 3;

/* Totals for the whole run. G.stat is thrown away whenever a floor is
   rebuilt, so the win card needs its own counters that last as long as the
   run. They are cleared only when a run starts (startRun). */
export let runStat = { noises:0, deaths:0, sealed:0 };

/* Starts a new building: new seed, a fresh floor 0, and a repainted title
   plan. The title screen must show the level the next run will really
   play, so this runs before the player sees it again (RUN IT AGAIN, RESET). */
export function rollRunSeed(){
  setRunSeed((Math.random()*1e9)|0);
  buildFloor(0, RUN_SEED);
  /* The title plan is painted by the renderer, which the run does not know
     about. The event is the whole of the dependency. */
  emit('splash:repaint');
}

/* ============================================================
   FLOOR CLEAR CARD
   Between two levels the player sees a card with the clock they finished
   with and a briefing for the next floor. It exists so that a running clock
   never silently restarts, and so the player knows what is coming (pipes
   and lifeforms) before they walk in.

   The next floor is already built while the card is up. 'clear' only holds
   the player out of it, and the clock is frozen because the loop only
   steps the simulation while STATE is 'play'.
   ============================================================ */
export let clearCard = { floor:0, clock:0, leaks:0, lifeforms:0 };

/* Fills in the card and asks the shell to show it. The numbers live here and
   the writing on them lives in ui/, because this file must never touch the
   document — that is what makes it readable, and testable, without a DOM. */
export function showClear(){
  emit('clear:show');
  transition('clear');
  Audio_.acclaim();
}

/* Called by ENTER and by the card's button. ESC does nothing here on purpose:
   there is no way back to the floor you just sealed. Held keys are cleared
   inside transition(), because the player was almost certainly holding W
   when they reached the door. */
export function dismissClear(){
  if (STATE!=='clear') return;
  transition('play');
}

/* ============================================================
   STATE CHANGES
   ============================================================ */

/**
 * The only way the run changes state. Every change does the same four things:
 * set the state, show the matching screen, show or hide the HUD, and
 * announce 'state' so the audio can react.
 *
 * Held keys are cleared as well. Otherwise a run that starts while W is held
 * would walk the player straight back out of the door they came through.
 *
 * @param {string} to - the new state ('play', 'pause', 'dead', ...).
 */
export function transition(to){
  setState(to);
  emit('screen', to === 'play' ? null : to);
  emit('hud', to === 'play');
  for (const k in keys) delete keys[k];
  emit('state', STATE);
}

// Called when the door cycles: moves to the next floor, or ends the run.
export function nextFloor(){
  setFloorIdx(floorIdx+1);
  if (floorIdx >= FLOORS){ transition('win'); emit('win', { sealed: runStat.sealed, deaths: runStat.deaths, noises: runStat.noises, floors: FLOORS, time: runTime });
    return;
  }
  /* Read the leftover clock BEFORE rebuilding. buildFloor replaces G, and the
     seconds left on the finished floor are what the card shows. */
  const clockLeft = G ? G.clock : FLOOR_CLOCK;
  buildFloor(floorIdx, RUN_SEED);
  // Same table and same clamp as buildFloor, so the card matches the floor.
  const spec = LEVELS[Math.min(floorIdx, LEVELS_N-1)];
  setClearCard({ floor:floorIdx, clock:clockLeft, leaks:spec.leaks, lifeforms:spec.lifeforms });
  showClear();
}

/**
 * Ends the attempt: costs a life, shows the death screen and says why. Being
 * caught and running out of the clock are the same thing to the player (they
 * did not get back to the door in time), so they share one path.
 *
 * @param {string} cause - text shown on the death screen.
 */
export function lose(cause){
  if (STATE!=='play') return;
  /* Tell the floor first. This frame is still a simulation frame, and without
     G.ended the rest of update() would keep running. The worst case is the
     door cycling and building the next floor on the frame you died. */
  G.ended = true;
  G.stat.deaths++;
  runStat.deaths++;
  setLives(lives-1);
  Audio_.sting();                 // the noise beds are closed by the 'state' event
  transition('dead');
  emit('lives');
  emit('dead', { lives, cause });
}

export function caught(){ lose('IT CAUGHT YOU'); }

// Running out of time costs a life too. A deadline that cannot kill you is only advice.
export function outOfTime(){ lose('THE CLOCK RAN OUT'); }

// Formats seconds as m:ss, rounding up so the display matches whole seconds.
export function clockText(s){
  const t = Math.max(0, Math.ceil(s));
  return Math.floor(t/60) + ':' + String(t%60).padStart(2,'0');
}

/* ============================================================
   RESET GAME (two taps)
   The pause screen's reset button ends the whole run, so the first tap only
   arms it. It disarms after 5 seconds or when the player changes page.
   ============================================================ */
export let resetArmed = false;
let resetArmTimer = 0;

/* The label on the button is the shell's business; this file only decides
   whether the run is armed, and says so. */
function announceReset(){
  emit('reset', resetArmed);
}
export function disarmReset(){
  resetArmed = false;
  clearTimeout(resetArmTimer);
  announceReset();
}
export function armReset(){
  resetArmed = true;
  clearTimeout(resetArmTimer);
  resetArmTimer = setTimeout(disarmReset, 5000);
  if (resetArmTimer.unref) resetArmTimer.unref();   // a browser returns a number
  announceReset();
}
export function resetRun(){
  /* Follows the same steps as boot: new seed, floor built from it, plan
     painted from it. The title screen then shows the building the next run
     will use, not the one just abandoned. */
  rollRunSeed();
  setFloorIdx(0);
  setRunTime(0);
  setRunLives((DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal).lives);
  setLives(runLives);
  setRunStat({ noises:0, deaths:0, sealed:0 });
  emit('lives');
  transition('splash');          // also hides the HUD, which belongs to a run
  disarmReset();
}

/* ============================================================
   BUTTON ACTIONS
   The functions behind the main buttons. src/ui/buttons.js attaches them.
   ============================================================ */

// CLOCK IN: starts a new run on floor 1.
export function startRun(){
Audio_.init();
Audio_.unlock();
/* The seed is not rolled here. It was rolled before the title screen was
   painted, and the plan behind the title has to be the level the player is
   about to play. A finished run rolls its own (see rollRunSeed). */
setRunLives((DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal).lives);
setLives(runLives); setFloorIdx(0); setRunTime(0);
// A new run gets a new tally, so the win card never shows the previous run.
setRunStat({ noises:0, deaths:0, sealed:0 });
emit('lives');
/* Floor 0 was already built at boot from the same seed, so building it again
   would only generate the same level twice. Reuse it when it is untouched:
   same seed, clock never started, and every pipe still open. That check
   matters because a run that died on floor 1 and came back through here has
   the same seed but a played floor. The clock check also catches a
   difficulty change made after boot. */
const reuse = G && G.floor===0 && G.seed===RUN_SEED
              && G.clock >= FLOOR_CLOCK && G.leaksOpen === G.pipes;
if (!reuse) buildFloor(0, RUN_SEED);
else {
  G.clock = FLOOR_CLOCK; G.time = 0; G.batt = BATT_MAX;
  G.stat = {noises:0, deaths:0, sealed:0};
  G.radar = false; G.radarRattleT = 0; G.noise = 0; G.noisePeak = 0; G.selfNoise = 0; G.ambientNoise = 0; G.descend = 0; G.seenBy = 0;
  initFlood(G, G.plumber);
  snapMask(G, G.plumber, G.radar);
}
// A short grace period before lifeforms can notice you, for both paths above.
for (const lf of G.lifeforms){ lf.born = 3.0; }
transition('play');
}

// REWIND: replays the same floor after a death, or starts a new run if no lives are left.
export function retryFloor(){
if (lives<=0){ startRun(); return; }
/* Keep the leaks that were already sealed: capture their positions before the
   floor is rebuilt, then re-seal them on the fresh floor. The flood is rebuilt
   afterwards so it only spreads from the pipes that are still open. */
const fixedKeys = new Set();
if (G && Array.isArray(G.leaks)){
  for (const L of G.leaks){
    if (L.fixed) fixedKeys.add(`${L.x},${L.y},${L.sx},${L.sy}`);
  }
}
buildFloor(floorIdx, RUN_SEED);
let fixedCount = 0;
for (const L of G.leaks){
  if (fixedKeys.has(`${L.x},${L.y},${L.sx},${L.sy}`)){
    L.fixed = true;
    L.fixedAt = 0;
    L.repair = 0;
    fixedCount++;
  }
}
G.leaksOpen = Math.max(0, G.leaks.length - fixedCount);
// Rebuild the flood now that the fixed flags are in place, so sealed pipes
// stop being water sources.
initFlood(G, G.plumber);
/* Same seed, so the pipes are in the same places and only the flood restarts.
   Dying costs a life and the repairs you made, but not what you learned about
   where the pipes are. */
for (const lf of G.lifeforms){ lf.born=3.0; }
transition('play');
}

// RUN IT AGAIN (win screen): a new building, then a normal start.
export function runAgain(){
rollRunSeed();
startRun();
}

/* ============================================================
   SETTERS
   Needed because other modules cannot assign to imported variables.
   ============================================================ */
export function setState(v){ STATE = v; }
export function setLives(v){ lives = v; }
export function setFloorIdx(v){ floorIdx = v; }
export function setRunTime(v){ runTime = v; }
// The loop calls this once per simulation step.
export function addRunTime(v){ runTime += v; }
export function setRunLives(v){ runLives = v; }
export function setRunStat(v){ runStat = v; }
export function setRunSeed(v){ RUN_SEED = v; }
export function setClearCard(v){ clearCard = v; }

/* ============================================================
   EVENT WIRING
   The simulation only reports four facts (a stat was counted, something
   caught you, the clock ran out, the door cycled). This is where the run
   decides what each one means. Called once from boot().
   ============================================================ */
export function bindRun(){
  on('stat', k => { runStat[k]++; });
  on('caught', caught);
  on('clock:out', outOfTime);
  on('door:cycled', nextFloor);
}