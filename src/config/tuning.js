import { LEVELS_N } from './levels.js';

export const FLOORS = LEVELS_N;

/* 0 is open and loop-heavy; 1 is dense and dead-end-heavy. */
export const MAZE_DENSITY = 0.6;

/* The budget includes sealing every leak and walking back to the door. */
export let FLOOR_CLOCK = 180;
export let REPAIR_TIME = 5.0;
export let HUNT_BASE = 3.45;
export let HUNT_STEP = 0.34;

/**
 * Copies a difficulty preset into the live tuning values.
 *
 * @param {object} d - One difficulty preset.
 */
export function applyDifficulty(d){
  FLOOR_CLOCK = d.clock;
  REPAIR_TIME = d.repairTime;
  HUNT_BASE = d.huntBase;
  HUNT_STEP = d.huntStep;
}