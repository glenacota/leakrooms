import { emit } from '../util/events.js';
import { onScreen } from './vision.js';
import { sustainedNoise } from './noise.js';
import { pulseDue } from './pulse-timing.js';
import { NOISE } from '../config/constants.js';

/**
 * Radar state bundle passed by reference.
 * @typedef {{
 *   radar: boolean,
 *   graffiti: Array<{x:number,y:number,text:string,seen:boolean}>,
 *   plumber: {x:number,y:number},
 * }} RadarState
 */

/* The radar lights the whole floor, so "can you see it" is just "is it on your
   screen". That is checked against the same rectangle the renderer draws, so
   something is revealed on the frame it appears.

   Nothing in the world needs finding any more (the door is where you came in,
   and the leaks show themselves in water). So the radar's one remaining job is
   reading the notes on the carpet. They are free information about a building
   that lies to you, and worth a battery. */
export function tickRadarReveal(radarState){
  if (!radarState.radar){ radarState.plumber.pulseTicks = 0; return; }
  /* A live radar pings every frame while it is on — loud enough to wake
     sleepers and pull hunters off their trail. */
  sustainedNoise(radarState, NOISE.RADAR, radarState.plumber.x, radarState.plumber.y, true);
  // The ping is steady while the radar is on, so it pulses on the same beat as the wrench.
  if (pulseDue(radarState.plumber)) emit('pulse', radarState.plumber.x, radarState.plumber.y, NOISE.RADAR);
  for (const gr of radarState.graffiti){
    if (gr.seen) continue;
    if (!onScreen(gr.x+0.5, gr.y+0.5, radarState.plumber)) continue;
    gr.seen=true; emit('flash', gr.text);
  }
}