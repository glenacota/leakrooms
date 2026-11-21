import test from 'node:test';
import assert from 'node:assert/strict';
import { readCss, readHtml } from '../helpers/src-text.js';
import { loadGame } from '../helpers/harness.js';

const { A, els } = await loadGame();
const html = readHtml();
const css = readCss();
const visibleScreens = () => A.SCREENS.filter(screenId =>
  !els[`screen-${screenId}`].hidden);

test('screen and binder vocabulary matches markup and CSS', () => {
  const screenIds = [...html.matchAll(/id="screen-([^"]+)"/g)].map(([, id]) => id);
  assert.deepEqual([...screenIds].sort(), [...A.SCREENS].sort());

  const binderModes = [...new Set([...html.matchAll(/data-binder-for="([^"]+)"/g)]
    .map(([, mode]) => mode))];
  assert.deepEqual(binderModes.sort(), [...A.BINDER_MODES].sort());
  const initialMode = html.match(/id="screen-binder"[^>]*data-binder-mode="([^"]+)"/)?.[1];
  assert.ok(A.BINDER_MODES.includes(initialMode), `unknown initial binder mode: ${initialMode}`);
  const styledModes = [...css.matchAll(/#screen-binder\[data-binder-mode=(\w+)\]/g)]
    .map(([, mode]) => mode);
  assert.deepEqual(styledModes.sort(), [...A.BINDER_MODES].sort());

  const binderPages = [...new Set([...html.matchAll(/data-binder-page="([^"]+)"/g)]
    .map(([, page]) => page))];
  const declaredPages = [...new Set([...A.SHIFT_TABS, ...A.PAUSE_TABS])];
  assert.deepEqual(binderPages.sort(), declaredPages.sort());
});

test('screen identity API rejects runtime states and unknown screens', () => {
  A.showScreen('splash');
  assert.throws(() => A.showScreen('pause'), {
    name: 'RangeError',
    message: 'Unknown screen: pause',
  });
  assert.throws(() => A.showScreen('unknown'), /Unknown screen: unknown/);
  assert.deepEqual(visibleScreens(), ['splash']);
});

test('run state maps pause to binder and play to no overlay', () => {
  A.buildFloor(0, 24601);
  A.STATE = 'play';
  A.togglePause();
  assert.equal(A.STATE, 'pause');
  assert.deepEqual(visibleScreens(), ['binder']);
  assert.equal(A.binderMode, 'pause');

  A.togglePause();
  assert.equal(A.STATE, 'play');
  assert.deepEqual(visibleScreens(), []);
});

test('binder rejects unknown mode without changing presentation', () => {
  A.openBinder('shift', 'order');
  assert.throws(() => A.openBinder('unknown'), {
    name: 'RangeError',
    message: 'Unknown binder mode: unknown',
  });
  assert.equal(A.binderMode, 'shift');
  assert.equal(els['screen-binder'].dataset.binderMode, 'shift');
});
