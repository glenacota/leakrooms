/* ============================================================
   HAPTICS
   Short buzzes for the sounds that mean danger, on devices that can vibrate.
   iOS Safari has no navigator.vibrate; there this file does nothing at all, with
   no error and no listener.

   It listens to the sound events the simulation already emits, so no new
   simulation event exists for it. It does not depend on mute: a player with
   the sound off can still feel the game.
   ============================================================ */
import { SETTINGS } from '../settings/store.js';
import { on } from '../util/events.js';

/* Milliseconds. Sound names not listed here (the splash of a wet step, the beds,
   the wrench) do not buzz: a buzz on every step would be noise, not warning. The
   'heard' event (ui/hints.js subscribes too) buzzes only when the lifeform is
   searching or hunting — RISING is a heads-up, not danger yet. */
export const PULSE_MS = { sting: 25, rattle: 25, door: 25 };
export const HEARD_MS = 25;
export const DEAD_MS = 120;

const HEARD_BUZZ = new Set(['HUNT', 'SEARCH']);

function buzz(ms){
  if (!SETTINGS.haptics) return;
  /* vibrate() can refuse, or throw, when the page has had no touch yet. A missed
     buzz is not worth an error. */
  try { navigator.vibrate(ms); } catch (_) { /* refused */ }
}

/**
 * Subscribes to the events. Returns a function that unsubscribes them again,
 * and a no-op one where the device cannot vibrate.
 */
export function initHaptics(){
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return () => {};
  const offSfx = on('sfx', name => { if (PULSE_MS[name]) buzz(PULSE_MS[name]); });
  const offHeard = on('heard', e => { if (e && e.to && HEARD_BUZZ.has(e.to)) buzz(HEARD_MS); });
  const offDead = on('dead', () => buzz(DEAD_MS));
  return () => { offSfx(); offHeard(); offDead(); };
}
