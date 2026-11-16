import { LOUD, NOISE_FS } from '../config/constants.js';

/* A loud ring reaches 1.5 tiles; its radius signals noise, not hearing range.
   Scaling from there makes a sprint reach 2.1 tiles and a walk 0.6. */
export const RADIUS_AT_LOUD = 1.5;
/* Start as a dot rather than a point. */
const R_START = 0.15;
/* A walk gets the slow gap; louder noise spawns rings faster. */
const GAP_QUIET = 0.75;
const GAP_LOUD = 0.5;
const GAP_RAMP_FROM = 0.2;
const GAP_RAMP_SPAN = 0.5;
/* Keep the glow small so rings carry size and glow carries noise level. */
const GLOW_R_BASE = 0.42;
const GLOW_R_GAIN = 0.5;
/* A clear centre keeps the plumber's suit legible. */
export const GLOW_HOLE = 0.1;
const GLOW_YELLOW = [255, 245, 160];
const GLOW_RED = [216, 80, 60];
const GLOW_RED_FROM = 0.44;
const GLOW_RED_TO = 0.54;
/* Each ring briefly flashes the glow between 0.8 and 1.2 brightness. */
const KICK_TIME = 0.25;
const KICK_LOW = 0.8;
const KICK_SPAN = 0.4;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a)/(b - a), 0, 1);
  return t*t*(3 - 2*t);
};

/** Seconds between ring spawns at this noise. */
export function spawnGap(noise){
  return GAP_QUIET - (GAP_QUIET - GAP_LOUD)*clamp((noise - GAP_RAMP_FROM)/GAP_RAMP_SPAN, 0, 1);
}

/** Maximum ring radius in tiles at this noise. */
export function maxRadius(noise){
  return RADIUS_AT_LOUD*noise/LOUD;
}

/** Ring lifetime in seconds at this noise. */
export function ringLife(noise){
  return 1.1 - 0.5*clamp(noise/NOISE_FS, 0, 1);
}

/** Ring radius in tiles at this noise and age. */
export function ringRadius(noise, age){
  const k = clamp(age/ringLife(noise), 0, 1);
  const grow = 1 - Math.pow(1 - k, 2.2);
  return R_START + (maxRadius(noise) - R_START)*grow;
}

/** Ring opacity before HUD opacity is applied. */
export function ringAlpha(noise, age){
  const k = clamp(age/ringLife(noise), 0, 1);
  return Math.pow(1 - k, 1.3)*clamp(noise/NOISE_FS, 0, 1);
}

/** Whether a ring has reached the loud radius. */
export function isRedRing(radiusTiles){
  return radiusTiles >= RADIUS_AT_LOUD;
}

/** Glow radius in tiles at this normalized noise level. */
export function glowRadius(level){
  return GLOW_R_BASE + GLOW_R_GAIN*clamp(level, 0, 1);
}

/** Glow colour as RGB at this noise. */
export function glowRgb(noise){
  const k = smooth(GLOW_RED_FROM, GLOW_RED_TO, noise);
  return GLOW_YELLOW.map((y, i) => Math.round(y + (GLOW_RED[i] - y)*k));
}

/** Glow opacity before HUD opacity is applied. */
export function glowAlpha(level, kick){
  return clamp(clamp(level, 0, 1)*(KICK_LOW + KICK_SPAN*clamp(kick, 0, 1)), 0, 1);
}

/** Glow flash strength since the last ring spawn. */
export function glowKick(sinceSpawn){
  return clamp(1 - sinceSpawn/KICK_TIME, 0, 1);
}

/** Glow gradient stops for a radius in tiles. */
export function glowStops(radiusTiles){
  const hole = clamp(GLOW_HOLE/radiusTiles, 0, 0.95);
  const span = 1 - hole;
  return [[0, 0], [hole, 0], [hole + span*0.25, 0.95], [hole + span*0.6, 0.45], [1, 0]];
}
