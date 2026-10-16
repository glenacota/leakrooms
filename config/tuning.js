import { LEVELS_N } from './levels.js';

export let FLOORS = LEVELS_N;
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
