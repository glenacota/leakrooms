import { emit } from '../util/events.js';
import { onScreen } from './vision.js';
import { G } from './state.js';

/* --- the radar reveals ---
   Sweeping lights the whole level, so "can you see it" stops being a question
   about angles and walls and becomes exactly what it says: is it on your
   screen. That is checked against the same rectangle the renderer draws
   into, so a thing is revealed on the frame it appears, not a frame before.

   There is nothing in the world that NEEDS finding any more — the door is
   where you came in and you know it — so the radar is down to what it was
   always honestly good for: reading the carpet. The scrawls are the only
   thing it surfaces, and they are worth a battery because they are free
   information about a building that lies to you. */
export function tickRadarReveal(){
  if (!G.radar) return;
  for (const gr of G.graffiti){
    if (gr.seen) continue;
    if (!onScreen(gr.x+0.5, gr.y+0.5)) continue;
    gr.seen=true; emit('flash', gr.text);
  }
}
