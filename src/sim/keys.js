/* Which keys are held right now. Written by the keydown and keyup handlers
   (ui/input.js) and read by update(). */
export const keys = {};

/* The on-screen stick: x and y in [-1, 1], plus a sprint flag. It lives next to
   keys so one call can release both. Nothing reads it yet. */
export const pad = { x: 0, y: 0, sprint: false };

/* Releases everything held, keys and stick alike. Every place that needs a clean
   slate (focus loss, state change, closing the chooser) calls this one function,
   so a new input source cannot be forgotten in one of them. */
export function clearInput(){
  for (const k in keys) delete keys[k];
  pad.x = 0; pad.y = 0; pad.sprint = false;
}
