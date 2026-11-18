import { update } from '../sim/update.js';
import { G } from '../sim/state.js';
import { on, EVENT } from '../util/events.js';
import { addRunTime, STATE } from './run.js';

/* Hooks keep rendering and shell updates outside the fixed-step loop. */
let renderHook = ()=>{}, afterUpdate = ()=>{}, afterStep = ()=>{}, simAlphaHook = ()=>{}, adaptiveHook = ()=>{};
export function setFrameHooks(h){
  if (h.render)      renderHook = h.render;
  if (h.afterUpdate) afterUpdate = h.afterUpdate;
  if (h.afterStep)   afterStep = h.afterStep;
  if (h.simAlpha)    simAlphaHook = h.simAlpha;
  if (h.adaptive)    adaptiveHook = h.adaptive;
}

/* Fixed steps keep clocks, water and repair progress tied to real time on slow
   machines. The leftover fraction is only for smooth rendering. */
const SIM_STEP    = 1/60;

/* Drop catch-up debt below 10 fps instead of allowing a permanent slowdown. */
const MAX_STEPS   = 6;
let   simAcc      = 0;
let   last        = performance.now();

/* Repeated frame failures show the fatal card; an isolated failure recovers. */
const MAX_FAILURES = 3;
let fails = 0, dead = false;
let fatalHook = ()=>{};
export function setFatalHook(fn){ fatalHook = fn; }

/* Non-play states redraw on state/input changes and at a slow heartbeat. */
const IDLE_REDRAW_MS = 250;
let needsRedraw = true;
let lastRedraw  = 0;
let lastState   = null;
on(EVENT.resize,          ()=>{ needsRedraw = true; });
on(EVENT.settingsChanged,()=>{ needsRedraw = true; });

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
 * Steps the simulation, refreshes the shell, draws, and adjusts resolution.
 *
 * @param {number} now - the browser's frame timestamp in milliseconds.
 */
export function frame(now){
  if (dead) return;
  requestAnimationFrame(frame);
  try {
    let dt = (now-last)/1000;
    last = now;
    /* Limit background-tab catch-up without changing individual step size. */
    simAcc = Math.min(simAcc + dt, SIM_STEP*MAX_STEPS);

    if (STATE==='play'){
      let steps = 0;
      while (simAcc >= SIM_STEP && steps < MAX_STEPS){
        addRunTime(SIM_STEP);
        update(G, SIM_STEP);
        simAcc -= SIM_STEP;
        steps++;
        if (STATE==='play') afterStep(SIM_STEP);
        /* Leftover time belongs to the ended attempt, not the next floor. */
        if (STATE!=='play'){ simAcc = 0; break; }
      }
      simAlphaHook(simAcc / SIM_STEP);
      /* Dropping excess debt prevents it from growing across frames. */
      if (simAcc >= SIM_STEP) simAcc = 0;
      afterUpdate();
    } else {
      simAcc = 0;
    }
    /* Adaptive resolution uses complete frame cost, not work inside the loop. */
    adaptiveHook(now);

    if (G && shouldRender(now)) renderHook(now);

    fails = 0;
  } catch (err){
    if (++fails >= MAX_FAILURES){ dead = true; fatalHook(err); }
  }
}
