import { NOISE_FULL_SCALE, REPAIR_NOISE, SPRINT_STAMINA_SECONDS, TILE_SIZE_PX } from '../config/constants.js';
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
  drawStaminaMeter(staminaCtx, 0, 0, SPRINT_STAMINA_SECONDS * 0.75);
  staminaCtx.restore();
}

/** Paints the field manual noise illustration. @param {HTMLCanvasElement} canvas */
export function paintManualNoise(canvas){
  const noiseCtx = canvas.getContext('2d');
  if (!noiseCtx) throw new Error('2D canvas context unavailable for manual noise indicator');
  const noise = REPAIR_NOISE;
  const rippleLife = ringLife(noise);
  const olderAge = rippleLife*0.35;
  const freshAge = rippleLife*0.12;
  const scale = (canvas.width/2 - 4)/(maxRadius(noise)*TILE_SIZE_PX);
  const minimumRippleWidth = 1/scale;
  const center = canvas.width/2;
  noiseCtx.save();
  noiseCtx.translate(center, center);
  noiseCtx.scale(scale, scale);
  const level = noise/NOISE_FULL_SCALE;
  const glow = glowRadius(level);
  drawNoiseGlow(noiseCtx, 0, 0, glow*TILE_SIZE_PX, glowRgb(noise), glowAlpha(level, 1), glowStops(glow));
  noiseCtx.globalAlpha = 1;
  drawNoisePlumber(noiseCtx, 0, 0);
  for (const age of [olderAge, freshAge]){
    const radius = ringRadius(noise, age);
    drawNoiseRipple(noiseCtx, 0, 0, radius*TILE_SIZE_PX, ringAlpha(noise, age), age, rippleLife, isRedRing(radius), minimumRippleWidth);
  }
  noiseCtx.restore();
}
