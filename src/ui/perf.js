/* ============================================================
   FRAME-TIME OVERLAY
   With ?perf=1 in the URL, a small fixed readout bottom-left inside the safe
   area: average frame ms, estimated refresh interval, render scale index and
   value, canvas size, device pixel ratio, run state and hardware concurrency.
   It updates twice per second and only writes the DOM when the text changes,
   so it adds no measurable cost. Without ?perf=1 nothing is revealed.
   ============================================================ */

import { getFrameMsAvg, getRefreshMs } from '../render/adaptive.js';
import { cvs, renderScaleIdx, SCALE } from '../render/canvas.js';
import { STATE } from '../game/run.js';

/* The readout lives in index.html (hidden until ?perf=1 shows it). */
let EL = null;
let ticker = null;
let lastText = '';

function locationHasPerf(){
  try {
    const loc = typeof document !== 'undefined' && document.location ? document.location : undefined;
    return !!loc && loc.search.includes('perf=1');
  } catch { return false; }
}

/**
 * Starts the frame-time overlay. A no-op unless the page was loaded with
 * ?perf=1, and idempotent: calling it again while it runs does nothing.
 *
 * @param {HTMLElement} [el] - the readout element; defaults to #perf in the DOM.
 * @returns {Function|null} a cleanup that stops the ticker, or null.
 */
export function initPerf(el){
  if (ticker) return null;
  if (!locationHasPerf()) return null;
  EL = el || document.getElementById('perf');
  if (!EL) return null;
  EL.hidden = false;
  EL.style.display = '';
  ticker = setInterval(tick, 500);   // twice per second
  tick();
  return ()=>{ if (ticker){ clearInterval(ticker); ticker = null; } };
}

function tick(){
  const avg = getFrameMsAvg();
  const refresh = getRefreshMs();
  const idx = renderScaleIdx;
  const scale = SCALE;
  const w = cvs.width, h = cvs.height;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 0;
  const text =
    `perf: ${avg.toFixed(1)} ms / ${refresh ? refresh.toFixed(0) : '-'} ms refresh | ` +
    `scale ${idx} = ${scale.toFixed(2)} | ${w}x${h} | dpr ${dpr} | ${STATE} | hc ${hc}`;
  if (text !== lastText){
    lastText = text;
    EL.textContent = text;
  }
}
