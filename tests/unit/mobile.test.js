/* The desktop-only notice.

   LEAKROOMS has no touch input, so a phone must be stopped at the door rather
   than shown a title it cannot start. The check has two halves (a user agent
   that names a handheld, and a primary pointer that is coarse with no fine
   pointer beside it), and both are asserted on their own terms: a phone is
   stopped, a touchscreen laptop is not, and the headless harness — which has
   neither navigator nor matchMedia — is not mistaken for a phone. */
import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';
import { readHtml } from '../helpers/src-text.js';
import {
  looksHandheld, coarseWithoutFine, isMobileDevice,
  isMobileBlocked, showMobileNotice,
} from '../../src/ui/mobile.js';

/* The harness is a desktop: no matchMedia and a Node user agent. It must boot
   into the riser, or the whole suite would be testing a card instead of a game. */
const { A, els } = await loadGame();

test('the desktop-only notice stops a phone and not a laptop', () => {
  const t = softAssert();

  /* User agents: phones and tablets are caught, a desktop browser is not. */
  t.assert(looksHandheld('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'),
    'an iPhone user agent is not read as a handheld');
  t.assert(looksHandheld('Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 Mobile Safari/537.36'),
    'an Android phone user agent is not read as a handheld');
  t.assert(looksHandheld('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15'),
    'an iPad user agent is not read as a handheld');
  t.assert(looksHandheld('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Safari/537.36'),
    'an Android tablet user agent is not read as a handheld');
  t.assert(!looksHandheld('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'),
    'a desktop browser user agent is read as a handheld');

  /* Pointer: coarse-only is a phone, coarse-and-fine is a touchscreen laptop. */
  t.assert(coarseWithoutFine(true, false), 'a coarse-only pointer is not read as a handheld');
  t.assert(!coarseWithoutFine(true, true), 'a touchscreen laptop is read as a handheld — it has a mouse and a keyboard');
  t.assert(!coarseWithoutFine(false, true), 'a mouse-only machine is read as a handheld');
  t.assert(!coarseWithoutFine(false, false), 'no pointer is read as a handheld');

  /* The headless environment is a desktop, and the default check must agree. */
  t.assert(!isMobileDevice(), 'the headless harness was read as a phone — every test would boot into the notice');
  t.assert(!isMobileBlocked(), 'the notice is already blocking before it was shown');

  /* The card is a real screen, ships hidden, and can be brought up. */
  const html = readHtml();
  t.assert(/id="screen-mobile"/.test(html), 'index.html has no #screen-mobile');
  t.assert(/class="screen hidden"/.test(html.slice(html.indexOf('id="screen-mobile"'), html.indexOf('id="fatal"'))),
    'the desktop-only notice ships visible — it would cover the title');
  t.assert(A.SCREENS.includes('mobile'),
    `'mobile' is not in SCREENS, so show()/hideAll() will never reach it`);

  /* The swap: the notice comes up over the riser, and the keys stop. */
  A.STATE = 'splash';
  A.show('splash');
  t.assert(els['screen-mobile'].classList.contains('hidden'),
    'the notice was up before it was shown');
  showMobileNotice();
  t.assert(isMobileBlocked(), 'showMobileNotice did not report itself as blocking');
  t.assert(!els['screen-mobile'].classList.contains('hidden'), 'the notice did not come up');
  t.assert(els['screen-splash'].classList.contains('hidden')
      && els['screen-order'].classList.contains('hidden'),
    'the notice came up without dismissing the screens behind it');

  /* A key that would otherwise walk the riser does nothing. */
  const keydown = global.window._h.keydown;
  t.assert(typeof keydown === 'function', 'no keydown handler was registered');
  const press = (key) => keydown({ key, repeat:false, metaKey:false, ctrlKey:false,
                                   altKey:false, preventDefault(){} });
  press('Enter');
  t.assert(A.STATE === 'splash', `ENTER walked past the notice to '${A.STATE}' — the card is not terminal`);

  console.log('  a phone is stopped, a touchscreen laptop is not, and the notice cannot be walked past');
  t.done();
});
