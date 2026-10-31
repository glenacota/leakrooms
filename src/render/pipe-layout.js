/* Where a pipe's parts sit on its wall face. Pure: numbers in, numbers out, no
   canvas, so the geometry can be tested without drawing anything.

   A pipe is painted on the SOUTH wall face of its wall tile: the wallpaper band
   the bake lays into the top of the floor tile below the wall (WALL_FACE tall).
   Everything here is in TILE FRACTIONS measured from the top-left of that band:
   x runs 0..1 across the tile, y runs down from the band's top edge, so the band
   is 0..FACE and the carpet below it is FACE..1.

   The shape is a riser that comes down out of the ceiling line and turns through
   an elbow into a run along the wall. */
import { TILE, WALL_FACE } from '../config/constants.js';
import { hash2 } from '../util/hash.js';

/** The band's height as a fraction of a tile. */
export const FACE = WALL_FACE / TILE;

/* Rectangles are {x, y, w, h}. */
const BASE = {
  run:        { x:0.04, y:0.185, w:0.63, h:0.15 },   // the horizontal pipe
  runShade:   { x:0.04, y:0.275, w:0.63, h:0.06 },   // its darker underside strip
  riser:      { x:0.53, y:0.000, w:0.14, h:0.335 },  // the vertical pipe, ends in the elbow
  endCollar:  { x:0.04, y:0.150, w:0.07, h:0.220 },  // flange at the free end of the run
  midCollar:  { x:0.30, y:0.150, w:0.08, h:0.220 },  // flange part way along the run
  topCollar:  { x:0.49, y:0.030, w:0.22, h:0.065 },  // flange on the riser, wider than it
  streak:     { x:0.575, y:0.335, w:0.045, h:FACE - 0.335 }, // the wet run down the wallpaper
  clamp:      { x:0.50, y:0.165, w:0.20, h:0.200 },  // the hazard clamp that seals the split
};

/* The split in the elbow's underside, a jagged black shape. [x, y] pairs. */
const CRACK = [
  [0.535,0.335],[0.560,0.300],[0.548,0.250],[0.585,0.292],[0.600,0.240],
  [0.612,0.300],[0.650,0.322],[0.618,0.335],
];

/* Where the drop forms: the lowest point of the split. */
const DROP_FROM = { x:0.592, y:0.335 };

/* The puddle on the carpet below, one big pool and two small blobs: [cx, cy, rx, ry]. */
const PUDDLE = [
  [0.585, 0.735, 0.300, 0.085],
  [0.330, 0.765, 0.115, 0.038],
  [0.885, 0.800, 0.070, 0.024],
];
/* The glint on the big pool: [cx, cy, rx, ry]. */
const GLINT = [0.500, 0.710, 0.130, 0.020];

const mx  = (x)=> 1 - x;
const mxr = (r)=> ({ x: 1 - r.x - r.w, y:r.y, w:r.w, h:r.h });

/**
 * Which way a pipe faces. Taken from the tile's coordinates, so it is fixed for a
 * given map and uses none of the level's random numbers.
 * @returns {boolean} true when the pipe is drawn mirrored (riser on the left)
 */
export function pipeFlipped(tx, ty){ return hash2(tx, ty) < 0.5; }

/**
 * The parts of a pipe, mirrored or not.
 * @param {boolean} flip
 * @returns {{rects:Object<string,{x:number,y:number,w:number,h:number}>, crack:number[][],
 *   dropFrom:{x:number,y:number}, puddle:number[][], glint:number[], elbowRight:boolean}}
 */
export function pipeLayout(flip){
  const rects = {};
  for (const k of Object.keys(BASE)) rects[k] = flip ? mxr(BASE[k]) : { ...BASE[k] };
  return {
    rects,
    crack:    CRACK.map(([x,y]) => [flip ? mx(x) : x, y]),
    dropFrom: { x: flip ? mx(DROP_FROM.x) : DROP_FROM.x, y: DROP_FROM.y },
    puddle:   PUDDLE.map(([cx,cy,rx,ry]) => [flip ? mx(cx) : cx, cy, rx, ry]),
    glint:    [flip ? mx(GLINT[0]) : GLINT[0], GLINT[1], GLINT[2], GLINT[3]],
    /* which side the rounded outer corner of the elbow is on */
    elbowRight: !flip,
  };
}

export const HANG = 0.34;
export const LAND_Y = 0.72;
/**
 * Where the drop is, as a looping cycle: it swells at the split (0 to HANG of the
 * cycle), then falls onto the puddle with gravity, and the puddle ripples as it
 * lands. Pure in `phase`, a number in [0,1).
 * @returns {{kind:'hang'|'fall', y:number, r:number, ripple:number}} y in tile
 *   fractions; r the drop radius in tile fractions; ripple 0..1 progress of the
 *   ring on the puddle (0 while the drop is in the air).
 */
export function dropAt(phase){
  const p = ((phase % 1) + 1) % 1;
  if (p < HANG){
    const u = p / HANG;
    return { kind:'hang', y: DROP_FROM.y + 0.012 * u, r: 0.010 + 0.022 * u, ripple: u };
  }
  const q = (p - HANG) / (1 - HANG);
  return { kind:'fall', y: DROP_FROM.y + 0.03 + (LAND_Y - DROP_FROM.y - 0.03) * q * q, r: 0.032, ripple: 0 };
}

const mix = (c, k)=> Math.round(c + (255 - c) * k);

/**
 * A tint toward white of a water colour, as a CSS colour. The game's water tints
 * (WATER_TINTS) are deep, dark colours meant to sit under the carpet; a puddle on
 * top of it has to be lighter to read, so this lifts the same hue.
 * @param {number[]} rgb the tint's [r,g,b]
 * @param {number} k 0 = the tint, 1 = white
 * @param {number} [a=1] alpha
 */
export function waterCss(rgb, k, a=1){
  return `rgba(${mix(rgb[0],k)},${mix(rgb[1],k)},${mix(rgb[2],k)},${a})`;
}
