/* A tiny event bus. Listeners are stored per event type, and emit() loops over
   a copy of them, so a listener that subscribes or unsubscribes while an event
   is being delivered cannot cause another listener to be skipped or called twice. */
const listeners = new Map();

// Subscribes to an event. Returns a function that unsubscribes again.
export function on(type, fn){
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => off(type, fn);
}

export function off(type, fn){
  const set = listeners.get(type);
  if (!set) return;
  set.delete(fn);
  if (set.size === 0) listeners.delete(type);
}

export function emit(type, ...args){
  const set = listeners.get(type);
  if (!set || set.size === 0) return;
  for (const fn of [...set]) fn(...args);
}

// Removes every listener. Only the tests need this.
export function clearAll(){
  listeners.clear();
}