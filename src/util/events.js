/* A tiny event bus. Listeners are stored per event type.

   Delivery walks an array snapshot of them, so a listener that subscribes or
   unsubscribes mid-delivery cannot make another listener be skipped or called
   twice. That snapshot is kept between emits and thrown away when the listener
   set changes, because emit() runs several times a frame and copying the set
   each time was most of its cost. */

/* Canonical event-type names. Every emit() and on() call site should use
   these constants instead of bare strings, so a typo throws ReferenceError
   instead of silently dropping the event. */
export const EVENT = Object.freeze({
  sfx: 'sfx',
  heard: 'heard',
  stat: 'stat',
  caught: 'caught',
  flash: 'flash',
  doorCycled: 'door:cycled',
  waterChanged: 'waterChanged',
  tileChanged: 'tileChanged',
  clockOut: 'clock:out',
  sprint: 'sprint',
  maskChanged: 'maskChanged',
  splashRepaint: 'splash:repaint',
  clearShow: 'clear:show',
  screen: 'screen',
  hud: 'hud',
  state: 'state',
  win: 'win',
  lives: 'lives',
  dead: 'dead',
  reset: 'reset',
  runStart: 'run:start',
  floorBuilt: 'floorBuilt',
  resize: 'resize',
  settingsChanged: 'settings:changed',
  particle: 'particle',
  contextrestored: 'contextrestored',
  inputMode: 'input:mode',
  inputLost: 'input:lost',
  tutorialsReset: 'tutorials:reset',
  tutorialsResetResult: 'tutorials:reset-result',
});

const listeners = new Map();
const delivery = new Map();      // type -> the array emit() last built

// Subscribes to an event. Returns a function that unsubscribes again.
export function on(type, fn){
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  delivery.delete(type);
  return () => off(type, fn);
}

export function off(type, fn){
  const set = listeners.get(type);
  if (!set) return;
  set.delete(fn);
  delivery.delete(type);
  if (set.size === 0) listeners.delete(type);
}

export function emit(type, ...args){
  const set = listeners.get(type);
  if (!set || set.size === 0) return;
  let list = delivery.get(type);
  if (!list){ list = [...set]; delivery.set(type, list); }
  for (const fn of list) fn(...args);
}

// Removes every listener. Only the tests need this.
export function clearAll(){
  listeners.clear();
  delivery.clear();
}