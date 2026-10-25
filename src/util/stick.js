import { STICK } from '../config/constants.js';

/* Turns a thumb offset into a movement vector. Pure maths, so it can be tested
   without a screen. dx and dy are pixels from the stick origin, radius is the
   stick's reach in pixels, prevSprint is the last result's sprint flag. */
export function stickMap(dx, dy, radius, prevSprint){
  if (!(radius > 0)) return { x: 0, y: 0, mag: 0, sprint: false };
  const len = Math.hypot(dx, dy);
  const raw = Math.min(1, len / radius);

  /* Exact zero inside the dead zone. The sim tests `ix||iy`, and a value like
     1e-17 would count as moving, which would stop the repair. */
  if (raw < STICK.DEAD) return { x: 0, y: 0, mag: 0, sprint: false };

  /* Rescaled so speed grows from 0 at the dead-zone edge. Without it the plumber
     would jump to 20% speed the moment the thumb leaves the dead zone. */
  const mag = (raw - STICK.DEAD) / (1 - STICK.DEAD);

  /* Two thresholds so a thumb resting near the sprint line does not flicker
     between walk and sprint every frame. */
  const sprint = prevSprint ? raw >= STICK.SPRINT_OFF : raw >= STICK.SPRINT_ON;

  return { x: dx / len * mag, y: dy / len * mag, mag, sprint };
}
