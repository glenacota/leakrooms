import { emit } from '../util/events.js';
import { view } from '../util/view.js';
import { RENDER_SCALES } from '../config/constants.js';
import { VIEW_T, TILE } from '../config/constants.js';

/* ---------- canvas ---------- */
export let cvs = document.getElementById('game');
export let ctx = cvs.getContext('2d', { alpha:false });
export let VW = 0, VH = 0, DPR = 1, SCALE = 1;
export let renderScaleIdx = 0;

export function setRenderScaleIdx(v){ renderScaleIdx = v; }

/* ADAPTIVE RESOLUTION.

   The device pixel ratio is capped at 2, which means a retina laptop renders
   four times the pixels of the same window on an external monitor — and every
   cost in this renderer is proportional to pixels touched, not to logic
   executed. Measured on the reference machine, the same frame cost 2.2ms at
   1x and would cost roughly four times that at 2x, for an image that is then
   scaled down by the compositor to exactly the size it would have been anyway.
   On a machine that cannot hold 60Hz, that difference is the whole margin.

   So the ratio is a starting point, not a decision. The frame time is tracked,
   and if it sits above the drop threshold for long enough to be a trend rather
   than a spike, the backing store shrinks by one step and resize() runs again.
   If it then sits comfortably below the recover threshold, it grows back. The
   bands are deliberately far apart so a machine sitting near a boundary cannot
   oscillate — a resolution that visibly pumps is worse than a slightly soft one
   that holds.

   Nothing else in the renderer changes. SCALE is derived from cvs.width, so the
   camera, the geometry, the light bake and the visibility mask all follow the
   new backing store automatically, and test 7 — which asserts the camera, the
   lightmap and the flood image all share one origin — keeps holding. */
export function resize(){
  DPR = Math.min(window.devicePixelRatio || 1, 2) * RENDER_SCALES[renderScaleIdx];
  VW = cvs.clientWidth; VH = cvs.clientHeight;
  cvs.width = Math.floor(VW * DPR);
  cvs.height = Math.floor(VH * DPR);
  SCALE = cvs.width / (VIEW_T * TILE);
  view.w = cvs.width; view.h = cvs.height; view.scale = SCALE;
  if (cvs.width > 0 && cvs.height > 0) emit('resize');
}

/* A WINDOW DRAG IS NOT FIFTY RESIZE EVENTS.

   Dragging a window edge fires 'resize' every frame of the drag, and this one is
   expensive downstream: it reallocates the backing store, and the 'resize'
   event rebuilds the screen-sized grain and repaints the splash plan. Fifty of
   those is fifty screen-sized noise buffers generated and thrown away inside
   one second of dragging, which is the most expensive thing in the game
   available to a gesture that is not even supposed to be a workload.

   So the LISTENER is debounced and the function is not: resize() above stays
   synchronous, because adaptResolution() calls it in the middle of a frame when
   it has just decided to change the backing store, and a deferred resize would
   leave SCALE describing a canvas that does not exist yet. Only the browser's
   event is held back — 80ms of quiet, which is short enough that the canvas is
   never visibly the wrong shape and long enough that a drag is one resize. */
const RESIZE_DEBOUNCE_MS = 80;
let resizeTimer = null;
function onWindowResize(){
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(()=>{ resizeTimer = null; resize(); }, RESIZE_DEBOUNCE_MS);
}
window.addEventListener('resize', onWindowResize);

/* CONTEXT LOSS.

   A canvas context can be taken away by the machine, not only by the tab being
   closed: a GPU reset, a driver switch between the integrated and discrete
   chip, a laptop lid, a machine switching graphics contexts. Every bitmap this
   context owned — the grain, the patterns, the light bake, the two tile layers —
   goes with it, and the renderer keeps running, drawing from canvases that now
   have no backing store. Nothing throws and nothing appears: the game becomes a
   black rectangle and keeps charging you for the clock.

   preventDefault() on 'contextlost' is what buys the second event: without it the
   browser does not promise to give the context back at all. The rebuild itself
   belongs to whoever owns the pixels, so all this does is announce it — the
   listeners live in ui/bind.js, with the rest of the DOM side of the bus. */
cvs.addEventListener('contextlost', e => {
  if (e && e.preventDefault) e.preventDefault();
  emit('contextlost');
});
cvs.addEventListener('contextrestored', () => emit('contextrestored'));
