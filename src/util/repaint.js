/**
 * RepaintState — shared dirty tracking for pixel layers.
 * The sim marks tiles as changed; the renderer consumes the dirty box
 * and clears the flags.
 */
import { MAP_W, MAP_H } from '../config/constants.js';

/* ---------- Dirty flags (read by pack.js) ---------- */
export const repaintDirty = {
  water: true,
  mask: true,
};

/* ---------- Flood dirty box (module-level, shared with flood.js) ----------
   packWet() turns wetArr into an image. The water only changes in a band, so
   the code records the bounding box of the tiles that changed since the last
   pack, and packWet() rewrites and uploads just that rectangle.
   rewrites and uploads just that rectangle.

   An empty box (-1) means "repack everything". That is what a new floor, a
   tint change and the first frame after a build ask for. */
let wetDirtyX0 = -1, wetDirtyY0 = -1, wetDirtyX1 = -1, wetDirtyY1 = -1;

// Grows the pending box by one tile. Both writers of wetArr (the flood and the player's splashes) use it.
export function markWetTile(i) {
  repaintDirty.water = true;
  const x = i % MAP_W, y = (i / MAP_W) | 0;
  if (x < wetDirtyX0) wetDirtyX0 = x; else if (x > wetDirtyX1) wetDirtyX1 = x;
  if (y < wetDirtyY0) wetDirtyY0 = y; else if (y > wetDirtyY1) wetDirtyY1 = y;
}

export function markWetAll() {
  repaintDirty.water = true;
  wetDirtyX0 = wetDirtyY0 = wetDirtyX1 = wetDirtyY1 = -1;
}

/* Hands the pending box to the renderer and starts a fresh one. The renderer
   packs and uploads that region, so after this call nothing is pending. */
export function takeWetBox() {
  const full = wetDirtyX1 < 0;
  const box = { full, x0: full ? 0 : wetDirtyX0, y0: full ? 0 : wetDirtyY0,
                x1: full ? MAP_W - 1 : wetDirtyX1, y1: full ? MAP_H - 1 : wetDirtyY1 };
  wetDirtyX0 = wetDirtyY0 = wetDirtyX1 = wetDirtyY1 = -1;
  return box;
}

/* Resets the repaint state for a new floor. */
export function resetRepaint() {
  repaintDirty.water = true;
  repaintDirty.mask = true;
  wetDirtyX0 = wetDirtyY0 = wetDirtyX1 = wetDirtyY1 = -1;
}