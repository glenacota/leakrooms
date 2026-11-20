/* ============================================================
   CATCH PASS
   The colour drain and red vignette of the catch beat. It draws only while
   the beat plays (util/catch-presentation.js) and returns before touching the
   canvas otherwise, so every other frame is unchanged.
   The pulse is one smooth swell that settles, never a flicker. With the flash
   setting off the vignette holds at a steady tint.
   ============================================================ */

import { ctx, cvs } from '../canvas.js';
import { SETTINGS } from '../../settings/store.js';
import { catchPresenting, catchProgress } from '../../util/catch-presentation.js';

/**
 * Draws the catch beat over the finished frame.
 *
 * @param {number} t - the browser's frame timestamp in milliseconds.
 */
export function catchFx(t){
  if (!catchPresenting()) return;
  const k = catchProgress(t);
  const ease = 1 - Math.pow(1 - k, 3);
  const w = cvs.width, h = cvs.height;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  /* Colour drains from the world as the plumber goes down. */
  ctx.globalCompositeOperation = 'saturation';
  ctx.fillStyle = `rgba(128,128,128,${(0.9 * ease).toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);

  /* Red vignette: one swell that peaks early, then settles. */
  ctx.globalCompositeOperation = 'source-over';
  const swell = SETTINGS.flash ? Math.sin(Math.min(1, k * 1.6) * Math.PI) : 0;
  const alpha = Math.min(0.9, 0.4 + 0.4 * swell);
  const rv = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.85);
  rv.addColorStop(0, 'rgba(224,54,44,0)');
  rv.addColorStop(1, `rgba(224,54,44,${alpha.toFixed(3)})`);
  ctx.fillStyle = rv;
  ctx.fillRect(0, 0, w, h);

  ctx.restore();
}
