/* Tiny event bus. Listeners are stored per type; emit iterates a snapshot so
   a listener that (un)subscribes during dispatch cannot skip or double-fire. */
const listeners = new Map();

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

export function clearAll(){
  listeners.clear();
}
