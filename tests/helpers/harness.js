/* Headless harness.
   Installs the fake DOM, canvas, audio and storage globals that src/boot.js
   expects, boots the real game against them, and returns the handles the suite
   works through: A (the API), G (a live proxy on the game state), els, calls,
   store and press. */
import { calls, els, fakeCanvas, fakeCtx } from './stubs.js';
import * as dom from './dom.js';

/* Every id the game has asked for so far.
   An id the markup does not carry still gets an element invented for it, so a
   write to a missing element fails silently. Recording the lookups lets a test
   check the whole list against index.html. */
export const askedIds = [];

/* ---- fake DOM ----
   Backed by the shipped markup (see dom.js), so wiring the game does by querying
   the document is built in tests the way it is in the browser. */
global.document = {
  /* `els` wins over the markup: a test that plants an element under an id owns
     it. The trace harness relies on this to swap #game for a recording canvas
     before the game boots. */
  getElementById(id){
    askedIds.push(id);
    if (id in els) return els[id];
    const found = dom.getElementById(id);
    return (els[id] = found || dom.makeEl(id));
  },
  querySelector(sel){
    if (sel in els) return els[sel];
    const found = dom.querySelector(sel);
    return (els[sel] = found || dom.makeEl(sel));
  },
  querySelectorAll(sel){ return dom.querySelectorAll(sel); },
  /* The game creates its own canvases (the light bake, the mask, the packed
     flood field, the procedural textures) instead of declaring them in markup,
     so the harness has to hand out elements too. A gap here stops the module
     from loading at all, which kills the whole suite rather than one
     assertion. */
  createElement(tag){ return tag==='canvas' ? fakeCanvas() : dom.createElement(tag); },
  addEventListener(){},
  body: { appendChild(){} },
};
global.__audioNodes = [];
global.window = {
  /* Key handlers are kept so tests can press real keys. Every screen change in
     this game is a key handler away, so a suite that cannot press a key cannot
     tell a working menu from a decorative one. */
  _h:{},
  addEventListener(t,f){ this._h[t]=f; },
  devicePixelRatio:1,
  AudioContext: undefined,   // exercise the no-AudioContext fallback path
};
global.requestAnimationFrame = ()=>0;
global.performance = { now: ()=> Date.now() };

/* ---- a real localStorage ----
   Persistence is the part of the settings store that fails silently in
   production, so tests get a store that actually round-trips. Tests can reach
   `store` to corrupt it deliberately. */
const store = new Map();
global.__store = store;
global.localStorage = {
  getItem(k){ return store.has(k) ? store.get(k) : null; },
  setItem(k,v){ store.set(k, String(v)); },
  removeItem(k){ store.delete(k); },
  clear(){ store.clear(); },
};

/* ---- load the game as an ES module ----
   The import has to be dynamic: the stubs above must be installed first, and
   static imports hoist above any other module code. */
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
  let recCtx = null;
  if (opts.recordMain) {
    // make #game a recording canvas before the game boots
    recCtx = makeRecordingCtx();
    const cv = fakeCanvas();
    cv._ctx = recCtx;
    els.game = cv;
    // override getContext just in case
    cv.getContext = () => recCtx;
  }
  const mod = await import('../../src/boot.js');
  mod.boot();
  const { __api: A } = await import('./api.js');
  const G  = new Proxy({}, { get:(_,k)=>A.G[k], set:(_,k,v)=>{A.G[k]=v; return true;} });
  /* `code` as well as `key`: the game reads the movement cluster, the radar and
     the mute from the physical key, so a press that sends only the character
     would be pressing a letter rather than a key and the layout bug that
     distinction exists for would stay invisible. A real browser sends both. */
  const press = (key, extra={}) => global.window._h.keydown({
    key, repeat:false, metaKey:false, ctrlKey:false, altKey:false,
    code: /^[a-z]$/i.test(key) ? 'Key'+key.toUpperCase() : key,
    preventDefault(){}, ...extra });
  const result = { A, G, els, calls, store, press, askedIds };
  if (opts.recordMain) result.recCtx = recCtx;
  return result;
}
