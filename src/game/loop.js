/* ============================================================
   THE GAME LOOP
   frame() runs once per display refresh. It steps the simulation, draws, and
   keeps the frame rate healthy.
   ============================================================ */

import { SCALE_BAD_FRAMES, SCALE_DROP_MS, SCALE_GOOD_FRAMES, SCALE_RECOVER_MS, RENDER_SCALES } from '../config/constants.js';
import { renderScaleIdx, resize, setRenderScaleIdx } from '../render/canvas.js';
import { setSimAlpha } from '../render/passes/actors.js';
import { update } from '../sim/update.js';
import { G } from '../sim/state.js';
import { on } from '../util/events.js';
import { addRunTime, STATE } from './run.js';

let frameMsAvg = 16.7;
let badRun = 0, goodRun = 0;

/* The loop does not know how a frame is drawn or what the shell does after a
   step. boot() passes both in, so the loop can be read and tested without a
   renderer or a HUD. */
let renderHook = ()=>{};
let afterUpdate = ()=>{};
export function setFrameHooks(h){
  if (h.render)     renderHook = h.render;
  if (h.afterUpdate) afterUpdate = h.afterUpdate;
}

/* ---------- Fixed simulation step ----------
   The simulation always moves in whole steps of 1/60 s, however long the
   frame took. A frame that took longer runs several steps to catch up, and
   whatever is left over is passed to the renderer as a fraction (simAlpha)
   so movement looks smooth between steps.

   The simpler alternative was to pass the real frame time to update(). That
   makes the game run in slow motion on slow machines (the clock, the flood and
   the repair bar all fall behind real time), so a player on a slow machine
   would not be playing the same game.

   update(dt) itself is unchanged: the tests call it directly with any dt. */
const SIM_STEP    = 1/60;

/* At most this many steps per frame. It keeps the game on real time down to
   about 10 fps (a 100 ms frame is six steps). On a slower machine the game
   runs slightly slow instead of owing more steps every frame. */
const MAX_STEPS   = 6;
let   simAcc      = 0;
let   last        = performance.now();

/* ---------- Error handling ----------
   frame() asks for the next frame BEFORE doing its work, so one exception
   cannot stop the loop. A single failed frame is usually a hiccup that
   recovers. After MAX_FAILURES in a row the loop gives up and shows the fatal
   card through the hook that boot() installs. */
const MAX_FAILURES = 3;
let fails = 0, dead = false;
let fatalHook = ()=>{};
export function setFatalHook(fn){ fatalHook = fn; }

/* ---------- When to draw ----------
   Outside of play, the game world does not change, so drawing it 60 times a
   second would produce the same picture every time:
     splash  never drawn (the title screen is opaque and covers the canvas)
     cards   drawn when the state, window size or settings change, plus a
             slow heartbeat so the tape effects keep moving
     play    drawn every frame

   needsRedraw is a flag set by events, not a comparison of pictures, so the
   loop does not have to know about the HUD or the settings panel. */
const IDLE_REDRAW_MS = 250;
let needsRedraw = true;
let lastRedraw  = 0;
let lastState   = null;
on('resize',          ()=>{ needsRedraw = true; });
on('settings:changed',()=>{ needsRedraw = true; });

function shouldRender(now){
  if (STATE==='play')  return true;
  if (STATE==='splash') return false;
  if (STATE!==lastState){ lastState = STATE; needsRedraw = true; }
  if (!needsRedraw && now - lastRedraw < IDLE_REDRAW_MS) return false;
  needsRedraw = false;
  lastRedraw  = now;
  return true;
}

/**
 * One animation frame: step the simulation, refresh the HUD, draw, and
 * adjust resolution if the frame rate is poor. Called by requestAnimationFrame.
 *
 * @param {number} now - the browser's frame timestamp in milliseconds.
 */
export function frame(now){
  if (dead) return;
  requestAnimationFrame(frame);
  try {
    let dt = (now-last)/1000;
    last = now;
    /* A tab that was in the background returns with a huge dt. Capping the
       accumulator (not each step) stops the game from trying to simulate
       the whole absence in a single frame. */
    simAcc = Math.min(simAcc + dt, SIM_STEP*MAX_STEPS);

    if (STATE==='play'){
      let steps = 0;
      while (simAcc >= SIM_STEP && steps < MAX_STEPS){
        addRunTime(SIM_STEP);
        update(SIM_STEP);
        simAcc -= SIM_STEP;
        steps++;
        /* update() can end the run (a death, or the door loading the next
           floor). Stop stepping and clear the leftover time so it does not
           carry into the new floor. */
        if (STATE!=='play'){ simAcc = 0; break; }
      }
      setSimAlpha(simAcc / SIM_STEP);   // 0..1: how far we are into the next step
      // Steps owed beyond MAX_STEPS are dropped instead of building up a debt.
      if (simAcc >= SIM_STEP) simAcc = 0;
      afterUpdate();
    } else {
      simAcc = 0;
    }
    /* Frame time is measured across the whole frame, because that is what the
       player experiences as smoothness. It is the only honest input for the
       adaptive resolution. */
    const frameMs = now - lastRenderStart;
    lastRenderStart = now;
    if (frameMs > 0 && frameMs < 1000) adaptResolution(frameMs);

    if (G && shouldRender(now)) renderHook(now);

    fails = 0;
  } catch (err){
    if (++fails >= MAX_FAILURES){ dead = true; fatalHook(err); }
  }
}
let lastRenderStart = performance.now();

/* ---------- Adaptive resolution ----------
   Lowers the canvas resolution one step when frames are slow for a while, and
   raises it again when they are fast for a long while. The thresholds are in
   config/constants.js. This is kept out of resize() so that a window resize
   is never mistaken for a slow machine. */
function adaptResolution(ms){
  /* Use a running average, so one slow frame (garbage collection, a tab
     switch) does not cost a resolution step. */
  frameMsAvg += (ms - frameMsAvg) * 0.05;

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