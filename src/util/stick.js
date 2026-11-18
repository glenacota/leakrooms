import { STICK } from '../config/constants.js';

/* Invalid presets fall back to normal so saved data cannot remove sprint input. */
export function sprintThresholds(preset){
  const known = typeof preset === 'string'
    && Object.prototype.hasOwnProperty.call(STICK.SPRINT_PRESETS, preset);
  const on = STICK.SPRINT_PRESETS[known ? preset : 'normal'];
  return { on, off: on - STICK.SPRINT_HYST };
}

/* Maps a thumb offset to movement and sprint state without screen state. */
export function stickMap(dx, dy, radius, prevSprint, preset){
  if (!(radius > 0)) return { x: 0, y: 0, mag: 0, sprint: false };
  const len = Math.hypot(dx, dy);
  const raw = Math.min(1, len / radius);

  /* Exact zero prevents tiny movement from keeping the plumber from repairing. */
  if (raw < STICK.DEAD) return { x: 0, y: 0, mag: 0, sprint: false };

  /* Preserve zero speed at the dead-zone edge instead of jumping to a fixed minimum. */
  const mag = (raw - STICK.DEAD) / (1 - STICK.DEAD);

  /* Two thresholds so a thumb resting near the sprint line does not flicker
     between walk and sprint every frame. */
  const t = sprintThresholds(preset);
  const sprint = prevSprint ? raw >= t.off : raw >= t.on;

  return { x: dx / len * mag, y: dy / len * mag, mag, sprint };
}
