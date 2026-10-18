import { LEVELS_N } from './levels.js';

/* These are `let` because applyDifficulty() overwrites them from the chosen preset
   (config/presets.js); applySettings() in game.js calls it at load and on every
   settings change, and importers see the live binding. The initialisers are the
   NORMAL preset and are the documented tuning. The noise table in constants.js is
   NOT among them, and deliberately so — see DIFFICULTIES. */
export let FLOORS = LEVELS_N;
/* How long you have on each level to seal every pipe and get back to the door
   you came in through. This is the whole pressure of a floor: the water is the
   clock's excuse, the walk back is what it actually spends. */
export let FLOOR_CLOCK = 180;      // seconds; NORMAL
export let REPAIR_TIME = 5.0;    // seconds of unbroken contact to seal the pipe
export let HUNT_BASE = 3.45;           // tiles/sec, a committed Lifeform on level 1
export let HUNT_STEP = 0.34;           // extra per level

export function applyDifficulty(d){
  FLOORS = LEVELS_N;
  FLOOR_CLOCK = d.clock;
  REPAIR_TIME = d.repairTime;
  HUNT_BASE = d.huntBase;
  HUNT_STEP = d.huntStep;
}
