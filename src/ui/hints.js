import { LOUD } from '../config/constants.js';
import { REPAIR_TIME } from '../config/tuning.js';
import { STATE } from '../game/run.js';
import { G } from '../sim/state.js';
import { emit, on } from '../util/events.js';

const announced = new Set();

/* Floor-1 teaching flags. Module state, not floor's. */
let f1Wet = false, f1Stand = false, f1Door = false;
let doorSince = 0;      // performance.now() the plumber arrived at a locked door
let doorLast = -1e9;    // performance.now() of the last DOOR LOCKED cue

/** Flashes once when the player's own noise first crosses LOUD in a run. */
export function tickLoudFlash(){
  if (!announced.has('LOUD') && G && G.selfNoise >= LOUD){
    announced.add('LOUD');
    emit('flash', { cat: 'danger', text: 'YOU ARE LOUD — SOMETHING CAN HEAR THAT' });
  }
}

/* The plumber is on a door tile: within 1.25 tiles of an exit, the same
   threshold sim/door.js uses for the hold itself. */
function atDoor(){
  if (!G || !G.plumber || !G.exitTiles) return false;
  const p = G.plumber;
  for (const e of G.exitTiles){
    if (Math.hypot(e.x + 0.5 - p.x, e.y + 0.5 - p.y) < 1.25) return true;
  }
  return false;
}

/* Door-locked and floor-1 teaching cues. Runs once per frame while playing. */
export function tickCues(){
  if (!G) return;
  const now = performance.now();

  /* DOOR LOCKED — standing at the door with leaks still open. */
  if (G.openLeaks > 0 && atDoor()){
    if (!doorSince) doorSince = now;
    if (now - doorSince >= 800 && now - doorLast >= 20000){
      doorLast = now;
      emit('flash', { cat: 'alert',
              text: `DOOR LOCKED — ${G.openLeaks} LEAK${G.openLeaks === 1 ? '' : 'S'} OPEN` });
    }
  } else {
    doorSince = 0;
  }

  /* Floor-1 teaching: three one-time GUIDE cues, only on the first floor.
     After floor 1 the world carries the loop and cues report events only. */
  if (G.floor === 0){
    /* Water is the main clue; a floor-1 player needs the sentence once. The
       20 s fallback catches a player who never walks into water. */
    if (!f1Wet && (G.wet > 0 || G.time >= 20)){
      f1Wet = true;
      emit('flash', { cat: 'guide', text: 'FOLLOW THE WET FLOOR TO FIND THE LEAK' });
    }
    /* The repair ring needs progress to appear, so the standing spot has no
       feedback until it is too late to learn what it is for. */
    if (!f1Stand && G.atLeak){
      f1Stand = true;
      emit('flash', { cat: 'guide', text: `STAND STILL — ${REPAIR_TIME} SECONDS` });
    }
    /* The door hold only starts once every leak is sealed, so a first-time
       player has no reason to stand there until told. */
    if (!f1Door && G.descend > 0.02){
      f1Door = true;
      emit('flash', { cat: 'guide', text: 'STAND BY THE DOOR TO OPEN IT' });
    }
  }
}

/** Wires the stealth hints and resets their once-per-run announcements. */
export function bindHints(){
  on('state', () => {
    if (STATE === 'splash'){
      announced.clear();
      f1Wet = f1Stand = f1Door = false;
      doorSince = 0;
      doorLast = -1e9;
    }
  });
  on('heard', ({ to }) => {
    const msg = to === 'RISING' ? 'SOMETHING WOKE UP'
      : to === 'SEARCH' ? 'SOMETHING HEARD YOU'
      : to === 'HUNT' ? "SOMETHING IT'S AFTER YOU"
      : null;
    if (msg && !announced.has(to)){
      announced.add(to);
      emit('flash', { cat: 'danger', text: msg });
    }
  });
}
