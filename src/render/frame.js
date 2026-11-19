/* ============================================================
   FRAME
   Builds one render frame context `rc` per frame.
   Owns the camera, the viewport tile range, and the world-device mapping.
   render.js calls this once per frame and sequences the passes.
   ============================================================ */

import { MAP } from '../config/constants.js';
import { G } from '../sim/state.js';
import { cvs, SCALE } from './canvas.js';

export const cam = { x: 0, y: 0, jx: 0, jy: 0 };

/* One value per frame. The wall-clock dt is clamped against a tab returning
   from the background; the eased dt drives camera smoothing. Both are exposed
   on rc. */
let prevT = null;
let prevTRaw = null;
let dt = 0;
let motionPreference = null;

/**
 * Build one frame context.
 *
 * @param {number} t - the browser's frame timestamp in milliseconds.
 * @returns {object} rc - { t, dt, tx, ty, dx, dy, x0, y0, x1, y1, vw, vh, T, w2sx, w2sy, p }
 */
export function buildFrame(t){
  const p = G.plumber;

  /* The camera eases toward the player with a time constant against the wall
     clock, so it feels the same at any frame rate. */
  const eased = Math.max(0.001, Math.min(0.1, (t - (prevT || t - 16)) / 1000));
  prevT = t;
  dt = Math.min(0.25, Math.max(0, (t - (prevTRaw ?? (t - 16))) / 1000));
  prevTRaw = t;
  const k = 1 - Math.exp(-eased / 0.09);
  cam.x += (p.x - cam.x) * k;
  cam.y += (p.y - cam.y) * k;

  if (!motionPreference && typeof window !== 'undefined' && typeof window.matchMedia === 'function')
    motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (motionPreference?.matches){
    cam.jx = cam.jy = 0;
  } else {
    const breathe = Math.sin(t * 0.0009) * 0.06;
    const jscale = Math.sqrt(eased / 0.0167);
    cam.jx = (Math.random() - 0.5) * 0.10 * jscale + breathe * 0.35;
    cam.jy = (Math.random() - 0.5) * 0.10 * jscale;
  }

  // Clamp to the map, so the viewport never shows empty space beyond the edge
  const T = MAP.TILE_SIZE_PX * SCALE;
  const halfW = cvs.width / (2 * T);
  const halfH = cvs.height / (2 * T);
  if (MAP.WIDTH_TILES > halfW * 2) cam.x = Math.max(halfW, Math.min(MAP.WIDTH_TILES - halfW, cam.x));
  if (MAP.HEIGHT_TILES > halfH * 2) cam.y = Math.max(halfH, Math.min(MAP.HEIGHT_TILES - halfH, cam.y));

  // The translation applied inside the scaled context, in world pixels
  const tx = -cam.x * MAP.TILE_SIZE_PX + cvs.width / (2 * SCALE) + cam.jx;
  const ty = -cam.y * MAP.TILE_SIZE_PX + cvs.height / (2 * SCALE) + cam.jy;
  // The same mapping, in device pixels
  const dx = tx * SCALE;
  const dy = ty * SCALE;
  const w2sx = wx => SCALE * (wx * MAP.TILE_SIZE_PX + tx);
  const w2sy = wy => SCALE * (wy * MAP.TILE_SIZE_PX + ty);

  // The visible tile range (with a margin), so the passes only draw what is on screen
  const tlx = Math.floor(cam.x - cvs.width / (2 * T)) - 1;
  const tly = Math.floor(cam.y - cvs.height / (2 * T)) - 1;
  const tw = Math.ceil(cvs.width / T) + 3;
  const th = Math.ceil(cvs.height / T) + 3;

  const x0 = Math.max(0, tlx);
  const y0 = Math.max(0, tly);
  const x1 = Math.min(MAP.WIDTH_TILES - 1, tlx + tw);
  const y1 = Math.min(MAP.HEIGHT_TILES - 1, tly + th);
  const vw = x1 - x0 + 1;
  const vh = y1 - y0 + 1;

  return { t, dt, tx, ty, dx, dy, x0, y0, x1, y1, vw, vh, T, w2sx, w2sy, p };
}
