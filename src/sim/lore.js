import { emit } from '../util/events.js';

/* Notes about the lore of the Backrooms read at random. */
export const LORE_CHANCE = 1 / 600;

export function tickLore(state){
  const { loreRng, notes } = state;
  if (!loreRng || !notes) return;
  const unseen = notes.filter(n => !n.seen);
  if (!unseen.length) return;
  if (loreRng() >= LORE_CHANCE) return;
  /* Pick one random unseen note so a frame never reveals two notes and never
     loses one to the cue manager's single hold slot. */
  const n = unseen[(loreRng() * unseen.length)|0];
  n.seen = true;
  emit('flash', { cat: 'lore', text: n.text });
}
