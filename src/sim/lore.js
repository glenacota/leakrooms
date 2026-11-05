import { emit, on } from '../util/events.js';

/* Notes about the lore of the Backrooms read at random. */
export const LORE_CHANCE = 1 / 600;
export const LORE_GAP = 20000; // ms between any flash and the next lore note

let lastFlash = 0;

/* Any non-lore flash emission restarts the gap timer so lore cannot follow too
   close on a danger, alert, guide or info cue. Lore's own emissions don't count. */
on('flash', ({ cat }) => { if (cat !== 'lore') lastFlash = performance.now(); });

export function tickLore(state){
  const { loreRng, notes } = state;
  if (!loreRng || !notes) return;
  if (performance.now() - lastFlash < LORE_GAP) return;
  const unseen = notes.filter(n => !n.seen);
  if (!unseen.length) return;
  if (loreRng() >= LORE_CHANCE) return;
  /* Pick one random unseen note so a frame never reveals two notes and never
     loses one to the cue manager's single hold slot. */
  const n = unseen[(loreRng() * unseen.length)|0];
  n.seen = true;
  emit('flash', { cat: 'lore', text: n.text });
}

/* Resets the gap timer so lore can fire immediately. Tests only. */
export function loreReset(){ lastFlash = 0; }
