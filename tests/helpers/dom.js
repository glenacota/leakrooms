/* A DOM stub backed by the shipped markup.

   The harness used to answer `querySelectorAll()` with `[]`, which meant every
   piece of wiring the game does by QUERYING the document — the settings panel,
   the segmented rows, the sliders, the pause tabs — was never constructed in a
   test. A handler body could reference a name nothing imports and the whole
   suite would stay green, because the handler was never created. That is not a
   hypothetical: `btn-terms-change` was wired to a closure calling an unimported
   `setTermsOpen` for the whole of step 32, and every test passed.

   So the element table is read from index.html. Not a DOM implementation — a
   flat list of the elements that carry an id, a `data-*` attribute, a class or a
   range input, with enough parent/child structure for the seven query shapes the
   game actually uses. Anything it does not recognise answers `[]`, exactly as
   it did before, so an unfamiliar selector degrades instead of breaking boot.

   What is read: id, tag, class tokens, data-*, type, and the `hidden` class for
   the two pause pages. What is modelled: children (for the segmented rows the
   game rebuilds), dataset, attributes, and listeners. What is not modelled:
   layout, events beyond direct dispatch, and the cascade. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeCtx } from './stubs.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* Tags that can hold other things, so the flat list can be linked into a tree.
   Void elements are listed only so the tag regex does not swallow the rest of
   the document when it meets one. */
const VOID = new Set(['meta','link','br','hr','img','input','source','area','base','col','embed','param','track','wbr']);

function parse(){
  const nodes = [];
  const stack = [];
  const tag = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s">]+))?)*)\s*(\/?)>/g;
  let m;
  while ((m = tag.exec(HTML))){
    const [, closing, name, rawAttrs, selfClose] = m;
    if (closing){
      for (let i = stack.length - 1; i >= 0; i--){
        if (stack[i].tag === name){ stack.length = i; break; }
      }
      continue;
    }
    const attrs = {};
    const attr = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+)))?/g;
    let a;
    while ((a = attr.exec(rawAttrs))){
      if (!a[1]) continue;
      attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? '';
    }
    const node = { tag: name, attrs, children: [], parent: stack[stack.length - 1] || null };
    if (node.parent) node.parent.children.push(node);
    nodes.push(node);
    if (!selfClose && !VOID.has(name)) stack.push(node);
  }
  return nodes;
}

export const NODES = parse();

function classesOf(n){
  return (n.attrs.class || '').split(/\s+/).filter(Boolean);
}
function dataKeys(n){
  return Object.keys(n.attrs).filter(k => k.startsWith('data-'));
}
/* `data-pause-tab` reaches the game as `dataset.pauseTab`: the attribute is
   dashed, the property is camel. Getting this backwards leaves an element that
   parses correctly and then answers undefined to everything that reads it. */
function camel(s){
  return s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}
function datasetOf(n){
  const ds = {};
  for (const k of dataKeys(n)) ds[camel(k.slice(5))] = n.attrs[k];
  return ds;
}

/* Which nodes can this stub answer for? Anything the game can look up: an id, a
   class (the HUD's `.bar.noise` and its `u.loud` child), a data attribute, or a
   range input. Plain <i>/<u>/<span> with neither an id nor a class are not
   addressable by any selector the game uses and are left out. */
const ADDRESSABLE = n =>
  n.attrs.id !== undefined || classesOf(n).length > 0 ||
  dataKeys(n).length > 0 || n.tag === 'button' || n.tag === 'input';

export const ELEMENTS = NODES.filter(ADDRESSABLE);

/* ---- matching ---------------------------------------------------------- */

/* The seven shapes the game uses, matched exactly. A selector this does not
   understand is simply not a selector it answers — see `select`. */
const MATCHERS = [
  { sel: '.bar.noise u.loud', test: n => n.tag === 'u' && classesOf(n).includes('loud') && !!closestNode(n, '.bar.noise') },
  { sel: '.bar.noise',       test: n => classesOf(n).includes('bar') && classesOf(n).includes('noise') },
  { sel: '.seg[data-opt]',   test: n => classesOf(n).includes('seg') && dataKeys(n).some(k => k === 'data-opt') },
  { sel: 'input[type=range][data-opt]',
    test: n => n.tag === 'input' && n.attrs.type === 'range' && dataKeys(n).some(k => k === 'data-opt') },
  { sel: '[data-pause-tab]', test: n => dataKeys(n).some(k => k === 'data-pause-tab') },
  { sel: '[data-pause-page]',test: n => dataKeys(n).some(k => k === 'data-pause-page') },
  { sel: 'button',           test: n => n.tag === 'button' },
];

function closestNode(n, sel){
  for (let p = n.parent; p; p = p.parent){
    const m = MATCHERS.find(x => x.sel === sel);
    if (m && m.test(p)) return p;
  }
  return null;
}

/* Nodes matching `sel`, restricted to the subtree when `within` is given. */
function select(sel, within){
  const scope = within ? descendants(within) : ELEMENTS;
  const m = MATCHERS.find(x => x.sel === sel);
  if (!m) return [];
  return scope.filter(m.test);
}

/* Both trees: the markup's, and whatever the game appended at runtime. The
   segmented rows are rebuilt on every boot with createElement + appendChild,
   so a descendant query that only walked the markup would find the row and
   none of its buttons — which is precisely the thing a test wants to assert
   about. */
function descendants(n){
  const out = [];
  const walkEl = e => { for (const c of e.childNodes){ out.push(c); walkEl(c); } };
  const walkNode = node => {
    for (const c of node.children){ out.push(c); walkNode(c); }
    if (node._el) walkEl(node._el);
  };
  walkNode(n);
  return out;
}

/* ---- the element ------------------------------------------------------- */

/* Everything the harness's old `fakeEl` had, plus the four things the wiring
   actually reaches for: dataset, attributes, children, and listeners that a
   test can fire. `node` is the markup record; when it is absent this is a bare
   element created on demand, exactly as before. */
export function makeEl(id, node){
  const listeners = {};
  const children = [];
  const attrs = Object.assign({}, node && node.attrs);
  const classes = new Set(node ? classesOf(node) : []);

  /* `tag` and `attrs` are on the element as well as on the markup record, so a
     node the GAME created answers the same matchers a parsed one does —
     otherwise the segmented row rebuilds to four buttons that no descendant
     query can see. */
  const el = {
    id: id !== undefined ? id : (node ? node.attrs.id : undefined),
    tag: node ? node.tag : 'div',
    attrs,
    tagName: node ? node.tag.toUpperCase() : 'DIV',
    style: {},
    dataset: node ? datasetOf(node) : {},
    textContent: '',
    innerHTML: '',
    value: node && node.attrs.value !== undefined ? node.attrs.value : '',
    clientWidth: 1280, clientHeight: 720,
    width: 0, height: 0,

    /* className mirrors classList so a test reads the same string the DOM
       would show, whichever one it happens to look at. */
    get className(){ return [...classes].join(' '); },
    set className(v){ classes.clear(); for (const c of String(v).split(/\s+/).filter(Boolean)) classes.add(c); },

    classList: {
      _s: classes,
      add(c){ (Array.isArray(c) ? c : [c]).forEach(x => classes.add(x)); },
      remove(c){ (Array.isArray(c) ? c : [c]).forEach(x => classes.delete(x)); },
      toggle(c, f){ f ? classes.add(c) : classes.delete(c); },
      contains(c){ return classes.has(c); },
      get value(){ return [...classes].join(' '); },
    },

    get attributes(){ return { ...attrs }; },
    setAttribute(k, v){ attrs[k] = String(v); },
    getAttribute(k){ return k in attrs ? attrs[k] : null; },
    hasAttribute(k){ return k in attrs; },

    appendChild(child){
      children.push(child);
      child.parentNode = el;
      return child;
    },
    removeChild(child){
      const i = children.indexOf(child);
      if (i >= 0) children.splice(i, 1);
      return child;
    },
    get childNodes(){ return children.slice(); },

    addEventListener(type, fn){ (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn){
      const l = listeners[type];
      if (l){ const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
    },
    /* A test dispatching to an element the game subscribed to. There is no event
       object to build and nothing in this game reads one. */
    _fire(type, arg){ for (const fn of (listeners[type] || []).slice()) fn(arg); },
    _has(type){ return (listeners[type] || []).length > 0; },

    /* The splash and order screens use this to tell "clicked a control" from
       "clicked the frame", which is the difference between advancing the chain
       and dismissing the terms fold. */
    closest(sel){
      const parts = sel.split(',').map(s => s.trim());
      for (let n = node; n; n = n.parent){
        if (parts.some(p => MATCHERS.find(m => m.sel === p)?.test(n))) return makeRef(n);
      }
      return null;
    },

    querySelector(sel){ const r = select(sel, node); return r.length ? makeRef(r[0]) : null; },
    querySelectorAll(sel){ return select(sel, node).map(makeRef); },

    /* Marks this as an element rather than a markup record. A ref to one is the
       element itself: rebuilding it would copy the shape and lose the handler
       and the text the game assigned, which is how a row full of working
       buttons reads as a row full of dead ones. */
    __el: true,
    click(){ if (el.onclick) el.onclick(); },
    /* The recording context, not a private one. The render, trace and cast
       tests assert on what was drawn, and the splash plan canvas is an ELEMENT
       from the markup rather than a canvas the game created — handing it a
       different context would silently stop recording there. */
    getContext(){ return fakeCtx(); },
  };

  /* A clear innerHTML empties the children, which is what the segmented-row
     rebuild relies on. */
  let _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get(){ return _html; },
    set(v){ _html = String(v); if (v === '') children.length = 0; },
  });

  return el;
}

const REFS = new WeakMap();
function makeRef(node){
  if (node && node.__el) return node;      // already an element: hand it back
  let r = REFS.get(node);
  if (!r){
    r = makeEl(node.attrs.id, node);
    node._el = r;
    /* The ref owns its child list: rebuilds through appendChild must be visible
       to a later querySelectorAll on the same node. */
    REFS.set(node, r);
  }
  return r;
}

/* ---- the document ------------------------------------------------------ */

const BY_ID = new Map();
for (const n of ELEMENTS) if (n.attrs.id !== undefined) BY_ID.set(n.attrs.id, n);

export function getElementById(id){
  const n = BY_ID.get(id);
  return n ? makeRef(n) : null;
}

export function querySelector(sel){
  const r = select(sel);
  return r.length ? makeRef(r[0]) : null;
}

export function querySelectorAll(sel){
  return select(sel).map(makeRef);
}

export function createElement(tag){
  return makeEl(undefined, { tag, attrs: {}, children: [], parent: null });
}

export { BY_ID as IDS };