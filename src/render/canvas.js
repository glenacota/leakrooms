import { emit } from '../util/events.js';
import { view } from '../util/view.js';
import { RENDER_SCALES } from '../config/constants.js';
import { VIEW_T, TILE } from '../config/constants.js';

/* ---------- The main canvas ---------- */
export let cvs = document.getElementById('game');
export let ctx = cvs.getContext('2d', { alpha:false });
export let VW = 0, VH = 0, DPR = 1, SCALE = 1;
export let renderScaleIdx = 0;

export function setRenderScaleIdx(v){ renderScaleIdx = v; }

/**
 * Sizes the canvas to its box on the page and works out SCALE, the number of
 * device pixels per world pixel. The camera, the light bake and the visibility
 * mask all follow from it, so everything stays aligned when the size changes.
 *
 * The device pixel ratio is capped at 2 and then multiplied by the current
 * adaptive render scale (see game/loop.js). A retina screen has four times the
 * pixels of the same window on a normal screen, and every cost in the renderer
 * grows with the pixels touched. So the ratio is a starting point and not a
 * fixed decision: if frames stay slow, the loop lowers the render scale one step
 * and calls this again.
 *
 * This runs synchronously on purpose, because the loop calls it in the middle of
 * a frame after changing the scale. The window's resize event is debounced
 * separately below.
 */
export function resize(){
  DPR = Math.min(window.devicePixelRatio || 1, 2) * RENDER_SCALES[renderScaleIdx];
  VW = cvs.clientWidth; VH = cvs.clientHeight;
  cvs.width = Math.floor(VW * DPR);
  cvs.height = Math.floor(VH * DPR);
  SCALE = cvs.width / (VIEW_T * TILE);
  view.w = cvs.width; view.h = cvs.height; view.scale = SCALE;
  if (cvs.width > 0 && cvs.height > 0) emit('resize');
}

/* ---------- Window resize ----------
   Dragging a window edge fires 'resize' on every frame of the drag. Each one
   would reallocate the canvas and rebuild the screen-sized grain, so one drag
   would generate fifty large noise buffers in a second. So the listener waits
   for 80 ms of quiet and then resizes once. 80 ms is short enough that the
   canvas is never visibly the wrong shape. */
const RESIZE_DEBOUNCE_MS = 80;
let resizeTimer = null;
function onWindowResize(){
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(()=>{ resizeTimer = null; resize(); }, RESIZE_DEBOUNCE_MS);
}
window.addEventListener('resize', onWindowResize);

/* ---------- Lost canvas context ----------
   The machine can take the canvas context away (a graphics driver reset, a
   switch between graphics chips). Every bitmap the renderer draws from is lost
   with it, and the game would keep drawing from blank canvases. Calling
   preventDefault() on 'contextlost' is what makes the browser promise to send
   'contextrestored' later. The rebuilding is done by whoever owns the bitmaps,
   so this only announces the events. The listeners are in ui/bind.js. */
cvs.addEventListener('contextlost', e => {
  if (e && e.preventDefault) e.preventDefault();
  emit('contextlost');
});
cvs.addEventListener('contextrestored', () => emit('contextrestored'));