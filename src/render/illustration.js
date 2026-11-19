import { MAP, MOVEMENT, NOISE } from '../config/constants.js';
import { drawBatteryMeter } from './battery-meter.js';
import { drawStaminaMeter } from './stamina-meter.js';
import { drawNoiseGlow, drawNoisePlumber, drawNoiseRipple } from './noise-visuals.js';
import { glowAlpha, glowRadius, glowRgb, glowStops, isRedRing, maxRadius, ringAlpha, ringLife, ringRadius } from './ripple-math.js';

/** Paints the field manual battery illustration. @param {HTMLCanvasElement} canvas */
export function paintManualBattery(canvas){
  const meterCtx = canvas.getContext('2d');
  if (!meterCtx) throw new Error('2D canvas context unavailable for manual battery meter');
  meterCtx.save();
  meterCtx.translate(28, 30);
  meterCtx.scale(1.3, 1.3);
  meterCtx.globalAlpha = 0.75;
  drawBatteryMeter(meterCtx, 0, 0, 83, true, -Math.PI/3);
  meterCtx.restore();
}

/** Paints the field manual stamina illustration. @param {HTMLCanvasElement} canvas */
export function paintManualStamina(canvas){
  const staminaCtx = canvas.getContext('2d');
  if (!staminaCtx) throw new Error('2D canvas context unavailable for manual stamina meter');
  staminaCtx.save();
  staminaCtx.translate(27, 27);
  staminaCtx.scale(1.3, 1.3);
  drawStaminaMeter(staminaCtx, 0, 0, MOVEMENT.SPRINT_STAMINA_SECONDS * 0.75);
  staminaCtx.restore();
}

/** Paints the field manual noise illustration. @param {HTMLCanvasElement} canvas */
export function paintManualNoise(canvas){
  const noiseCtx = canvas.getContext('2d');
  if (!noiseCtx) throw new Error('2D canvas context unavailable for manual noise indicator');
  const noise = NOISE.REPAIR;
  const rippleLife = ringLife(noise);
  const olderAge = rippleLife*0.35;
  const freshAge = rippleLife*0.12;
  const scale = (canvas.width/2 - 4)/(maxRadius(noise)*MAP.TILE_SIZE_PX);
  const minimumRippleWidth = 1/scale;
  const center = canvas.width/2;
  noiseCtx.save();
  noiseCtx.translate(center, center);
  noiseCtx.scale(scale, scale);
  const level = noise/NOISE.FULL_SCALE;
  const glow = glowRadius(level);
  drawNoiseGlow(noiseCtx, 0, 0, glow*MAP.TILE_SIZE_PX, glowRgb(noise), glowAlpha(level, 1), glowStops(glow));
  noiseCtx.globalAlpha = 1;
  drawNoisePlumber(noiseCtx, 0, 0);
  for (const age of [olderAge, freshAge]){
    const radius = ringRadius(noise, age);
    drawNoiseRipple(noiseCtx, 0, 0, radius*MAP.TILE_SIZE_PX, ringAlpha(noise, age), age, rippleLife, isRedRing(radius), minimumRippleWidth);
  }
  noiseCtx.restore();
}

/** Paints the field manual door compass chevron and label.
 * @param {HTMLCanvasElement} canvas
 */
export function paintManualDoorCompass(canvas){
  const compassCtx = canvas.getContext('2d');
  if (!compassCtx) throw new Error('2D canvas context unavailable for manual door compass');
  const cx = 14, cy = 27, size = 9;

  compassCtx.save();
  compassCtx.translate(cx, cy);
  compassCtx.rotate(Math.PI);
  compassCtx.beginPath();
  compassCtx.moveTo(size, 0);
  compassCtx.lineTo(-size*0.7, -size*0.9);
  compassCtx.lineTo(-size*0.2, 0);
  compassCtx.lineTo(-size*0.7, size*0.9);
  compassCtx.closePath();
  compassCtx.lineJoin = 'round';
  compassCtx.lineWidth = 2.5;
  compassCtx.strokeStyle = '#0c0e0a';
  compassCtx.stroke();
  compassCtx.fillStyle = '#8fd07a';
  compassCtx.fill();
  compassCtx.restore();

  compassCtx.font = 'bold 9px "Courier New", monospace';
  compassCtx.textAlign = 'center';
  compassCtx.textBaseline = 'middle';
  compassCtx.lineJoin = 'round';
  compassCtx.lineWidth = 2;
  compassCtx.strokeStyle = 'rgba(12,14,10,0.9)';
  compassCtx.strokeText('DOOR', 38, cy);
  compassCtx.fillStyle = '#8fd07a';
  compassCtx.fillText('DOOR', 38, cy);
}
