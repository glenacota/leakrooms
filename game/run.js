import { BATT_MAX } from '../config/constants.js';
import { LEVELS, LEVELS_N } from '../config/levels.js';
import { DIFFICULTIES } from '../config/presets.js';
import { FLOOR_CLOCK, FLOORS } from '../config/tuning.js';
import { SETTINGS } from '../settings/store.js';
import { Audio_ } from '../src/audio/index.js';
import { emit, on } from '../util/events.js';
import { initFlood } from '../sim/flood.js';
import { keys } from '../sim/keys.js';
import { snapMask } from '../sim/vision.js';
import { G } from '../sim/state.js';
import { paintSplashPlan } from '../render/splash-plan.js';
import { buildFloor } from './floor.js';

/* ============================================================
   FLOW
   The run: its state, and every way it starts, ends, rewinds or
   continues. The state is exported as live bindings and written
   through setters, because an importer may read it but must not
   assign to it.
   ============================================================ */
export let STATE='splash';      // splash | order | clear | play | pause | dead | win

export let RUN_SEED = (Math.random()*1e9)|0;
export let lives = 3, floorIdx = 0, runTime = 0;
/* The life pips are drawn from this, not from a hardcoded three. The naive
   version maps over [0,1,2], so RELAXED would render five pips with the fifth
   always spent and HARD would render three for a one-life run. */
export let runLives = 3;
/* The run's own totals. G.stat is thrown away and rebuilt by buildFloor, so
   everything it counted died with the floor it was counted on: the win card
   read the LAST level's numbers and called them the run's. runStat lives as
   long as the run does, is bumped beside every G.stat bump, and is cleared
   only where a run starts — the CLOCK IN button. */
export let runStat = { noises:0, deaths:0, sealed:0 };

/* A new run gets a new plan, and the splash is repainted to match even though
   nobody is looking at it yet: the win screen's RUN IT AGAIN button leads back
   through here, and a title screen showing the level you just finished would be
   the sort of small mistake that makes a procedural game feel hand-authored in
   the wrong direction. */
export function rollRunSeed(){
  setRunSeed((Math.random()*1e9)|0);
  buildFloor(0, RUN_SEED);
  paintSplashPlan();
}

/* THE FLOOR CLEAR.
   Between one level and the next there is a card: the clock you finished with,
   and the shape of the floor you are about to walk into. It exists for two
   reasons and neither of them is vibes — a level transition that silently
   restarts a running clock is the single most unfair thing this game could do,
   and a player who does not know the next floor carries four pipes and four
   things is walking into it with the wrong amount of caution.

   THE FLOOR IS ALREADY BUILT when this comes up. nextFloor() does its usual
   floorIdx++ / buildFloor in the same frame the door cycles, and 'clear' only
   holds the PLAYER out of it. Nothing about the state depends on the card being
   dismissed, and the tests that watch floorIdx move on the descent frame keep
   working without knowing this screen exists. */
export let clearCard = { floor:0, clock:0, leaks:0, forms:0 };
export function showClear(){
  const el = id => document.getElementById(id);
  el('clear-clock').textContent = clockText(clearCard.clock);
  el('clear-floor').textContent  = clearCard.floor+1;
  el('clear-leaks').textContent  = clearCard.leaks;
  el('clear-forms').textContent  = clearCard.forms;
  /* The praise scales with the clock, and only with the clock. Nailing a floor
     on the last few seconds gets the warm line; scraping back in does not, and
     the game does not congratulate you for the version where you nearly died. */
  el('clear-sub').textContent =
    clearCard.clock >= FLOOR_CLOCK*0.34 ? 'GOOD WORK. MANAGEMENT NOTICES.'
                                      : 'SEALED. MANAGEMENT HAS NO COMMENT.';
  setState('clear');
  emit('hud', false);
  emit('screen', 'clear');
  emit('state', STATE);
  Audio_.acclaim();
}
/* ENTER, and the button, and nothing else. There is no clock on this card and
   no way back into it — the floor behind it is sealed and the floor in front of
   it is already running. ESC deliberately does nothing here: backSplash() only
   walks the title chain, so the key falls through to the play/pause toggle,
   which is also inert while STATE is 'clear'. */
export function dismissClear(){
  if (STATE!=='clear') return;
  setState('play');
  emit('screen', null);
  emit('hud', true);
  /* Every key down to nothing. The player is almost certainly holding W — they
     walked to the door — and that keydown is still set, so the first frame of
     the new floor would walk them back through it. Same reason the splash chain
     drops the key that dismissed it. */
  for (const k in keys) delete keys[k];
  emit('state', STATE);
}

export function nextFloor(){
  setFloorIdx(floorIdx+1);
  if (floorIdx >= FLOORS){ setState('win'); emit('win', { sealed: runStat.sealed, deaths: runStat.deaths, noises: runStat.noises, floors: FLOORS, time: runTime });
    emit('hud', false);
    emit('screen', 'win');
    return;
  }
  /* The clock is read off the OLD floor, before the rebuild — G is replaced
     wholesale by buildFloor and the leftover seconds of the floor you just
     finished are the whole point of the card. */
  const clockLeft = G ? G.clock : FLOOR_CLOCK;
  buildFloor(floorIdx, RUN_SEED);
  /* The briefing reads the same table buildFloor reads, through the same
     clamp, so the numbers on the card are the numbers on the floor. */
  const spec = LEVELS[Math.min(floorIdx, LEVELS_N-1)];
  setClearCard({ floor:floorIdx, clock:clockLeft, leaks:spec.leaks, forms:spec.forms });
  showClear();
}

/* Every way a run can end badly costs a life, rewinds the level and says why.
   Two causes, one exit: something found you, or the clock ran out. They are
   the same shape because they are the same decision — you did not get back to
   the door in time — and one screen for both means the player is never left
   guessing which rule they broke. */
export function lose(cause){
  if (STATE!=='play') return;
  G.stat.deaths++;
  runStat.deaths++;
  setLives(lives-1);
  Audio_.sting(); Audio_.silence(); Audio_.silenceBeds();
  setState('dead');
  emit('lives');
  emit('hud', false);
  emit('dead', { lives, cause });
  emit('screen', 'dead');
}

export function caught(){ lose('TAPE DAMAGED'); }

/* Out of time. The same cost as being caught — a life and a rewound level —
   because a clock is only a real deadline if it can actually kill you. If it
   only scolded you, three minutes would be advice. */
export function outOfTime(){ lose('THE CLOCK RAN OUT'); }

/* m:ss, floored. The clock is read at a glance while running, so it never
   shows a value it would not show again a frame later — it counts down on whole
   seconds and that is all. */
export function clockText(s){
  const t = Math.max(0, Math.ceil(s));
  return Math.floor(t/60) + ':' + String(t%60).padStart(2,'0');
}

export let resetArmed = false;
let resetArmTimer = 0;
const RESET_LABEL  = 'RESET GAME';
const RESET_ARMED  = 'TAP AGAIN — LOSES THE RUN';

export function paintResetButton(){
  const b = document.getElementById('btn-reset-run');
  if (b) b.textContent = resetArmed ? RESET_ARMED : RESET_LABEL;
}
export function disarmReset(){
  resetArmed = false;
  clearTimeout(resetArmTimer);
  paintResetButton();
}
export function armReset(){
  resetArmed = true;
  clearTimeout(resetArmTimer);
  resetArmTimer = setTimeout(disarmReset, 5000);
  paintResetButton();
}
export function resetRun(){
  /* The same path boot walks: a new seed, the floor built from it, the plan
     painted from the same seed — so the riser shows the building the next
     run is actually about to be, not a picture of the one just abandoned. */
  rollRunSeed();
  setFloorIdx(0);
  setRunTime(0);
  setRunLives((DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal).lives);
  setLives(runLives);
  setRunStat({ noises:0, deaths:0, sealed:0 });
  emit('lives');
  /* The HUD belongs to a run; the riser is not one. */
  emit('hud', false);
  setState('splash');
  emit('screen', 'splash');
  emit('state', STATE);
  disarmReset();
}

/* The three buttons on the shell, as functions. They were inline onclick
   bodies; the wiring stays in game.js and these are what it calls. */
export function startRun(){
Audio_.init();
Audio_.unlock();
/* The seed is NOT rolled here. It was rolled before the splash was painted,
   because the plan behind the title has to be the level the player is about
   to walk — re-rolling at the moment of entry would make the splash a lie
   and nothing else. A finished run rolls its own; see rollRunSeed(). */
setRunLives((DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal).lives);
setLives(runLives); setFloorIdx(0); setRunTime(0);
/* A new run, so a new tally: the win card is the only reader and it must not
   inherit the previous run's seals and deaths. */
setRunStat({ noises:0, deaths:0, sealed:0 });
emit('lives');
/* Floor 0 was already built at boot — the same seed, the same geometry the
   splash plan was painted from — so building it again here generates the
   identical level a second time for nothing. Reuse it instead.

   The extra two conditions are what stop the reuse from handing back a
   PLAYED floor: a run that died on floor 1 and came back through CLOCK IN
   (lives spent, btn-retry forwards to here) has the same seed and the same
   floor number, but its pipes are sealed and its clock has run. A floor
   that has never ticked and still has every pipe open is the only floor
   worth keeping. The clock check also catches a difficulty change made
   after boot, whose FLOOR_CLOCK the boot floor was never built with. */
const reuse = G && G.floor===0 && G.seed===RUN_SEED
              && G.clock >= FLOOR_CLOCK && G.leaksOpen === G.pipes;
if (!reuse) buildFloor(0, RUN_SEED);
else {
  G.clock = FLOOR_CLOCK; G.time = 0; G.batt = BATT_MAX;
  G.stat = {noises:0, deaths:0, sealed:0};
  G.radar = false; G.noise = 0; G.noisePeak = 0; G.selfNoise = 0; G.descend = 0; G.seenBy = 0;
  initFlood();          // the flood the builder warmed, warmed again here
  snapMask();
}
/* The opening grace period, on the start path either way — reuse and a
   fresh build have to be indistinguishable from where the player stands. */
for (const a of G.agents){ a.born = 3.0; }
emit('screen', null);
setState('play');
emit('hud', true);
emit('state', STATE);        // the title bed has no business following you downstairs
}

export function retryFloor(){
if (lives<=0){
  document.getElementById('btn-start').click(); return;
}
buildFloor(floorIdx, RUN_SEED);
G.batt = Math.max(G.batt, 55);
/* The retry keeps the same seed, so the pipes are where you left them and
   the flood restarts. Dying costs you a life and the work you did on them,
   but not the knowledge — which is the split that matters, because where the
   pipes are is the thing you spent the level learning and a re-roll would
   erase it. */
for (const a of G.agents){ a.born=3.0; }
emit('screen', null); setState('play');
emit('hud', true);
emit('state', STATE);
}

export function runAgain(){
rollRunSeed();                 // a new run deserves a new building
document.getElementById('btn-start').click();
}

/* ---- the setters. An exported `let` is a live binding: importers see every
   write, but only this module may assign, so each write goes through one of
   these and there is exactly one place the run can change. ---- */
export function setState(v){ STATE = v; }
export function setLives(v){ lives = v; }
export function setFloorIdx(v){ floorIdx = v; }
export function setRunTime(v){ runTime = v; }
/* the loop bills the run for each simulation step, not the caller */
export function addRunTime(v){ runTime += v; }
export function setRunLives(v){ runLives = v; }
export function setRunStat(v){ runStat = v; }
export function setRunSeed(v){ RUN_SEED = v; }
export function setClearCard(v){ clearCard = v; }

/* ---- the event wiring. The simulation reports four facts and decides nothing
   about what they mean: a stat was counted, something caught you, the clock ran
   out, the door cycled. Each is answered here, which is why the run's counters
   live as long as the run does. ---- */
export function bindRun(){
  on('stat', k => { runStat[k]++; });
  on('caught', caught);
  on('clock:out', outOfTime);
  on('door:cycled', nextFloor);
}
