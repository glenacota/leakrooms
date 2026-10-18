import { LEVELS_N } from './levels.js';

/* ============================================================
   TUNING: values that depend on the chosen difficulty
   These are `let` because applyDifficulty() overwrites them from the selected
   preset (see presets.js). applySettings() in ui/bind.js calls it at load and
   whenever a setting changes, and other modules see the new value through the
   live binding.

   The starting values below are the NORMAL preset. The noise constants in
   constants.js are not part of this: difficulty never changes them.
   ============================================================ */

export let FLOORS = LEVELS_N;

/* How long you get on each level to seal every pipe and walk back to the door
   you came in through. This is the pressure of a floor: the water is the
   excuse, and the walk back is what actually spends the time. */
export let FLOOR_CLOCK = 180;      // seconds
export let REPAIR_TIME = 5.0;      // seconds of unbroken contact to seal a pipe
export let HUNT_BASE = 3.45;       // tiles per second for a hunting lifeform on level 1
export let HUNT_STEP = 0.34;       // extra speed added per level

/**
 * Copies a difficulty preset into the live tuning values.
 *
 * @param {object} d - one entry of DIFFICULTIES (see presets.js).
 */
export function applyDifficulty(d){
  FLOORS = LEVELS_N;
  FLOOR_CLOCK = d.clock;
  REPAIR_TIME = d.repairTime;
  HUNT_BASE = d.huntBase;
  HUNT_STEP = d.huntStep;
}