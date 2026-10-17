import { emit } from '../util/events.js';
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
  if (cvs.width > 0 && cvs.height > 0) emit('resize');
}
window.addEventListener('resize', resize);
