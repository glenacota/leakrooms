/* ============================================================
   CATCH PRESENTATION
   The short beat between a lifeform catching the plumber and the death card.
   It is presentation only. The run has already ended when it starts (crew
   count, retry and run history are settled by lose()), and the simulation
   does not step while it plays. This module only keeps the clock and the
   on/off answer that the shell and the renderer read.
   Time is the browser's timeline (performance.now / requestAnimationFrame),
   so the loop and the renderer see the same value.
   ============================================================ */

export const CATCH_MS = 800;
export const CATCH_SKIP_GRACE_MS = 100;

let startedAt = null;

/** Starts the beat. Called once, when the run ends by being caught. */
export function beginCatchPresentation(now = performance.now()){
  startedAt = now;
}

/** True while the beat is playing. */
export function catchPresenting(){
  return startedAt !== null;
}

/**
 * Position in the beat, 0 at the catch and 1 at its end.
 * Returns 1 when no beat is playing, so callers can treat "done" and "none" alike.
 *
 * @param {number} [now]
 * @returns {number}
 */
export function catchProgress(now = performance.now()){
  if (startedAt === null) return 1;
  return Math.min(1, Math.max(0, (now - startedAt) / CATCH_MS));
}

/** True once the beat has run its full length. */
export function catchDue(now = performance.now()){
  return startedAt !== null && now - startedAt >= CATCH_MS;
}

/** True only after repeated input has had time to stop suppressing a new catch beat. */
export function catchSkippable(now = performance.now()){
  return startedAt !== null && now - startedAt >= CATCH_SKIP_GRACE_MS;
}

/**
 * Ends the beat. Returns whether one was playing, so a caller can act once.
 *
 * @returns {boolean}
 */
export function endCatchPresentation(){
  const was = startedAt !== null;
  startedAt = null;
  return was;
}
