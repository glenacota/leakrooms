/* The handheld gate.

   A handheld plays with the touch layer when Pointer Events exist and its primary
   pointer is coarse; any other handheld is stopped at the door with the notice,
   and a machine with a keyboard is never stopped. The detection has two halves (a
   user agent that names a handheld, and a primary pointer that is coarse with no
   fine pointer beside it), asserted on their own terms. The headless harness,
   which has neither navigator nor matchMedia, is not mistaken for a phone. */
import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';
import { readHtml, readSrc } from '../helpers/src-text.js';
import {
  looksHandheld, coarseWithoutFine, gateVerdict, mobileVerdict,
  isMobileBlocked, showMobileNotice,
} from '../../src/ui/mobile.js';

/* The harness is a desktop: no matchMedia and a Node user agent. It must boot
   into the riser, or the whole suite would be testing a card instead of a game. */
const { A, els } = await loadGame();

test('the handheld notice swaps in, and cannot be walked past', () => {
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

const PHONE = 'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 Mobile Safari/537.36';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

test('the gate: a handheld plays when the touch layer can work, otherwise it is stopped', () => {
  const t = softAssert();
  // ua, PointerEvent, coarse, fine
  t.assert(gateVerdict(PHONE, true, true, false) === 'touch', 'a phone with PointerEvent and a coarse pointer was not let in');
  t.assert(gateVerdict(PHONE, false, true, false) === 'blocked', 'a phone WITHOUT PointerEvent was let in');
  t.assert(gateVerdict(PHONE, true, false, false) === 'blocked', 'a handheld with no coarse pointer was let in');
  t.assert(gateVerdict(IPAD_AS_MAC, true, true, false) === 'touch', 'an iPad that sends a desktop user agent was not let in');
  t.assert(gateVerdict(IPAD_AS_MAC, false, true, false) === 'blocked', 'an iPad without PointerEvent was let in');
  for (const [ua, pe, coarse, fine] of [
    [DESKTOP, true, false, true],      // a desktop
    [DESKTOP, false, false, true],     // an old desktop browser: still not a handheld
    [DESKTOP, true, true, true],       // a touchscreen laptop
    [IPAD_AS_MAC, true, true, true],   // a tablet with a mouse or trackpad
    ['', false, false, false],         // headless
    [undefined, undefined, undefined, undefined],
  ]){
    t.assert(gateVerdict(ua, pe, coarse, fine) === 'desktop',
      `a machine with a keyboard was gated: ${String(ua).slice(0, 30)} pe=${pe} coarse=${coarse} fine=${fine}`);
  }
  t.assert(mobileVerdict() === 'desktop', 'the headless harness was gated');

  // boot acts on the verdict: blocked shows the notice, touch sets the mode
  const boot = readSrc();
  t.assert(/verdict === 'blocked'\) showMobileNotice\(\)/.test(boot), 'boot does not show the notice for a blocked verdict');
  t.assert(/verdict === 'touch'\) emit\('input:mode', 'touch'\)/.test(boot), 'boot does not set touch mode for a touch verdict');
  t.done();
});

test('the notice copy no longer says desktop-only', () => {
  const t = softAssert();
  const html = readHtml();
  const card = html.slice(html.indexOf('id="screen-mobile"'), html.indexOf('id="rotate"'));
  t.assert(!/DESKTOP ONLY/i.test(card), 'the notice still says DESKTOP ONLY');
  t.assert(!/NO TOUCH INPUT/i.test(card), 'the notice still says there is no touch input');
  t.assert(/TOUCH/.test(card) && /POINTER/.test(card), 'the notice does not say what the device is missing');
  t.assert(!/DESKTOP ONLY/i.test(html), 'DESKTOP ONLY is still somewhere in the markup');
  t.done();
});
