/* Frame-time overlay: nothing exists without ?perf=1; with it, the readout
   updates twice per second and writes the DOM only when the text changes.
   The overlay reads document.location, which is shared between the test and
   the module, so the test can toggle ?perf=1 via document.location.search. */
import test from 'node:test';
import { strict as assert } from 'node:assert';

/* canvas.js touches document/window/performance at module load, so stub them
   before importing perf.js (loadGame() is not used, to keep control of when
   perf.js first sees location.search). */
global.performance = { now: () => Date.now() };
global.window = { addEventListener(){}, devicePixelRatio: 1 };
global.document = {
  getElementById: () => ({ getContext: () => ({}), addEventListener(){}, removeEventListener(){} }),
  location: { search: '', href: 'http://localhost/' },
};

test('[PERF] nothing is created without ?perf=1', () => {
  document.location.search = '';
  const intervals = [];
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, ms) => { intervals.push(ms); return {}; };

  return import('../../src/ui/perf.js').then((perf) => {
    globalThis.setInterval = realSetInterval;
    assert.equal(intervals.length, 0, 'no ticker started without ?perf=1');
    assert.equal(perf.initPerf(), null, 'initPerf is a no-op without ?perf=1');
    assert.equal(intervals.length, 0, 'still no ticker after initPerf without ?perf=1');
  });
});

test('[PERF] with ?perf=1, ticks twice per second and does not rewrite unchanged text', () => {
  document.location.search = '?perf=1';
  const intervals = [];
  let tickFn = null;
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, ms) => { intervals.push(ms); tickFn = fn; return { ref: ()=>{} }; };

  const perfEl = {
    _text: '',
    writes: 0,
    style: {},
    hidden: true,
    get textContent(){ return this._text; },
    set textContent(v){ this.writes++; this._text = v; },
  };

  return import('../../src/ui/perf.js').then((perf) => {
    document.location.search = '?perf=1';
    perf.initPerf(perfEl); // runs tick() once immediately
    assert.equal(intervals.length, 1, 'one ticker started');
    assert.equal(intervals[0], 500, `ticker is ${intervals[0]} ms, want twice per second`);
    assert.equal(perfEl.writes, 1, 'first tick writes the readout');
    perf.initPerf(perfEl); // idempotent: already running
    assert.equal(perfEl.writes, 1, 'a second initPerf does not write again');

    /* The values have not changed, so a second tick must not write. */
    tickFn();
    assert.equal(perfEl.writes, 1, 'unchanged text is not written to the DOM again');
    globalThis.setInterval = realSetInterval;
  });
});
