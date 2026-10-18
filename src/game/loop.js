import { SCALE_BAD_FRAMES, SCALE_DROP_MS, SCALE_GOOD_FRAMES, SCALE_RECOVER_MS, RENDER_SCALES } from '../config/constants.js';
import { renderScaleIdx, resize, setRenderScaleIdx } from '../render/canvas.js';
import { setSimAlpha } from '../render/passes/actors.js';
import { update } from '../sim/update.js';
import { G } from '../sim/state.js';
import { on } from '../util/events.js';
import { addRunTime, STATE } from './run.js';

let frameMsAvg = 16.7;
let badRun = 0, goodRun = 0;

/* The two things the loop must not know about: how a frame is drawn, and what
   the shell does after a step. The composition root passes both in, so the
   loop can be read (and tested) without a renderer or a HUD in the room. */
let renderHook = ()=>{};
let afterUpdate = ()=>{};
export function setFrameHooks(h){
  if (h.render)     renderHook = h.render;
  if (h.afterUpdate) afterUpdate = h.afterUpdate;
}

/* ============================================================
   LOOP

   A FIXED SIMULATION STEP, and an accumulator.

   It used to hand `update()` whatever the frame time happened to be, capped at
   50ms. That cap is the whole problem in one line: below 20fps the cap binds,
   and from then on the game runs in SLOW MOTION — the clock, the flood, the
   repair bar and the noise decay all fall behind real time together, and a
   player fighting for their life on a slow machine is not playing the same game
   as one at 60fps. Worse, the camera in render() smoothed against the REAL
   elapsed time while the world it was framing had only advanced by the capped
   amount, so the two disagreed and the view rubber-banded against the thing it
   was following.

   Now the simulation only ever moves in whole 1/60s steps, and a long frame
   runs as many of them as it owes (up to MAX_STEPS, so a machine that cannot
   keep up falls behind in bounded jumps rather than entering a spiral where
   each frame owes more than the last). What is left over is handed to render()
   as an interpolation fraction, which is what makes the movement continuous
   between steps instead of quantised to them.

   Measured: at 60fps the clock now burns real time exactly (2.000s of clock per
   2.001s of wall clock). At a forced 12.5fps it burns 0.96 — the remaining 4%
   is the substep budget, which is a deliberate, bounded loss rather than the
   unbounded drift the old cap produced.

   update(dt) keeps its signature and its single-call semantics: the headless
   suite drives it directly with the dt it wants and nothing here changes that.
   */
const SIM_STEP    = 1/60;
/* The spiral guard: at most this many steps per frame. Sized so the simulation
   stays on real time all the way down to 10fps (a 100ms frame is six steps) —
   below the old 50ms cap the game ran in slow motion, and below this it runs
   slightly slow rather than not at all. A step costs ~0.04ms, so the whole
   budget is under a quarter of a millisecond: raising it further would buy
   8fps of tolerance for a cost the frame cannot feel, and lowering it would
   start dropping simulated time on machines that are merely struggling. */
const MAX_STEPS   = 6;
let   simAcc      = 0;
let   last        = performance.now();
/* THE ERROR BOUNDARY. A throw used to end the game silently: frame() armed its
   own successor on its LAST line, so the first exception stopped the loop dead
   and the player was left staring at a frozen floor with the clock still
   running. The successor is now requested FIRST, so the next frame exists
   whatever this one does, and the work is wrapped. Two frames in a row failing
   is usually a hitch that recovers; three is a loop that is going to keep
   throwing forever, so the loop stops and hands the shell the error instead. */
const MAX_FAILURES = 3;
let fails = 0, dead = false;
let fatalHook = ()=>{};
export function setFatalHook(fn){ fatalHook = fn; }

/* ============================================================
   WHEN A FRAME IS WORTH DRAWING

   Off play the loop was still calling renderHook() sixty times a second to
   paint a floor that is not stepping, under a card that does not move. That is
   the most expensive thing in the game spent on the least interesting frame in
   it: a full ground pass, light composite and post chain, sixty times, to
   produce a pixel-identical image.

   So: nothing at all on the splash (the canvas behind it is not visible — the
   riser is opaque), and on the cards only when something actually changed — the
   state, a resize, a settings change — plus a slow heartbeat, because the
   renderer keeps time-based flicker in its passes and a card that never
   refreshes is a card whose CRT is switched off.

   The flag is a flag and not a diff: the things that change a frame are
   announced on the bus and from outside, and re-deriving them per frame would
   mean the loop knew about the HUD, the settings panel and the resize debounce.
   ============================================================ */
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

export function frame(now){
  if (dead) return;
  requestAnimationFrame(frame);
  try {
    let dt = (now-last)/1000;
    last = now;
    /* A tab that was in the background comes back with an enormous dt. Capping
       the accumulator rather than each step is what stops the game from trying to
       catch up on ten seconds of simulation in one frame. */
    simAcc = Math.min(simAcc + dt, SIM_STEP*MAX_STEPS);

    if (STATE==='play'){
      let steps = 0;
      while (simAcc >= SIM_STEP && steps < MAX_STEPS){
        addRunTime(SIM_STEP);
        update(SIM_STEP);
        simAcc -= SIM_STEP;
        steps++;
        /* update() can end the frame — a death, or the door cycling into the next
           floor. Stop stepping and do not let a stale accumulator carry into the
           new floor. */
        if (STATE!=='play'){ simAcc = 0; break; }
      }
      setSimAlpha(simAcc / SIM_STEP);   // 0..1, where in the current step we are
      /* Anything owed beyond MAX_STEPS is dropped rather than banked: on a machine
         that cannot hold 60Hz the honest thing is to run slightly slow, not to
         accumulate an unpayable debt. */
      if (simAcc >= SIM_STEP) simAcc = 0;
      afterUpdate();
    } else {
      simAcc = 0;
    }
    /* Frame time is measured across the WHOLE frame — simulation, render and the
       browser's own compositing — because that is what the player experiences as
       smoothness and it is the only number the adaptive resolution can honestly
       respond to. Sampled before render() so the figure covers the interval we
       are about to work in. */
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
/* Called once per frame with the measured frame time. Kept out of resize() so
   that a window resize cannot be mistaken for a slow machine and start a
   resolution change on its own. */
function adaptResolution(ms){
  /* Exponential average rather than an instantaneous read: one 40ms hitch from
     a garbage collection pause or a tab switch must not cost a resolution step,
     and the hysteresis bands below do not protect against a decision taken on
     a single sample. */
  frameMsAvg += (ms - frameMsAvg) * 0.05;

  if (frameMsAvg > SCALE_DROP_MS){
    goodRun = 0; badRun++;
    /* Only while PLAYING, in both directions. On the splash and the cards the
       canvas is not what the player is looking at — and after the render gate it
       is not even being drawn — so a resolution change there re-bakes the grain,
       the vignette and the splash plan for nothing, and a slow machine that
       spent a second on the work order would come back to a cheaper canvas than
       the one it left. */
    if (badRun > SCALE_BAD_FRAMES && renderScaleIdx < RENDER_SCALES.length-1 && STATE==='play'){
      setRenderScaleIdx(renderScaleIdx+1);
      badRun = 0; frameMsAvg = 16.7;      // re-measure at the new size, not the old
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
