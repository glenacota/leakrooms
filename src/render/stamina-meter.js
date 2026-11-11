import { TAU } from '../cast/primitives.js';
import { SPRINT_STAMINA } from '../config/constants.js';
import { PAL } from '../config/palette.js';

const STAMINA_DANGER = '#d8503c';
const STAMINA_GREEN = '#8fd07a';
const STAMINA_UNLIT = 'rgba(230,235,200,0.18)';
const STAMINA_OUTLINE = 'rgba(12,14,10,0.9)';
const STAMINA_SCALE = 0.5;
const STAMINA_WIDTH = 14 * STAMINA_SCALE;
const STAMINA_HEIGHT = 42 * STAMINA_SCALE;
const STAMINA_GLYPH = 18 * STAMINA_SCALE;
const STAMINA_GAP = 6 * STAMINA_SCALE;
const STAMINA_TREAD = 6 * STAMINA_SCALE;
const STAMINA_SPACING = 9 * STAMINA_SCALE;
const STAMINA_PADDING = 3 * STAMINA_SCALE;
const STAMINA_SLOPE = -Math.tan(Math.PI/10);

/** Draw the stamina meter centered at the given coordinates. */
export function drawStaminaMeter(ctx, cx, cy, stamina){
  const progress = Math.max(0, Math.min(1, stamina/SPRINT_STAMINA));
  const color = progress < 0.3 ? STAMINA_DANGER : progress < 0.5 ? PAL.bright : STAMINA_GREEN;
  const contentHeight = STAMINA_GLYPH + STAMINA_GAP + STAMINA_HEIGHT
    + Math.abs(STAMINA_SLOPE)*STAMINA_WIDTH/2;
  const top = cy - contentHeight/2;

  ctx.fillStyle = 'rgba(12,14,10,0.7)';
  ctx.fillRect(cx - STAMINA_GLYPH/2 - STAMINA_PADDING, top - STAMINA_PADDING,
    STAMINA_GLYPH + 2*STAMINA_PADDING, contentHeight + 2*STAMINA_PADDING);

  ctx.save();
  ctx.translate(cx - STAMINA_GLYPH/2, top);
  ctx.scale(STAMINA_GLYPH/24, STAMINA_GLYPH/24);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(6, 12); ctx.lineTo(8, 9); ctx.lineTo(14, 9);
  ctx.lineTo(10, 15); ctx.lineTo(14, 18); ctx.lineTo(12.5, 21);
  ctx.moveTo(10, 15); ctx.lineTo(8, 18); ctx.lineTo(3.5, 18);
  ctx.moveTo(14, 9); ctx.lineTo(17, 12); ctx.lineTo(20, 10.5);
  ctx.strokeStyle = STAMINA_OUTLINE;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(16, 3.5, 2.5, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.transform(1, STAMINA_SLOPE, 0, 1, cx, top + STAMINA_GLYPH + STAMINA_GAP);
  const drawTreads = () => {
    ctx.beginPath();
    for (let y = STAMINA_HEIGHT - STAMINA_TREAD; y >= 0; y -= STAMINA_SPACING){
      ctx.rect(-STAMINA_WIDTH/2, y, STAMINA_WIDTH, STAMINA_TREAD);
    }
    ctx.fill();
  };
  ctx.fillStyle = STAMINA_UNLIT;
  drawTreads();
  ctx.beginPath();
  ctx.rect(-STAMINA_WIDTH/2, STAMINA_HEIGHT*(1 - progress), STAMINA_WIDTH, STAMINA_HEIGHT*progress);
  ctx.clip();
  ctx.fillStyle = color;
  drawTreads();
  ctx.restore();
}
