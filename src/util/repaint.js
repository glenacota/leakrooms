/* Shared dirty tracking for simulation changes and renderer repaints. */
import { MAP } from '../config/constants.js';

export const repaintDirty = {
  water: true,
  mask: true,
};

/* Mutable bounding-box limits for water tiles changed since the last render. 
   A -1 value means no partial bounds are stored and it will lead to a repaint. */
let wetDirtyX0 = -1, wetDirtyY0 = -1, wetDirtyX1 = -1, wetDirtyY1 = -1;

export function markWetTile(i) {
  repaintDirty.water = true;
  const x = i % MAP.WIDTH_TILES, y = (i / MAP.WIDTH_TILES) | 0;
  if (x < wetDirtyX0) wetDirtyX0 = x; else if (x > wetDirtyX1) wetDirtyX1 = x;
  if (y < wetDirtyY0) wetDirtyY0 = y; else if (y > wetDirtyY1) wetDirtyY1 = y;
}

export function markWetAll() {
  repaintDirty.water = true;
  wetDirtyX0 = wetDirtyY0 = wetDirtyX1 = wetDirtyY1 = -1;
}

// a wetBox is the snapshot returned to the renderer
export function takeWetBox() {
  const full = wetDirtyX1 < 0;
  const box = { full, x0: full ? 0 : wetDirtyX0, y0: full ? 0 : wetDirtyY0,
                x1: full ? MAP.WIDTH_TILES - 1 : wetDirtyX1, y1: full ? MAP.HEIGHT_TILES - 1 : wetDirtyY1 };
  wetDirtyX0 = wetDirtyY0 = wetDirtyX1 = wetDirtyY1 = -1;
  return box;
}

export function resetRepaint() {
  repaintDirty.water = true;
  repaintDirty.mask = true;
  wetDirtyX0 = wetDirtyY0 = wetDirtyX1 = wetDirtyY1 = -1;
}