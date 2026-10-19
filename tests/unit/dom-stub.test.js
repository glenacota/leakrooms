/* The DOM stub answers the queries the game makes — asserted against index.html,
   not against the stub's own idea of itself.

   Every other test that touches a control is downstream of this one: a stub that
   quietly answered `.seg[data-opt]` with an empty list would leave the wiring
   tests asserting nothing at all, and they would still be green. Three of those
   bugs existed in this file while it was being written — the segmented rows were
   rebuilt at runtime and invisible to a descendant query, a ref to a game-created
   element was rebuilt and lost its handler, and `data-pause-tab` parsed correctly
   and then answered undefined — and all three were silent. */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';
import { IDS, getElementById, querySelector, querySelectorAll, createElement } from '../helpers/dom.js';

/* The game boots first: the segmented rows are rebuilt during boot, and the
   descendant queries below are only interesting once they have been. */
await loadGame();

const byId = id => getElementById(id);

test('[37] the DOM stub resolves the markup it claims to', () => {
  /* Ids: every one the markup declares, and no element for an id it does not. */
  for (const id of ['game', 'hud', 'val-clock', 'bar-flood', 'screen-order',
                    'btn-start', 'btn-retry', 'terms-fold', 'set-master']){
    assert.ok(byId(id), `index.html declares #${id} and the stub has no element for it`);
  }

  /* The two HUD nodes the element table reaches for by shape, including the
     descendant one. */
  assert.ok(querySelector('.bar.noise'), '.bar.noise did not resolve');
  const loud = querySelector('.bar.noise u.loud');
  assert.ok(loud, '.bar.noise u.loud did not resolve');
  assert.equal(loud.classList.contains('loud'), true, 'the resolved node is not the loud mark');

  /* The five collection shapes, against the counts the markup declares:
     three segmented rows, four range inputs, two pause tabs, two pause pages. */
  assert.equal(querySelectorAll('.seg[data-opt]').length, 3, 'wrong number of segmented rows');
  assert.equal(querySelectorAll('input[type=range][data-opt]').length, 4, 'wrong number of range inputs');
  assert.equal(querySelectorAll('[data-pause-tab]').length, 2, 'wrong number of pause tabs');
  assert.equal(querySelectorAll('[data-pause-page]').length, 2, 'wrong number of pause pages');
  /* Ten since the fatal card shipped its RELOAD: the markup gained a button, so
     this count moved with it. */
  assert.equal(querySelectorAll('button').length, 10, 'wrong number of buttons');

  /* Attributes become dataset properties in camelCase — the direction that
     matters, since `data-pause-tab` is `dataset.pauseTab` and not the reverse. */
  assert.equal(byId('tab-pause-briefing').dataset.pauseTab, 'briefing');
  assert.equal(byId('set-master').dataset.opt, 'master');

  /* Initial class state comes from the markup: the briefing page ships hidden,
     the settings page does not. */
  const pages = querySelectorAll('[data-pause-page]');
  const hidden = pages.filter(p => p.classList.contains('hidden')).map(p => p.dataset.pausePage);
  assert.deepEqual(hidden, ['briefing'], `pages that ship hidden: [${hidden}]`);
});

test('[38] elements behave like elements', () => {
  /* classList and className are two views of one thing, or a test reading one
     and the game writing the other will disagree for ever. */
  const e = createElement('div');
  e.classList.add('hidden');
  assert.equal(e.className, 'hidden');
  e.className = 'a b';
  assert.equal(e.classList.contains('a') && e.classList.contains('b'), true);
  e.classList.toggle('b', false);
  assert.equal(e.classList.contains('b'), false);

  /* Attributes, for the aria state the ticket asserts on. */
  e.setAttribute('aria-selected', 'true');
  assert.equal(e.getAttribute('aria-selected'), 'true');
  assert.equal(e.hasAttribute('aria-selected'), true);

  /* Listeners are remembered and fire. */
  let seen = null;
  e.addEventListener('input', ev => { seen = ev; });
  assert.equal(e._has('input'), true, 'the listener was not remembered');
  e._fire('input', 42);
  assert.equal(seen, 42, 'the listener did not receive the dispatched value');

  /* Children appended at runtime are visible to a descendant query — the
     property the segmented-row rebuild depends on. */
  const row = byId('set-hue');
  assert.ok(row.childNodes.length > 0, 'the hue row has no buttons to find');
  assert.equal(row.querySelectorAll('button').length, row.childNodes.length,
    'a descendant query missed buttons the game appended');
  assert.ok(row.querySelectorAll('button')[0].textContent,
    'the button the query found has lost its label');

  /* And a ref to an element the game created is that element, handler and all —
     the bug that made a working row of buttons read as a dead one. */
  const first = row.querySelectorAll('button')[0];
  assert.equal(row.querySelectorAll('button')[0], first, 'two queries returned different elements');
  assert.equal(typeof first.onclick, 'function', 'the element the query returned lost its handler');

  /* closest, for the splash screen's "was that a control?" guard. */
  assert.equal(typeof byId('btn-start').closest('button'), 'object', 'closest missed its own button');
  assert.equal(byId('terms-fold').closest('button'), null, 'closest invented a button ancestor');

  /* An id the markup does not carry still gets an element: the suite asks for
     ids the game creates at runtime, and those must not start returning null. */
  const synthetic = document.getElementById('no-such-element-in-markup');
  assert.ok(synthetic, 'getElementById returned null for an unknown id');
});

test('[39] a selector the stub does not know answers empty, not wrong', () => {
  /* The stub supports the seven shapes the game uses and nothing else. Anything
     it cannot answer returns [] — the behaviour the harness had before this —
     so an unfamiliar selector degrades instead of breaking a boot. */
  for (const sel of ['.nope', '[data-nothing]', 'button.nope', '.bar.noise u.loud i',
                     'section > div', 'input[type=checkbox]']){
    assert.deepEqual(querySelectorAll(sel), [], `${sel} answered something`);
    assert.equal(querySelector(sel), null, `${sel} answered something`);
  }
  /* Including a composed selector: the game never uses one, and quietly
     answering part of it would be worse than answering none of it. */
  assert.deepEqual(querySelectorAll('.seg[data-opt=waterHue] button'), [],
    'a composed selector was answered from its first half');
});