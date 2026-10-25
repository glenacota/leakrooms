/* ============================================================
   ADAPTIVE RESOLUTION
   Lowers the canvas resolution one step when frames are slow for a
   while, and raises it again when they are fast for a long while. The
   thresholds live in config/constants.js.

   It is a renderer concern: the loop only knows when a frame happened,
   so boot() hands adaptResolution to the loop through setFrameHooks.
   Keeping it out of resize() also means a window resize is never
   mistaken for a slow machine.
   ============================================================ */

import { SCALE_BAD_FRAMES, SCALE_DROP_MS, SCALE_GOOD_FRAMES, SCALE_RECOVER_MS, RENDER_SCALES } from '../config/constants.js';
import { STATE } from '../game/run.js';
import { renderScaleIdx, resize, setRenderScaleIdx } from './canvas.js';

let frameMsAvg = 16.7;
let badRun = 0, goodRun = 0;
let lastMark = performance.now();

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

  if (frameMsAvg > SCALE_DROP_MS){
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
  } else if (frameMsAvg < SCALE_RECOVER_MS){
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