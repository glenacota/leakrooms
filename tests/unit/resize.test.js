/* THE WINDOW DRAG, AND THE CONTEXT THAT WENT AWAY.

   Two ways this renderer used to lose its pictures without anybody noticing.

   A drag: every 'resize' reallocated the backing store, rebuilt a screen-sized
   grain — a fresh noise buffer, tens of megabytes of Math.random per second —
   and repainted the splash plan for a canvas that is only visible on the title
   chain. Fifty events from one gesture, all of it work nobody asked for.

   Context loss: a GPU reset or a graphics-chip switch takes every bitmap the
   renderer draws from, and the game kept running at full frame rate drawing from
   blank canvases. A black rectangle with a clock behind it. */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';
import { on } from '../../src/util/events.js';

const { A, G, els } = await loadGame();

/* Counts the screen-sized canvases a burst of resize events builds. The grain is
   the only one that is the size of the canvas, and it is allocated through
   createElement like everything else, so this is a spy on allocation rather than
   on a function the suite would have to be told about. */
function spyOnScreenCanvases(){
  const made = [];
  const original = document.createElement;
  document.createElement = function(tag){
    const el = original.call(document, tag);
    if (tag === 'canvas') made.push(el);
    return el;
  };
  return {
    made,
    /* Read the size afterwards: a canvas is created and sized in two steps, and
       the size is the only thing that identifies the grain. */
    screenSized(){ return made.filter(c => c.width === A.internals.cvs.width && c.height === A.internals.cvs.height); },
    stop(){ document.createElement = original; },
  };
}

const settle = ms => new Promise(res => setTimeout(res, ms));

test('[45] a window drag is one resize, and a lost context is rebuilt', async () => {
  /* --- a drag is fifty events and one rebuild --- */
  const resize = global.window._h.resize;
  assert.equal(typeof resize, 'function', 'no resize listener was registered');

  const spy = spyOnScreenCanvases();
  /* The event itself is the sharper count: every allocation downstream hangs off
     it, and one drag should produce exactly one of them. */
  let announced = 0;
  const count = () => announced++;
  on('resize', count);
  for (let i = 0; i < 50; i++) resize();
  assert.equal(announced, 0,
    `${announced} resize events announced during the drag — the browser's event is held back, resize() itself is not`);
  await settle(150);
  const built = spy.screenSized().length;
  spy.stop();
  assert.equal(announced, 1,
    `50 resize events announced ${announced} — a drag is one resize, not fifty`);
  assert.ok(built <= 2,
    `50 resize events built ${built} screen-sized canvases — a drag is one resize, not fifty`);

  /* ...and it really did resize: the backing store is the window times the ratio
     the harness reports, which is 1 with devicePixelRatio 1 and scale 0. */
  const cvs = A.internals.cvs;
  assert.equal(cvs.width, Math.floor(cvs.clientWidth * Math.min(global.window.devicePixelRatio || 1, 2)),
    `the debounced resize left the backing store at ${cvs.width}px for a ${cvs.clientWidth}px window`);

  /* --- a lost context takes every bitmap with it --- */
  const before = {
    light: G.lightCv,
    tiles: G.tilesCv,
  };
  let prevented = false;
  els.game._fire('contextlost', { preventDefault(){ prevented = true; } });
  assert.equal(prevented, true,
    "contextlost was not preventDefault()ed — the browser will not promise to give the context back");

  els.game._fire('contextrestored', {});
  assert.ok(G.lightCv !== before.light,
    'the light bake was not rebuilt after a context loss — the floor is drawing from a canvas with no pixels in it');
  assert.ok(G.tilesCv !== before.tiles,
    'the static tile layer was not rebuilt after a context loss');
  assert.equal(G.dirty.water, true, 'the packed flood image was not marked stale after a rebuild');
  assert.equal(G.dirty.mask, true, 'the visibility mask was not marked stale after a rebuild');

  console.log('[45] a window drag is one resize, and a lost context is rebuilt');
  console.log(`  50 events -> ${built} screen-sized canvas(es); light bake and tiles rebuilt on restore`);
});