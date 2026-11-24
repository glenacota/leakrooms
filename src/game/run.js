import { LEVELS, LEVELS_N } from '../config/levels.js';
import { FLOOR_CLOCK, FLOORS } from '../config/tuning.js';
import { currentTerms } from '../settings/store.js';
import { emit, on, EVENT } from '../util/events.js';
import { beginCatchPresentation, endCatchPresentation } from '../util/catch-presentation.js';
import { initFlood } from '../sim/flood.js';
import { clearInput } from '../sim/keys.js';
import { restoreSealed } from '../sim/leaks.js';
import { G } from '../sim/state.js';
import { buildFloor, isEasyFloor } from './floor.js';

/** @type {'splash'|'binder'|'clear'|'play'|'pause'|'dead'|'win'} */
export let STATE='splash';

/* Floor N uses this seed plus the floor offset. */
export let RUN_SEED = (Math.random()*1e9)|0;
export let lives = 3, floorIdx = 0, runTime = 0;

/* How many life pips the HUD draws. It follows the difficulty (5 on
   RELAXED, 1 on HARD), so it cannot be a hardcoded three. */
export let runLives = 3;

/* These counters survive floor rebuilds and are cleared only at run start. */
export let runStat = { noises:0, deaths:0, sealed:0 };

/* Cleared at run start so the pause timeline contains only this run. */
export let runHistory = [];

/* The title preview must match the next run, so roll the seed before repainting it. */
export function rollRunSeed(){
  setRunSeed((Math.random()*1e9)|0);
  buildFloor(0, RUN_SEED);
  emit(EVENT.splashRepaint);
}

/* The clear state holds the next floor ready while keeping its clock frozen. */
export let clearCard = { floor:0, clock:0, leaks:0, lifeforms:0 };

/* Data lives here; UI owns copy and DOM rendering. */
export function showClear(){
  emit(EVENT.clearShow);
  transition('clear');
  emit(EVENT.sfx, 'acclaim');
}

/* There is no way back through the clear card; transition clears held keys. */
export function dismissClear(){
  if (STATE!=='clear') return;
  transition('play');
}

/**
 * Changes run state and shell presentation.
 *
 * @param {string} to - the new state ('play', 'pause', 'dead', ...).
 * Clears held input so stale movement cannot carry into the new state.
 */
export function transition(to){
  /* Leaving for anything but the death screen (retry, pause, menus) ends the beat early. */
  if (to !== 'dead') endCatchPresentation();
  setState(to);
  emit(EVENT.screen, to === 'play' ? null : to);
  emit(EVENT.hud, to === 'play');
  clearInput();
  emit(EVENT.state, STATE);
}

/* Door completion either advances the run or sends it to the win screen. */
export function nextFloor(){
  /* Record the finished floor before G is replaced. */
  runHistory.push({
    floor: floorIdx,
    sealed: G ? G.totalLeaks - G.openLeaks : 0,
    total: G ? G.totalLeaks : 0,
    clockLeft: G ? G.clock : FLOOR_CLOCK,
    died: false,
  });
  setFloorIdx(floorIdx+1);
  if (floorIdx >= FLOORS){ transition('win'); emit(EVENT.win, runReport(FLOORS));
    return;
  }
  /* buildFloor replaces G, so read the remaining clock first. */
  const clockLeft = G ? G.clock : FLOOR_CLOCK;
  buildFloor(floorIdx, RUN_SEED);
  const spec = LEVELS[Math.min(floorIdx, LEVELS_N-1)];
  setClearCard({ floor:floorIdx, clock:clockLeft, leaks:spec.leaks, lifeforms:isEasyFloor() ? 0 : spec.lifeforms });
  showClear();
}

/* Results for the end-of-shift sheets. `floors` is how many floors the crew reached. */
function runReport(floors){
  return {
    sealed: runStat.sealed, deaths: runStat.deaths, noises: runStat.noises,
    floors, time: runTime, terms: currentTerms().label,
    /* The air for every floor: the time the early-completion premium is measured against. */
    parTime: FLOORS*currentTerms().clock,
    runHistory: runHistory.map(entry => ({ ...entry })),
  };
}

/* The shell uses these codes to select death copy. */
export const DEATH_CAUSE = Object.freeze({ CAUGHT: 'caught', CLOCK: 'clock' });

/**
 * Ends the attempt and reports why to the shell.
 *
 * @param {'caught'|'clock'} cause - one of DEATH_CAUSE.
 */
export function lose(cause){
  if (STATE!=='play') return;
  /* Snapshot attempt results before replacing G. */
  runHistory.push({
    floor: floorIdx,
    sealed: G.totalLeaks - G.openLeaks,
    total: G.totalLeaks,
    clockLeft: G.clock,
    died: true,
  });
  /* Stop the rest of this simulation frame before update() can advance the door. */
  G.ended = true;
  G.stat.deaths++;
  runStat.deaths++;
  setLives(lives-1);
  emit(EVENT.sfx, 'sting');
  /* A catch plays a short beat before the death card (see revealDeath). Running out of air does not. */
  if (cause === DEATH_CAUSE.CAUGHT) beginCatchPresentation();
  transition('dead');
  emit(EVENT.lives);
  emit(EVENT.dead, { lives, cause, report: runReport(floorIdx+1) });
}

export function caught(){ lose(DEATH_CAUSE.CAUGHT); }

/**
 * Shows the death card now. Called when the catch beat ends, or when the player skips it.
 *
 * @returns {boolean} true if a beat was playing and the card was revealed
 */
export function revealDeath(){
  if (!endCatchPresentation()) return false;
  emit(EVENT.screen, 'dead');
  return true;
}

/* Running out of air follows the same loss path as being caught. */
export function outOfTime(){ lose(DEATH_CAUSE.CLOCK); }

/* Round upward so the HUD never exposes a lower whole-second value. */
export function clockText(s){
  const t = Math.max(0, Math.ceil(s));
  return Math.floor(t/60) + ':' + String(t%60).padStart(2,'0');
}

/* Reset is armed briefly to require a confirmation gesture. */
export let resetArmed = false;
let resetArmTimer = 0;

function announceReset(){
  emit(EVENT.reset, resetArmed);
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
  if (resetArmTimer.unref) resetArmTimer.unref();
  announceReset();
}
export function resetRun(){
  /* Rebuild the title preview from the replacement run's seed. */
  rollRunSeed();
  setFloorIdx(0);
  setRunTime(0);
  setRunLives(currentTerms().lives);
  setLives(runLives);
  setRunStat({ noises:0, deaths:0, sealed:0 });
  emit(EVENT.lives);
  transition('splash');
  disarmReset();
}

/* UI buttons invoke these run actions. */
export function startRun(){
  /* Reuse the seed previewed on the title; a finished run rolls a new seed. */
  emit(EVENT.runStart);
  setRunLives(currentTerms().lives);
  setLives(runLives); setFloorIdx(0); setRunTime(0);
  setRunStat({ noises:0, deaths:0, sealed:0 });
  runHistory = [];
  emit(EVENT.lives);
  buildFloor(0, RUN_SEED);
  for (const lf of G.lifeforms){ lf.born = 3.0; }
  transition('play');
}

/* A retry preserves sealed leaks; with no lives left, start a new run. */
export function retryFloor(){
  if (lives<=0){ startRun(); return; }
  /* Snapshot sealed leaks before rebuilding, then rebuild flood sources. */
  const wasFixed = G.leaks.map(L => L.fixed);
  buildFloor(floorIdx, RUN_SEED);
  restoreSealed(G, wasFixed);
  initFlood(G);
  for (const lf of G.lifeforms){ lf.born=3.0; }
  transition('play');
}

/* Start a fresh building and run after the win screen. */
export function runAgain(){
  rollRunSeed();
  startRun();
}

/* Imported live bindings are assigned only through these setters. */
export function setState(v){ STATE = v; }
export function setLives(v){ lives = v; }
export function setFloorIdx(v){ floorIdx = v; }
export function setRunTime(v){ runTime = v; }
export function addRunTime(v){ runTime += v; }
export function setRunLives(v){ runLives = v; }
export function setRunStat(v){ runStat = v; }
export function setRunSeed(v){ RUN_SEED = v; }
export function setClearCard(v){ clearCard = v; }

/* Bind once at boot; translate simulation facts into run outcomes. */
export function bindRun(){
  on(EVENT.stat, k => { runStat[k]++; });
  on(EVENT.caught, caught);
  on(EVENT.clockOut, outOfTime);
  on(EVENT.doorCycled, nextFloor);
}