/* ============================================================
   ADAPTIVE RESOLUTION
   Lowers the canvas resolution one step when frames are slow for a
   while, and raises it again when they are fast for a long while. The
   thresholds live in config/constants.js.

   The drop/recover thresholds are fractions of the estimated refresh
   interval (SCALE_DROP_RATIO / SCALE_RECOVER_RATIO), not fixed
   milliseconds: a display capped at 30 fps is throttled, not slow, so
   quality must not be lowered for it. The refresh interval is estimated
   from the first 120 frame deltas during play; until the estimate exists
   the game behaves exactly as it did with fixed 20 ms / 12 ms thresholds.

   It is a renderer concern: the loop only knows when a frame happened,
   so boot() hands adaptResolution to the loop through setFrameHooks.
   Keeping it out of resize() also means a window resize is never
   mistaken for a slow machine.
   ============================================================ */

import { SCALE_BAD_FRAMES, SCALE_DROP_RATIO, SCALE_GOOD_FRAMES, SCALE_RECOVER_RATIO, RENDER_SCALES } from '../config/constants.js';
import { STATE } from '../game/run.js';
import { renderScaleIdx, resize, setRenderScaleIdx } from './canvas.js';

/* Running average of the whole frame time (the gap between two frames),
   exposed so the frame-time overlay can read it. */
let frameMsAvg = 16.7;

/* Refresh-interval estimation. Collect the first 120 frame deltas while
   playing. If at least 80% land within 3 ms of 33.3 ms the display is
   capped at 30 fps (refreshMs = 33.3); otherwise refreshMs = 16.7 (a
   120 Hz display also counts as 16.7: the floor is 16.7). null means the
   estimate has not been made yet, and the fixed 16.7 ms floor is used. */
let refreshMs = null;
let refreshSamples = [];
const REFRESH_SAMPLES = 120;
const REFRESH_TARGET_30 = 33.3;
const REFRESH_TOLERANCE = 3;
const REFRESH_FLOOR = 1000 / 60;   // 16.67 ms: 60 Hz, and the floor for 120 Hz too

let badRun = 0, goodRun = 0;
let lastMark = performance.now();

function estimateRefresh(){
  const at30 = refreshSamples.filter(d => Math.abs(d - REFRESH_TARGET_30) <= REFRESH_TOLERANCE).length;
  refreshMs = at30 >= 0.8 * REFRESH_SAMPLES ? REFRESH_TARGET_30 : REFRESH_FLOOR;
  refreshSamples = null;
}

/**
 * Fed once per frame with the browser's frame timestamp. The gap between
 * two calls is the whole frame time, because that is what the player
 * experiences as smoothness — the only honest input for this decision.
 *
 * @param {number} now - frame timestamp in milliseconds.
 * @returns {'drop'|'raise'|null} what it did, for tests and callers.
 */
export function adaptResolution(now){
  const frameMs = now - lastMark;
  lastMark = now;
  if (frameMs <= 0 || frameMs >= 1000) return null;
  /* Use a running average, so one slow frame (garbage collection, a tab
     switch) does not cost a resolution step. */
  frameMsAvg += (frameMs - frameMsAvg) * 0.05;

  /* Collect refresh-estimation samples while playing, before any threshold
     decision is made. Until the estimate exists the thresholds fall back to
     the 16.7 ms floor, which is exactly the old fixed behaviour (20 ms drop,
     12 ms raise). While estimating we suspend the drop/raise decision, so a
     display capped at 30 fps is not mistaken for a slow machine during the
     first 120 frames. */
  if (refreshSamples !== null){
    if (STATE === 'play'){
      refreshSamples.push(frameMs);
      if (refreshSamples.length >= REFRESH_SAMPLES) estimateRefresh();
    }
    return null;
  }

  const dropThreshold = SCALE_DROP_RATIO * (refreshMs || REFRESH_FLOOR);
  const recoverThreshold = SCALE_RECOVER_RATIO * (refreshMs || REFRESH_FLOOR);

  if (frameMsAvg > dropThreshold){
    goodRun = 0; badRun++;
    /* Only while playing, in both directions. On the title screen and the
       cards the canvas is not drawn, and changing resolution there would
       rebuild the grain and the splash plan for nothing. */
    if (badRun > SCALE_BAD_FRAMES && renderScaleIdx < RENDER_SCALES.length-1 && STATE==='play'){
      setRenderScaleIdx(renderScaleIdx+1);
      badRun = 0; frameMsAvg = 16.7;      // measure again at the new size
      resize();
      return 'drop';
    }
  } else if (frameMsAvg < recoverThreshold){
    badRun = 0; goodRun++;
    if (goodRun > SCALE_GOOD_FRAMES && renderScaleIdx > 0 && STATE==='play'){
      setRenderScaleIdx(renderScaleIdx-1);
      goodRun = 0; frameMsAvg = 16.7;
      resize();
      return 'raise';
    }
  } else {
    badRun = 0; goodRun = 0;
  }
  return null;
}

/**
 * The running average frame time in milliseconds, for the frame-time overlay.
 *
 * @returns {number} average frame ms.
 */
export function getFrameMsAvg(){
  return frameMsAvg;
}

/**
 * The estimated refresh interval in milliseconds, for the frame-time overlay.
 *
 * @returns {number|null} refresh ms, or null until the estimate exists.
 */
export function getRefreshMs(){
  return refreshMs;
}

/* Test-only: reset the adaptive state so scenarios are independent, since the
   refresh estimate is computed once from the first 120 play frames. */
export function resetAdaptiveForTests(){
  frameMsAvg = 16.7;
  refreshMs = null;
  refreshSamples = [];
  badRun = 0; goodRun = 0;
  lastMark = performance.now();
}

