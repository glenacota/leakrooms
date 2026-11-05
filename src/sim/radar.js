import { sustainedNoise } from './noise.js';
import { NOISE } from '../config/constants.js';

/**
 * Radar state bundle passed by reference.
 * @typedef {{
 *   radar: boolean,
 *   plumber: {x:number,y:number},
 * }} RadarState
 */

/* The radar lights the whole floor, so "can you see it" is just "is it on your
   screen". The renderer draws everything, so nothing is hidden from it; the
   radar's job is not revealing space but announcing presence. A live radar
   pings every frame while it is on — loud enough to wake sleepers and pull
   hunters off their trail. */
export function tickRadarReveal(radarState){
  if (!radarState.radar) return;
  /* A live radar pings every frame while it is on — loud enough to wake
     sleepers and pull hunters off their trail. */
  sustainedNoise(radarState, NOISE.RADAR, radarState.plumber.x, radarState.plumber.y, true);
}