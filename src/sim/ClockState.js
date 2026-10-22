/**
 * ClockState — time/clock/clockAnnounced.
 */
import { FLOOR_CLOCK } from '../config/tuning.js';

export function createClockState() {
  return {
    time: 0,
    clock: FLOOR_CLOCK,
    clockAnnounced: false,
  };
}