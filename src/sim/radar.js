import { emit } from '../util/events.js';
import { onScreen } from './vision.js';
import { G } from './state.js';

/* The radar lights the whole floor, so "can you see it" is no longer a question
   about angles and walls: it is just "is it on your screen". That is checked
   against the same rectangle the renderer draws, so something is revealed on
   the frame it appears.

   Nothing in the world needs finding any more (the door is where you came in,
   and the pipes show themselves in water). So the radar's one remaining job is
   reading the notes on the carpet. They are free information about a building
   that lies to you, and worth a battery. */
export function tickRadarReveal(){
  if (!G.radar) return;
  for (const gr of G.graffiti){
    if (gr.seen) continue;
    if (!onScreen(gr.x+0.5, gr.y+0.5)) continue;
    gr.seen=true; emit('flash', gr.text);
  }
}