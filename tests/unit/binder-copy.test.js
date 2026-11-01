import test from 'node:test';
import assert from 'node:assert/strict';
import { readHtml } from '../helpers/src-text.js';
import { loadGame } from '../helpers/harness.js';

const { A } = await loadGame();

/* The words the player reads, with tags, comments, scripts and attributes
   removed. */
function visibleText(html){
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/g, ' ');
}

const html = readHtml();
const manualAt = html.indexOf('data-binder-page="manual"');
const manualEnd = html.indexOf('data-binder-page="settings"');

test('[COPY] player copy uses the glossary terms: floor, terms, seal', () => {
  const outside = visibleText(html.slice(0, manualAt) + html.slice(manualEnd));
  for (const [re, why] of [
    [/\blevels?\b/i, '"level" is a code word: the player says "floor"'],
    [/\bdifficulty\b/i, '"difficulty" is a code word: the player says "terms"'],
    [/\bfix(es|ing)?\b/i, 'a leak is sealed, not fixed'],
  ]){
    const m = outside.match(re);
    assert.ok(!m, `index.html says "${m && m[0]}" — ${why}`);
  }
});

test('[COPY] how-to-play lives in the field manual and not in the story pages', () => {
  const manual = visibleText(html.slice(manualAt, manualEnd));
  assert.ok(/WASD/.test(manual), 'the field manual does not list the movement keys');
  const story = html.slice(html.indexOf('data-binder-page="order"'), html.indexOf('data-binder-page="run"'));
  assert.ok(!/<b>\s*(WASD|SHIFT|ESC|R|M)\b/.test(story) && !/\bWASD\b/.test(visibleText(story)),
    'the work order lists keys — controls belong to the field manual');
  const title = visibleText(html.slice(html.indexOf('id="screen-splash"'), html.indexOf('id="screen-binder"')));
  assert.ok(!/WASD/.test(title), 'the title lists the movement keys');
});

test('[COPY] the first CLOCK IN opens the manual, later ones the work order, and BEGIN is never blocked', () => {
  A.setManualSeen(false);
  A.STATE = 'splash'; A.show('splash'); A.selectMenu('clock-in');
  A.activateMenu();
  assert.equal(A.STATE, 'binder');
  assert.equal(A.binderTab, 'manual');
  A.beginShift();
  assert.equal(A.STATE, 'play');
  assert.equal(A.manualSeen(), true, 'starting a shift did not mark the manual as seen');

  A.STATE = 'splash'; A.show('splash'); A.selectMenu('clock-in');
  A.activateMenu();
  assert.equal(A.binderTab, 'order');

  A.STATE = 'splash'; A.show('splash'); A.selectMenu('settings');
  A.activateMenu();
  assert.equal(A.binderTab, 'settings');
  A.STATE = 'play'; A.hideAll();
});
