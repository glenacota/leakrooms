/* ============================================================
   WHEN THE HUD PANEL SHOWS ON TOUCH
   A phone screen is small and a thumb covers a lot of it, so in touch mode the
   instrument panel fades out while nothing needs reading and comes back when
   something does. This file is the rule and nothing else: no DOM, no clock
   read, no game state import. The caller passes time in, and builds the
   snapshot (buildHudSnap below).
   ============================================================ */
import { BATT_LOW, LOUD } from '../config/constants.js';

/* The tunables, in one place. Times are milliseconds. */
export const HUD_RULES = {
  HOLD_MS: 2500,          // the panel stays up this long after the LAST trigger
  NOISE_FRAC: 0.5,        // your own noise at this share of LOUD brings the panel back (a wet step does, a dry one does not)
  CLOCK_S: 30,            // the clock at or below this: the same moment the 30 second warning fires
  FLOOR_START_MS: 3000,   // a new floor shows the panel this long, whatever else is going on
  LIFE_LOST_HOLD_MS: 4000,// a lost life is worth a longer look
};

/* How long each trigger keeps the panel up AFTER it stops being true. Floor
   start has no tail: its own window is the whole show. */
const TAIL = {
  noise: HUD_RULES.HOLD_MS,
  battery: HUD_RULES.HOLD_MS,
  clock: HUD_RULES.HOLD_MS,
  repair: HUD_RULES.HOLD_MS,
  life: HUD_RULES.LIFE_LOST_HOLD_MS,
  floor: 0,
};

/**
 * Turns the game state into the small plain object hudVisibility reads. The
 * state is passed in, so this stays free of imports from sim/ and game/.
 *
 * @param {object} G - the floor state
 * @param {number} livesLeft - lives in the run
 * @param {number} nowMs - the caller's clock
 */
export function buildHudSnap(G, livesLeft, nowMs){
  let repairProgress = 0;
  for (const L of G.leaks) if (!L.fixed && L.repair > repairProgress) repairProgress = L.repair;
  return {
    /* Your own noise, not the building's. The open leaks hiss all the time, so
       the total would keep the panel up for the whole floor. */
    noise: G.selfNoise,
    loud: G.selfNoise >= LOUD,
    battery: G.batt,
    batteryLow: G.batt <= BATT_LOW,
    radarOn: !!G.radar,
    clockSeconds: G.clock,
    lives: livesLeft,
    repairProgress,
    // The floor's own clock counts up from its start, so the start moment follows from it.
    floorStartedMs: nowMs - G.time*1000,
  };
}

/**
 * Decides whether the panel is visible.
 *
 * @param {object} snap - from buildHudSnap
 * @param {{lives?:number, lastTriggerMs?:number}|null} prev - what this function
 *   and the caller kept from the last call: the lives then, and the last trigger time
 * @param {number} nowMs
 * @param {string} [mode] - 'always', 'minimal', anything else is 'auto'
 * @returns {{visible:boolean, lastTriggerMs:number}}
 */
export function hudVisibility(snap, prev, nowMs, mode){
  let last = prev && Number.isFinite(prev.lastTriggerMs) ? prev.lastTriggerMs : -Infinity;
  const minimal = mode === 'minimal';

  /* Each entry: is it true now, and how long does it stay after. Minimal mode
     keeps only the two readings that matter every second: noise and the clock. */
  const noisy = snap.loud || snap.noise >= HUD_RULES.NOISE_FRAC * LOUD;
  const triggers = [
    ['noise', noisy],
    ['clock', snap.clockSeconds <= HUD_RULES.CLOCK_S],
  ];
  if (!minimal){
    triggers.push(
      ['battery', snap.batteryLow || snap.radarOn],
      ['repair', snap.repairProgress > 0],
      ['life', !!prev && typeof prev.lives === 'number' && snap.lives < prev.lives],
      ['floor', nowMs - snap.floorStartedMs < HUD_RULES.FLOOR_START_MS],
    );
  }

  /* A trigger that is true now is recorded as if it fired `tail` ms short of
     now, so one number and one HOLD_MS rule cover every tail length. */
  let active = false;
  for (const [name, on] of triggers){
    if (!on) continue;
    active = true;
    last = Math.max(last, nowMs + TAIL[name] - HUD_RULES.HOLD_MS);
  }

  /* Loud never hides: the panel is where the red mark is. */
  const visible = mode === 'always' || snap.loud || active || nowMs - last < HUD_RULES.HOLD_MS;
  return { visible, lastTriggerMs: last };
}
