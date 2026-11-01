/* Fullscreen: the pure answers, the async calls and the wiring, all against fake
   env objects. The harness has no real fullscreen, and the point of the design
   is that nothing here needs one. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';

await loadGame();
const F = await import('../../src/ui/fullscreen.js');

/* A fake browser. `calls` records what was asked of it. */
function fakeEnv(o = {}){
  const calls = { request: 0, exit: 0, lock: [], handlers: {}, screens: {} };
  const root = { dataset: { input: o.input || 'touch' } };
  if (o.request !== 'none'){
    root.requestFullscreen = () => {
      calls.request++;
      if (o.reject) return Promise.reject(new Error('denied'));
      doc.fullscreenElement = root;
      return Promise.resolve();
    };
  }
  const el = id => (calls.screens[id] ||= {
    id, textContent: '', _l: {},
    addEventListener(t, f){ (this._l[t] ||= []).push(f); },
    click(){ for (const f of this._l.click || []) f({ target: this }); },
  });
  const hints = [{ hidden: true }, { hidden: true }];
  const doc = {
    fullscreenEnabled: o.enabled === undefined ? true : o.enabled,
    documentElement: root,
    getElementById: el,
    querySelectorAll: sel => sel === '.fs-hint' ? hints : [],
    addEventListener(t, f){ calls.handlers[t] = f; },
    exitFullscreen(){ calls.exit++; doc.fullscreenElement = null; return Promise.resolve(); },
  };
  if (o.webkitOnly){
    delete doc.fullscreenEnabled; doc.webkitFullscreenEnabled = true;
    root.webkitRequestFullscreen = root.requestFullscreen; delete root.requestFullscreen;
  }
  const win = {
    screen: { orientation: { lock: async a => { calls.lock.push(a); if (o.lockReject) throw new Error('no'); } } },
    matchMedia: o.standalone ? () => ({ matches: true }) : () => ({ matches: false }),
    localStorage: o.storage,
  };
  return { env: { doc, win, nav: { userAgent: o.ua || 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile', standalone: o.navStandalone } }, calls, hints, doc, root };
}

const ALL = { setting: 'auto', touch: true, supported: true, active: false, standalone: false, exitedByUser: false, alreadyTried: false };

test('[FS] fullscreenSupported: enabled + element method; prefixed counts; neither is false', () => {
  assert.equal(F.fullscreenSupported(fakeEnv().env), true);
  assert.equal(F.fullscreenSupported(fakeEnv({ webkitOnly: true }).env), true);
  assert.equal(F.fullscreenSupported(fakeEnv({ enabled: false }).env), false);
  assert.equal(F.fullscreenSupported(fakeEnv({ request: 'none' }).env), false);
  // The iPhone case: neither the flag nor the method.
  assert.equal(F.fullscreenSupported(fakeEnv({ enabled: undefined, request: 'none' }).env), false);
  for (const bad of [undefined, null, {}, { doc: {} }, { doc: { documentElement: null } }])
    assert.equal(F.fullscreenSupported(bad), false);
});

test('[FS] isFullscreen and isStandalone read what is there and never throw', () => {
  const f = fakeEnv();
  assert.equal(F.isFullscreen(f.env), false);
  f.doc.fullscreenElement = {};
  assert.equal(F.isFullscreen(f.env), true);
  assert.equal(F.isFullscreen({}), false);
  assert.equal(F.isStandalone(fakeEnv().env), false);
  assert.equal(F.isStandalone(fakeEnv({ standalone: true }).env), true);
  assert.equal(F.isStandalone(fakeEnv({ navStandalone: true }).env), true);
  assert.equal(F.isStandalone({ win: { matchMedia(){ throw new Error('x'); } } }), false);
  assert.equal(F.isStandalone(undefined), false);
});

test('[FS] shouldAutoEnter: true only when everything holds, each false on its own', () => {
  assert.equal(F.shouldAutoEnter(ALL), true);
  for (const [k, bad] of [['setting', 'off'], ['setting', undefined], ['touch', false], ['supported', false],
                          ['active', true], ['standalone', true], ['exitedByUser', true], ['alreadyTried', true]])
    assert.equal(F.shouldAutoEnter({ ...ALL, [k]: bad }), false, `${k}=${bad}`);
});

test('[FS] enterFullscreen: true on success, false (no throw) on reject, missing method, absent env', async () => {
  const ok = fakeEnv();
  assert.equal(await F.enterFullscreen(ok.env), true);
  assert.equal(ok.calls.request, 1);
  assert.equal(await F.enterFullscreen(fakeEnv({ reject: true }).env), false);
  assert.equal(await F.enterFullscreen(fakeEnv({ request: 'none' }).env), false);
  for (const bad of [undefined, null, {}, { doc: {} }, { doc: undefined, win: {} }])
    assert.equal(await F.enterFullscreen(bad), false);
  assert.equal(await F.enterFullscreen(fakeEnv({ webkitOnly: true }).env), true);
});

test('[FS] the request is made synchronously, inside the caller (the user gesture)', () => {
  const f = fakeEnv();
  F.enterFullscreen(f.env);           // not awaited
  assert.equal(f.calls.request, 1, 'the request waited for a tick');
});

test('[FS] the orientation lock is tried after success, and its rejection is swallowed', async () => {
  const f = fakeEnv();
  await F.enterFullscreen(f.env);
  assert.deepEqual(f.calls.lock, ['landscape']);
  const g = fakeEnv({ lockReject: true });
  assert.equal(await F.enterFullscreen(g.env), true);
  assert.deepEqual(g.calls.lock, ['landscape']);
  const h = fakeEnv({ reject: true });
  await F.enterFullscreen(h.env);
  assert.deepEqual(h.calls.lock, [], 'locked after a failed request');
});

test('[FS] exitFullscreen and toggleFullscreen', async () => {
  const f = fakeEnv();
  await F.toggleFullscreen(f.env);
  assert.equal(f.calls.request, 1);
  await F.toggleFullscreen(f.env);
  assert.equal(f.calls.exit, 1);
  assert.equal(await F.exitFullscreen({}), false);
  assert.equal(await F.exitFullscreen(undefined), false);
});

/* ---- the click wiring ---- */
function wired(o = {}, state = { v: 'splash' }){
  const f = fakeEnv(o);
  const paused = { n: 0 };
  const api = F.initFullscreen(f.env, {
    getState: () => state.v, pause: () => { paused.n++; state.v = 'pause'; },
    getSetting: () => (o.setting === undefined ? 'auto' : o.setting),
  });
  return { ...f, api, paused, state };
}

test('[FS] a click on the title requests fullscreen exactly once, in touch mode with auto', () => {
  const w = wired();
  assert.equal(w.root.dataset.fs, 'off');
  w.calls.screens['screen-splash'].click();
  assert.equal(w.calls.request, 1);
  w.calls.screens['screen-splash'].click();
  w.calls.screens['screen-binder'].click();
  assert.equal(w.calls.request, 1, 'asked again');
});

test('[FS] ...not in kbm mode, not with off, not when unsupported', () => {
  const kbm = wired({ input: 'kbm' });
  kbm.calls.screens['screen-splash'].click();
  assert.equal(kbm.calls.request, 0);
  assert.equal(kbm.root.dataset.fs, 'off');
  const off = wired({ setting: 'off' });
  off.calls.screens['screen-splash'].click();
  assert.equal(off.calls.request, 0);
  const un = wired({ enabled: false });
  un.calls.screens['screen-splash'].click();
  assert.equal(un.calls.request, 0);
  assert.equal(un.root.dataset.fs, 'unsupported');
});

test('[FS] ...not from the home screen, and not after the player left fullscreen', () => {
  const sa = wired({ standalone: true });
  sa.calls.screens['screen-splash'].click();
  assert.equal(sa.calls.request, 0);

  const w = wired();
  w.doc.fullscreenElement = {};            // it is on...
  w.calls.handlers.fullscreenchange();
  assert.equal(w.root.dataset.fs, 'on');
  w.doc.fullscreenElement = null;          // ...and the player leaves
  w.calls.handlers.fullscreenchange();
  assert.equal(w.root.dataset.fs, 'off');
  w.calls.screens['screen-binder'].click();
  assert.equal(w.calls.request, 0, 'went back in after the player left');
});

test('[FS] the button label follows the state', () => {
  const w = wired();
  const b = w.calls.screens['btn-fullscreen'];
  assert.equal(b.textContent, 'ENTER FULLSCREEN');
  w.doc.fullscreenElement = {};
  w.calls.handlers.fullscreenchange();
  assert.equal(b.textContent, 'EXIT FULLSCREEN');
  w.doc.fullscreenElement = null;
  w.calls.handlers.webkitfullscreenchange();
  assert.equal(b.textContent, 'ENTER FULLSCREEN');
});

test('[FS] leaving fullscreen during play pauses once; on the pause screen it does not toggle', () => {
  const state = { v: 'play' };
  const w = wired({}, state);
  w.doc.fullscreenElement = {}; w.calls.handlers.fullscreenchange();
  assert.equal(w.paused.n, 0, 'entering must not pause');
  w.doc.fullscreenElement = null; w.calls.handlers.fullscreenchange();
  assert.equal(w.paused.n, 1);
  w.calls.handlers.fullscreenchange();       // a second event while already paused
  assert.equal(w.paused.n, 1, 'toggled pause again');

  const p = wired({}, { v: 'pause' });
  p.doc.fullscreenElement = {}; p.calls.handlers.fullscreenchange();
  p.doc.fullscreenElement = null; p.calls.handlers.fullscreenchange();
  assert.equal(p.paused.n, 0, 'toggled pause on the pause screen');
});

test('[FS] a missing document or screens does not throw at init', () => {
  assert.doesNotThrow(() => F.initFullscreen({}, {}));
  assert.doesNotThrow(() => F.initFullscreen({ doc: {} }, {}));
  assert.doesNotThrow(() => F.initFullscreen(undefined, {}));
});

/* ---- the tip ---- */
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const HINT = { ua: IPHONE, standalone: false, supported: false, dismissed: false };

test('[FS] needsHomeScreenHint: only iPhone + not standalone + unsupported + not dismissed', () => {
  assert.equal(F.needsHomeScreenHint(HINT), true);
  for (const [k, v] of [['ua', 'Mozilla/5.0 (Linux; Android 14) Mobile'], ['ua', ''], ['ua', undefined],
                        ['standalone', true], ['supported', true], ['dismissed', true]])
    assert.equal(F.needsHomeScreenHint({ ...HINT, [k]: v }), false, `${k}=${v}`);
});

test('[FS] the tip shows on an iPhone, and dismissing hides it for good', () => {
  const store = new Map();
  const storage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, v) };
  const f = fakeEnv({ ua: IPHONE, enabled: undefined, request: 'none', storage });
  F.initFullscreen(f.env, {});
  assert.equal(f.root.dataset.fs, 'unsupported');
  assert.deepEqual(f.hints.map(h => h.hidden), [false, false]);
  F.dismissHint(f.env);
  assert.deepEqual(f.hints.map(h => h.hidden), [true, true]);
  assert.ok(store.has(F.HINT_KEY), 'not saved under its own key');
  assert.equal(F.HINT_KEY, 'leakrooms.hint.v1');
});

test('[FS] a throwing localStorage does not break the tip', () => {
  const bad = { getItem(){ throw new Error('blocked'); }, setItem(){ throw new Error('blocked'); } };
  const f = fakeEnv({ ua: IPHONE, enabled: undefined, request: 'none', storage: bad });
  assert.doesNotThrow(() => F.initFullscreen(f.env, {}));
  assert.doesNotThrow(() => F.dismissHint(f.env));
  assert.deepEqual(f.hints.map(h => h.hidden), [true, true], 'stayed up after dismissal');
});

test('[FS] the tip is not a setting: RESET SETTINGS leaves its key alone', async () => {
  const { A } = await loadGame();
  global.__store.set(F.HINT_KEY, JSON.stringify({ homeScreen: true }));
  A.resetSettings();
  assert.equal(global.__store.get(F.HINT_KEY), JSON.stringify({ homeScreen: true }));
  assert.equal('hint' in A.SETTINGS_DEFAULTS, false);
  global.__store.delete(F.HINT_KEY);
});
