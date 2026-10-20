import test from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fakeAudioContext } from '../helpers/stubs.js';
import { softAssert } from '../helpers/soft-assert.js';
import { readCss, readHtml, readSrc } from '../helpers/src-text.js';
import { loadGame } from '../helpers/harness.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const { A, G, els, calls, store, press } = await loadGame();
const seededRNG = A.mulberry32(0xC0FFEE);
const moveEnt = A.moveEnt;
const blocked = A.blocked;
const keys = A.keys;
const emitNoise = A.emitNoise;
const buildFloor = A.buildFloor;
const update = A.update;
const render = A.render;

/* ============ TEST 24: the HUD boiler panel

   The HUD is the one part of this game that is pure presentation, which makes
   it the one part with nothing stopping a later pass from quietly undoing it.
   Style regressions are exactly the kind that survive: the game still runs, the
   numbers are still correct, and nobody notices until someone squints.
*/
test('[24] the HUD boiler panel', () => {
  const t = softAssert();
console.log('[24] the HUD boiler panel');
{
  const html = readHtml();
  const css  = readCss();
  const hudHtml = html.slice(html.indexOf('<div id="hud">'), html.indexOf('<!-- ============ SCREENS'));

  /* --- the plate, and only the plate --------------------------------- */
  t.assert(/class="hud-plate"/.test(hudHtml), 'the HUD has no .hud-plate');
  t.assert(!/hud-side/.test(hudHtml),
    'the old sidebar column is still wired up — the panel is a header, not a column');
  t.assert(!/class="stat/.test(hudHtml),
    'the old stat rows are still wired up — the panel has its own instruments');

  /* --- a header strip ----------------------------------- */
  const hudRule = css.match(/#hud\s*\{([^}]*)\}/);
  t.assert(hudRule, 'no #hud rule');
  t.assert(/--hud-h/.test(hudRule[1]), '#hud has no height — a header needs one');
  t.assert(/z-index/.test(hudRule[1]),
    '#hud has no stacking level — anything painted later covers it silently');
  t.assert(/pointer-events\s*:\s*none/.test(hudRule[1]),
    '#hud swallows clicks — the game underneath must still be playable');
  t.assert(/justify-content\s*:\s*center/.test(hudRule[1]),
    'the plate is not centred in the strip — it should sit over the middle of the map');

  const inset = ((hudRule[1].match(/inset\s*:\s*([^;]+)/)||[])[1]||'').trim().replace(/\s+/g,' ');
  t.assert(/^0.5rem\s+0\s+auto\s+0$/.test(inset),
    `#hud is not pinned to the top edge (inset: ${inset}) — the panel is a header`);

  /* --- and the play area starts BELOW it ------------------------------
     The canvas sizes the camera, the ambient bake and the visibility mask to
     itself, so a panel painted over it renders a lit, scoped, masked strip of
     the world the player never sees, on the side things approach from. The
     strip and the stage must agree on the same number. */
  const stageRule = css.match(/#stage\s*\{([^}]*)\}/);
  t.assert(stageRule, 'no #stage rule — the canvas has no play area to live in and is back under the panel');
  const stageTop  = ((stageRule[1].match(/top\s*:\s*([^;]+)/)||[])[1]||'').trim();
  t.assert(stageTop.includes('--hud-h'),
    '#stage does not start at --hud-h — the panel is painted over the map again');
  t.assert(/position\s*:\s*absolute/.test(stageRule[1]),
    '#stage is not absolutely positioned — it would sit in flow and the canvas below it would still span the window');
  t.assert(/--hud-h\s*:\s*\d+px/.test(css),
    '--hud-h is not defined — the strip and the stage have nothing to agree on');

  /* --- the five readouts, and nothing else ---------------------------- */
  for (const need of ['hud-scope','val-clock','bar-batt','val-lives','val-lamps','val-pipes']){
    t.assert(hudHtml.includes(`id="${need}"`), `the panel is missing #${need}`);
  }
  /* The scope is a live trace, so it has to be a canvas of its own: a bar
     cannot be redrawn as a wave. */
  t.assert(/<canvas id="hud-scope"/.test(hudHtml),
    'the scope is not a canvas — a live trace needs somewhere to be drawn');
  t.assert(/id="val-flood"|id="bar-flood"|id="val-depth"|id="val-leak"/.test(hudHtml) === false,
    'the panel still carries a flood, level or door readout — the water is on the floor and the door is on the prompt line');

  /* --- the panel is brass, and the scope sits in it ------------------- */
  t.assert(/\.hud-plate\s*\{[^}]*linear-gradient\(180deg,#b3a550/.test(css),
    'the plate is not brass');
  t.assert(/#hud-scope\s*\{[^}]*width/.test(css), 'the scope canvas has no size');
  t.assert(/\.hud-plate\s+\.lamps|\.hud-plate/.test(css) && /class="lamps" id="val-lamps"/.test(hudHtml),
    'the leak lamps are not inside the plate');

  /* --- labels above their instruments -------------------------------- */
  const gaugeRule = css.match(/\.gauge\s*\{([^}]*)\}/);
  t.assert(gaugeRule, 'no .gauge rule');
  t.assert(/flex-direction\s*:\s*column/.test(gaugeRule[1]),
    '.gauge is not a column — labels and instruments are beside each other');
  t.assert(/align-items\s*:\s*center/.test(gaugeRule[1]),
    '.gauge does not centre its instruments — the eye cannot scan the plate');

  /* --- type floors ---------------------------------------------------
     The parser has to be a little more forgiving than `font-size:NNpx`.
     rem/em are resolved against a 16px root, which is the browser default
     and nothing in this sheet overrides html's font-size. */
  const px = (sel)=>{
    const m = css.match(new RegExp('(^|\\})\\s*'+sel.replace(/[.#]/g,'\\$&')+'\\s*\\{([^}]*)\\}','m'));
    if (!m) return NaN;
    const s = m[2].match(/font-size\s*:\s*([\d.]+)\s*(px|rem|em)/);
    if (!s) return NaN;
    return s[2]==='px' ? Number(s[1]) : Number(s[1])*16;
  };
  t.assert(px('#hud .lbl')>=9, `labels are ${px('#hud .lbl')}px — the floor is 9`);
  t.assert(px('#hud .val')>=12, `values are ${px('#hud .val')}px — the floor is 12`);
  t.assert(px('#hud .val.nixie')>=18, `the clock is ${px('#hud .val.nixie')}px — it can end a level by itself, it should be the biggest thing`);
  t.assert(px('#hud .val.nixie')>px('#hud .val'),
    'the clock is not larger than an ordinary value — the hierarchy is inverted');

  /* --- the clock changes colour, never size --------------------------
     And the class that says "critical" goes on the WRAPPER, because that is
     where the HUD writes it. The old sheet put the rule on the number and
     the flag on the wrapper, so the critical blink never once fired. */
  const clockRule = css.match(/#hud \.val\.nixie\s*\{([^}]*)\}/);
  t.assert(clockRule && !/animation/.test(clockRule[1]),
    'the clock itself animates — a resizing number reflows its own box once a second');
  t.assert(/#clock\.low\s+\.nixie\s*\{[^}]*color/.test(css), 'the clock does not change colour when it is low');
  t.assert(/#clock\.critical\s+\.nixie\s*\{[^}]*animation/.test(css),
    'the clock does not blink when it is critical — the flag goes on the wrapper, so the rule has to be on the wrapper too');

  /* --- one meaning per colour ---------------------------------------- */
  /* The open-pipe lamp is the only red thing on the panel, and a sealed one
     is the only green one. A lamp that is neither says nothing. */
  t.assert(/#hud \.lamps \.lamp\.sealed\s*\{[^}]*#8fd07a/i.test(css),
    'a sealed pipe is not a green lamp');
  t.assert(/#hud \.lamps \.lamp\.open\s*\{[^}]*#d8503c/i.test(css),
    'an open pipe is not a red lamp');
  t.assert(/#hud \.trough i\.low\s*\{[^}]*#d8503c/i.test(css),
    'a low battery does not turn red');

  /* --- the LOUD threshold is a constant, not a number in a stylesheet -- */
  const scopeSrc = fs.readFileSync(new URL('../../src/render/hud-scope.js', import.meta.url), 'utf8');
  t.assert(/import\s*\{[^}]*LOUD[^}]*\}\s*from\s*'\.\.\/config\/constants\.js'/.test(scopeSrc),
    'the scope does not import LOUD — the threshold is a contract, not a drawing');
  t.assert(/import\s*\{[^}]*NOISE_FS[^}]*\}\s*from\s*'\.\.\/config\/constants\.js'/.test(scopeSrc),
    'the scope does not import NOISE_FS — the scale is a contract too');

  /* --- short windows: the strip and the plate shrink together -------- */
  t.assert(/max-height\s*:\s*700px/.test(css) && /max-height\s*:\s*560px/.test(css),
    'the panel does not respond to short windows — it is the one HUD shape whose cost grows as the window shrinks');
  const shortRule = css.match(/@media\s*\(max-height:700px\)\{([\s\S]*?)\n\}/);
  t.assert(shortRule && /--hud-h/.test(shortRule[1]),
    'the strip does not shrink on a short window');

  /* --- reduced motion: the blink and the flicker are decoration -------- */
  const rm = css.slice(css.indexOf('prefers-reduced-motion'));
  t.assert(rm.length > 0, 'no reduced-motion block');
  t.assert(/#clock\.critical\s+\.nixie\{[^}]*animation:none/.test(rm),
    'the clock keeps blinking under reduced motion');
  t.assert(/#hud \.lamps \.lamp\.open\{[^}]*animation:none/.test(rm),
    'the open-pipe lamps keep flickering under reduced motion');

  console.log(`  one plate, five readouts; clock ${px('#hud .val.nixie')}px, `+
    `values ${px('#hud .val')}px, labels ${px('#hud .lbl')}px, `+
    `a ${(/--hud-h:\s*(\d+)px/.exec(css)||[])[1]}px strip above the play area`);
}
  t.done();
});
