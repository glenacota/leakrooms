import { TAU } from '../cast/primitives.js';
import { TILE, BATT_MAX, BATT_CELLS, BATT_LOW } from '../config/constants.js';

const RING_R = 0.38;
const CELL_LW = 2;
const CELL_SPAN = TAU/BATT_CELLS;
const CELL_TRIM = 3*Math.PI/180;
const DISC_PAD = 2;
const DANGER = '#d8503c';
const GREEN = '#8fd07a';
const UNLIT = 'rgba(230,235,200,0.18)';
const DISC = 'rgba(12,14,10,0.7)';
const SCOPE_FACE = 'rgba(143,208,122,0.35)';
const SCOPE_TRAIL = 1.2;
const SCOPE_BANDS = 10;
const SCOPE_REACH = 0.8;
const SCOPE_FADE = 0.4;
const LABEL_OUTLINE = 'rgba(12,14,10,0.9)';

function cells(ctx, cx, cy, lit, color){
  const r = RING_R*TILE;
  ctx.fillStyle = DISC;
  ctx.beginPath(); ctx.arc(cx, cy, r + CELL_LW/2 + DISC_PAD, 0, TAU); ctx.fill();
  ctx.lineWidth = CELL_LW;
  for (let i = 0; i < BATT_CELLS; i++){
    const a0 = -Math.PI/2 + i*CELL_SPAN + CELL_TRIM;
    ctx.strokeStyle = i < lit ? color : UNLIT;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a0 + CELL_SPAN - 2*CELL_TRIM);
    ctx.stroke();
  }
}

function scope(ctx, cx, cy, color, live, angle){
  const r = RING_R*TILE;
  const baseAlpha0 = ctx.globalAlpha;
  ctx.globalAlpha = baseAlpha0*SCOPE_FADE;
  const reach = (r - CELL_LW/2)*SCOPE_REACH;
  ctx.strokeStyle = SCOPE_FACE;
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(cx, cy, reach/2, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - reach, cy); ctx.lineTo(cx + reach, cy);
  ctx.moveTo(cx, cy - reach); ctx.lineTo(cx, cy + reach);

  if (!live){ ctx.globalAlpha = baseAlpha0; return; }

  ctx.fillStyle = color;
  const band = SCOPE_TRAIL/SCOPE_BANDS;
  const baseAlpha = ctx.globalAlpha;
  for (let i = 0; i < SCOPE_BANDS; i++){
    const a1 = angle - i*band, a0 = a1 - band;
    ctx.globalAlpha = baseAlpha*0.5*(1 - i/SCOPE_BANDS);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, reach, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = baseAlpha;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle)*reach, cy + Math.sin(angle)*reach);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.globalAlpha = baseAlpha0;
}

function label(ctx, text, color, cx, cy){
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 10px "Courier New", Courier, monospace';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2;
  ctx.strokeStyle = LABEL_OUTLINE;
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

/**
 * Draws the battery ring and radar scope at a local canvas position.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} battery
 * @param {boolean} radar
 * @param {number} angle
 */
export function drawBatteryMeter(ctx, cx, cy, battery, radar, angle){
  const progress = Math.min(1, Math.max(0, battery/BATT_MAX));
  const color = battery <= BATT_LOW ? DANGER : GREEN;
  const lit = Math.ceil(progress*BATT_CELLS - 1e-9);
  cells(ctx, cx, cy, lit, color);
  scope(ctx, cx, cy, color, radar, angle);
  label(ctx, `${Math.ceil(progress*100)}%`, color, cx, cy);
}
