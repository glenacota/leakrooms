/* Headless harness for game.js.
   Installs the fake DOM / canvas / audio / storage globals game.js boots
   against, loads the real module, and hands the suite its handles:
   A (__api), G (live proxy), els, calls, store, press.
   test.js keeps only what is test-specific. */
import { calls, els, fakeCanvas, fakeEl, fakeCtx } from './stubs.js';

/* ---- fake DOM ---- */
global.document = {
  getElementById(id){ return els[id] || (els[id]=fakeEl(id)); },
  querySelector(sel){ return els[sel] || (els[sel]=fakeEl(sel)); },
  querySelectorAll(){ return []; },
  /* The game builds its own canvases (the light bake, the mask, the packed
     flood field, the procedural textures) rather than declaring them in markup,
     so the harness has to hand out elements too. Without this the module fails
     to LOAD, which is worth stating plainly: a stub gap here does not fail one
     assertion, it kills the entire suite before a single test runs. */
  createElement(tag){ return tag==='canvas' ? fakeCanvas() : fakeEl(tag); },
  addEventListener(){},
  body: { appendChild(){} },
};
global.__audioNodes = [];
global.window = {
  /* Key handlers are kept so tests can press real keys. Every screen change
     in this game is a key handler away, and a suite that could not press a
     key could not tell a working menu from a decorative one. */
  _h:{},
  addEventListener(t,f){ this._h[t]=f; },
  devicePixelRatio:1,
  AudioContext: undefined,   // exercise the no-AudioContext fallback path
};
global.requestAnimationFrame = ()=>0;
global.performance = { now: ()=> Date.now() };

/* ---- a real localStorage ----
   The settings store's whole job is surviving a round trip. A stub that
   silently did nothing would let the persistence code be entirely untested,
   which is the one part of it that can fail silently in production. Tests can
   reach the store to corrupt it deliberately. */
const store = new Map();
global.__store = store;
global.localStorage = {
  getItem(k){ return store.has(k) ? store.get(k) : null; },
  setItem(k,v){ store.set(k, String(v)); },
  removeItem(k){ store.delete(k); },
  clear(){ store.clear(); },
};

/* ---- load game.js as an ES module ----
   Dynamic import: the stubs above must be installed first, and static
   imports hoist above any other module code. game.js boots against the fake
   DOM: buildFloor, paintSplashPlan, requestAnimationFrame. */
function normalizeArg(v){
  if (v === null || v === undefined) return v;
  if (typeof v === 'number') return Number(v.toFixed(6));
  if (typeof v === 'boolean' || typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(normalizeArg);
  if (typeof v === 'object') {
    if (typeof v.getContext === 'function' && 'width' in v && 'height' in v) {
      return `canvas ${v.width}x${v.height}`;
    }
    if (typeof v.addColorStop === 'function') return 'grad(...)';
    // generic object (e.g. an ImageData-like): keep a stable shape
    return Object.prototype.toString.call(v);
  }
  return String(v);
}

function makeRecordingCtx(){
  const base = fakeCtx();
  const log = [];
  const handler = {
    get(target, prop){
      // expose the log on the ctx itself
      if (prop === 'log') return log;
      const val = target[prop];
      if (typeof val === 'function') {
        return (...args) => {
          log.push([String(prop), ...args.map(normalizeArg)]);
          return val.apply(target, args);
        };
      }
      return val;
    },
    set(target, prop, value){
      log.push([String(prop), normalizeArg(value)]);
      target[prop] = value;
      return true;
    }
  };
  return new Proxy(base, handler);
}

export async function loadGame(opts = {}){
  if (opts.recordMain) {
    // make #game a recording canvas before game.js reads it
    const rec = makeRecordingCtx();
    const cv = fakeCanvas();
    cv._ctx = rec;
    els.game = cv;
    // override getContext just in case
    cv.getContext = () => rec;
    const mod = await import('../../game.js');
    const A = mod.__api;
    const G  = new Proxy({}, { get:(_,k)=>A.G[k], set:(_,k,v)=>{A.G[k]=v; return true;} });
    const press = (key, extra={}) => global.window._h.keydown({
      key, repeat:false, metaKey:false, ctrlKey:false, altKey:false,
      preventDefault(){}, ...extra });
    return { A, G, els, calls, store, press, recCtx: rec };
  }
  const mod = await import('../../game.js');
  const A = mod.__api;
  const G  = new Proxy({}, { get:(_,k)=>A.G[k], set:(_,k,v)=>{A.G[k]=v; return true;} });
  const press = (key, extra={}) => global.window._h.keydown({
    key, repeat:false, metaKey:false, ctrlKey:false, altKey:false,
    preventDefault(){}, ...extra });
  return { A, G, els, calls, store, press };
}
