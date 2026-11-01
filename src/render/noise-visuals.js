import { TAU } from '../cast/primitives.js';

const AMBER = '#e4e6a8';
const DANGER = '#d8503c';
const OUTLINE = '#0c0e0a';
const HUD_OPACITY = 0.8;

/**
 * Draws the noise glow using gameplay rendering values.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {[number, number, number]} rgb
 * @param {number} alpha
 * @param {Array<[number, number]>} stops
 */
export function drawNoiseGlow(ctx, x, y, radius, rgb, alpha, stops){
  const [r, g, b] = rgb;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  for (const [at, a] of stops) grad.addColorStop(at, `rgba(${r},${g},${b},${a})`);
  ctx.globalAlpha = Math.min(1, alpha*HUD_OPACITY);
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
}

/**
 * Draws one noise ripple using gameplay rendering values.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {number} alpha
 * @param {number} age
 * @param {number} life
 * @param {boolean} red
 * @param {number} [minimumWidth]
 */
export function drawNoiseRipple(ctx, x, y, radius, alpha, age, life, red, minimumWidth = 0){
  const a = alpha*HUD_OPACITY;
  if (a < 0.004) return;
  const k = Math.max(0, Math.min(1, age/life));
  const width = Math.max(2.4*(1 - 0.5*k), minimumWidth);
  ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU);
  ctx.globalAlpha = a*0.55; ctx.strokeStyle = OUTLINE; ctx.lineWidth = width + 2; ctx.stroke();
  ctx.globalAlpha = a; ctx.strokeStyle = red ? DANGER : AMBER; ctx.lineWidth = width; ctx.stroke();
}

/**
 * Draws a compact top-down plumber marker for the manual's static noise clue.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 */
export function drawNoisePlumber(ctx, x, y){
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#e4e6a8';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 10, 15, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#c3cb6e';
  ctx.beginPath();
  ctx.arc(0, -3.5, 5, 0, TAU);
  ctx.fill();
  ctx.restore();
}
