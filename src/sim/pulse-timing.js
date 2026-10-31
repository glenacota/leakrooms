/* ============================================================
   PULSE TIMING
   When a steady sound (the wrench, the radar) sends out its next pulse. Each
   sound pulse is drawn as a full circle at the sound's hearing reach, so the
   geometry lives in render/passes/pulses.js. This file only keeps the beat.
   ============================================================ */

/* The sim runs at a fixed 1/60 s. A steady sound repeats every PULSE_TICKS
   ticks: 30 ticks is half a second, close to the footstep beat. Counting ticks
   keeps the cadence deterministic and needs no dt. */
export const PULSE_TICKS = 30;

/**
 * Counts down a steady sound's pulse timer by one tick. Returns true on the
 * tick a pulse is due and restarts the count. A holder with no timer yet
 * (undefined) pulses at once.
 *
 * @param {{pulseTicks?: number}} holder - an object that owns the timer.
 * @returns {boolean}
 */
export function pulseDue(holder){
  holder.pulseTicks = (holder.pulseTicks || 0) - 1;
  if (holder.pulseTicks <= 0){
    holder.pulseTicks = PULSE_TICKS;
    return true;
  }
  return false;
}
