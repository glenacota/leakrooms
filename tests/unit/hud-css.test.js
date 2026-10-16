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


/* ============ TEST 24: the sidebar HUD — one column, bars where bars fit

   The HUD is the one part of this game that is pure presentation, which makes
   it the one part with nothing stopping a later pass from quietly undoing it.
   Style regressions are exactly the kind that survive: the game still runs, the
   numbers are still correct, and nobody notices until someone squints.

*/
test('[24] the sidebar HUD — one column, bars where bars fit', () => {
  const t = softAssert();
console.log('[24] the sidebar HUD — one column, bars where bars fit');
{
  const html = readHtml();
  const css  = readCss();
  const hudHtml = html.slice(html.indexOf('<div id="hud">'), html.indexOf('<!-- ============ SCREENS'));

  /* --- one column, not two clusters --------------------------------- */
  t.assert(/class="hud-side"/.test(hudHtml), 'the HUD has no .hud-side column');
  t.assert(!/hud-left|hud-right/.test(hudHtml),
    'the two top-edge clusters are still wired up — every stat should share one column');
  t.assert((hudHtml.match(/class="stat/g)||[]).length === 8,
    `expected 8 stats in the column, found ${(hudHtml.match(/class="stat/g)||[]).length}`);
  /* Grouped by KIND: clock alone, the three gauges, the three states, lives. */
  t.assert((hudHtml.match(/class="hud-div"/g)||[]).length === 3,
    'the column is not divided into its four groups');

  /* --- the play area STARTS where the panel ends --------------------
     It used to be asserted the other way round: the test pinned the HUD to one
     window edge and forbade the canvas from reserving any width for it. That is
     the overlay, and the overlay is the bug — the canvas sizes the camera, the
     ambient bake and the visibility mask to itself, so a panel painted over it
     renders a lit, scoped, masked strip of the world the player never sees, on
     the side things approach from.

     What holds now is not an EDGE but a RELATIONSHIP: the canvas is boxed by
     #stage, and #stage is inset by the panel's width. Which side it sits on is
     still not asserted — a test that fails because the author changed his mind
     is a test reporting its own history. */
  const hudRule = css.match(/#hud\s*\{([^}]*)\}/);
  t.assert(hudRule, 'no #hud rule');
  t.assert(/--side-w/.test(hudRule[1]), '#hud has no width — a sidebar needs one');
  t.assert(/z-index/.test(hudRule[1]),
    '#hud has no stacking level — anything painted later covers it silently');
  t.assert(/pointer-events\s*:\s*none/.test(hudRule[1]),
    '#hud swallows clicks — the game underneath must still be playable');

  /* the column is pinned to ONE edge, and the stage is cut back by its width.
     The two must agree on the same number: if they disagree, the panel either
     covers the map again or leaves a dead strip of black beside it. */
  const inset = ((hudRule[1].match(/inset\s*:\s*([^;]+)/)||[])[1]||'').trim().replace(/\s+/g,' ');
  const onLeft  = /^0\s+auto\s+0\s+0$/.test(inset);
  const onRight = /^0\s+0\s+0\s+auto$/.test(inset);
  t.assert(onLeft || onRight,
    `#hud is not pinned to one edge full-height (inset: ${inset}) — a sidebar needs an edge to sit on and the full height`);

  const stageRule = css.match(/#stage\s*\{([^}]*)\}/);
  t.assert(stageRule, 'no #stage rule — the canvas has no play area to live in and is back under the panel');
  const stageLeft  = ((stageRule[1].match(/left\s*:\s*([^;]+)/)||[])[1]||'').trim();
  const stageRight = ((stageRule[1].match(/right\s*:\s*([^;]+)/)||[])[1]||'').trim();
  if (onLeft) t.assert(stageLeft.includes('--side-w'),
    '#stage does not start at --side-w — the panel is painted over the map again');
  else       t.assert(stageRight.includes('--side-w'),
    '#stage does not end at --side-w — the panel is painted over the map again');
  t.assert(/position\s*:\s*absolute/.test(stageRule[1]),
    '#stage is not absolutely positioned — it would sit in flow and the canvas below it would still span the window');

  /* --- and the canvas is INSIDE the stage ----------------------------
     A stage that does not contain the canvas, or a canvas left on the window
     root, puts the map back under the panel one level up. */
  t.assert(/<div id="stage">[\s\S]*?<canvas id="game">/.test(html),
    'the canvas is not inside #stage');
  t.assert(/#game\s*\{[^}]*inset\s*:\s*0/.test(css),
    '#game is not filling #stage — it is sized against the window instead');

  /* --- and the map-relative text is centred on the MAP --------------
     #prompt and #flashnote are positioned left:0; right:0. Outside #stage they
     centre on the window, which is a whole panel wider than the play area on
     the left — both would sit visibly off the player they are describing. */
  const stageEnd = html.indexOf('<!-- ============ SCREENS');
  const stage = html.slice(html.indexOf('<div id="stage">'), stageEnd);
  t.assert(stage.includes('id="prompt"'), '#prompt is not inside #stage — it centres on the window, not the map');
  t.assert(stage.includes('id="flashnote"'), '#flashnote is not inside #stage — it centres on the window, not the map');

  /* --- the plate presents itself to the PLAY area, not the bezel -----
     With the map no longer behind it the fade runs into the black edge of the
     tube rather than over live geometry, so it is a bezel treatment rather
     than a readability one — but it must still point at the play area, which
     is the side the player reads against. */
  const sideRule = css.match(/\.hud-side\s*\{([^}]*)\}/);
  t.assert(sideRule, 'no .hud-side rule');
  const wantDeg = onLeft ? '90deg' : '270deg';
  t.assert(new RegExp('linear-gradient\\(\\s*'+wantDeg).test(sideRule[1]),
    `.hud-side does not fade with ${wantDeg} — on the ${onLeft?'left':'right'} that means solid at the window edge and fading out over the play area`);

  /* --- bars on battery, noise and flood, and ONLY those three --------
     Over-collecting is a real failure here, not pedantry: a bar under a count
     is actively misleading, because a half-full gradient next to "2/4" invites
     you to read the gradient as the number. */
  const stats = hudHtml.split('<div class="stat').slice(1);
  const withBar = stats.filter(s => s.includes('class="bar'));
  const barLabels = withBar.map(s => (s.match(/class="lbl">([A-Z]+)/)||[])[1]).sort();
  t.assert(JSON.stringify(barLabels)===JSON.stringify(['BATTERY','FLOOD','NOISE']),
    `bars are on ${JSON.stringify(barLabels)}, expected BATTERY/FLOOD/NOISE only`);
  for (const need of ['bar-batt','bar-noise','bar-flood']){
    t.assert(hudHtml.includes(`id="${need}"`), `the HUD is missing #${need}`);
  }

  /* --- type floors ---------------------------------------------------
     The parser has to be a little more forgiving than `font-size:NNpx`.

     It used to require exactly that, and it reported NaN on both `font-size:1rem`
     and `font-size: 30px` — a space after the colon, which is legal CSS and which
     the very first thing it read here had. That produced three failures that all
     said "NaNpx" for two entirely different reasons and neither of which was a
     problem with the game. A test that cannot parse its input is not a test; it
     is a tripwire on the author's formatting habits. rem/em are resolved against
     a 16px root, which is the browser default and nothing in this sheet overrides
     html's font-size. */
  const px = (sel)=>{
    const m = css.match(new RegExp('(^|\\})\\s*'+sel.replace(/[.#]/g,'\\$&')+'\\s*\\{([^}]*)\\}','m'));
    if (!m) return NaN;
    const s = m[2].match(/font-size\s*:\s*([\d.]+)\s*(px|rem|em)/);
    if (!s) return NaN;
    return s[2]==='px' ? Number(s[1]) : Number(s[1])*16;
  };
  t.assert(px('.lbl')>=11, `labels are ${px('.lbl')}px — the floor is 11`);
  t.assert(px('.val')>=15, `values are ${px('.val')}px — the floor is 15`);
  t.assert(px('#val-clock')>=22, `the clock is ${px('#val-clock')}px — it can end a level by itself, it should be the biggest thing`);
  t.assert(px('#val-clock')>px('.val'),
    'the clock is not larger than an ordinary value — the hierarchy is inverted');
  /* Labels sit above their numbers. Sideways means the eye travels for every
     value and the column reads as a run-on sentence instead of a list. */
  t.assert(/flex-direction\s*:\s*column/.test(css.match(/\.stat\s*\{([^}]*)\}/)[1]),
    '.stat is not a column — labels and values are beside each other');

  /* --- label contrast: not the floor of the palette ------------------ */
  t.assert(!/color\s*:\s*var\(--yellow-deep\)/.test(css.match(/\.lbl\s*\{([^}]*)\}/)[1]),
    'labels are back to --yellow-deep, the darkest yellow in the palette');

  /* --- one meaning per colour ---------------------------------------- */
  const barFlood = css.match(/\.bar\.flood i\s*\{([^}]*)\}/);
  t.assert(barFlood && /#3c5a60|#8fc4cc/i.test(barFlood[1]),
    'the flood bar is not blue — blue is the water\'s colour, full stop');

  /* ...and the flood NUMBER is blue, which takes two things to be true at once
     and both of them were false for a while: the span has to carry `water`, and
     it has to also carry `val`. `.val.water` is a compound selector, so dropping
     `val` in favour of a `val-bar` modifier quietly un-blues the reading and
     leaves a yellow number sitting above a blue bar — which reads as two
     different things rather than one, and undoes the whole reason the colour
     exists. Assert the class list, not the intent. */
  const floodVal = hudHtml.match(/<span class="([^"]*)"[^>]*id="val-flood"/);
  t.assert(floodVal, 'the flood reading has no #val-flood');
  t.assert(/\bwater\b/.test(floodVal[1]),
    'the flood number lost its .water class — the bar is blue and the number is not');

  /* --- `val-bar` is a MODIFIER, never a replacement -------------------
     Every value in the HUD gets `.val`: that is where the colour and the
     tabular figures live. A span carrying `val-bar` WITHOUT `val` loses both,
     silently, and nothing in the stylesheet says so — the number just comes back
     the default foreground and starts sliding sideways as its digits change,
     while every other number in the column stays put. */
  t.assert(!/class="val-bar[ "]/.test(hudHtml),
    'a value span uses .val-bar without also carrying .val — it loses the colour and the tabular figures');
  for (const m of hudHtml.matchAll(/<span class="([^"]*)"[^>]*id="val-[a-z]+"/g)){
    t.assert(/\bval\b/.test(m[1]),
      `#${m[0].match(/id="([^"]*)"/)[1]} has no .val class — it is not being styled as a HUD value`);
  }
  const shut = css.match(/#val-leak\.shut\s*\{([^}]*)\}/);
  t.assert(shut && /--danger|#d8503c/i.test(shut[1]),
    'the door no longer shouts in red');
  /* ...and the good state is quiet. If OPEN were the red one, the single most
     important word in the HUD would be the loudest thing on screen, which is
     backwards: OPEN means every riser is sealed and you can leave.

     NOTE the lookbehind-ish guard. The selector must be BARE `#val-leak`, not
     `#val-leak.shut` or `#val-leak .foo` — a colour on a bare #val-leak is a
     colour on every state. Written carelessly this assertion is dead: an
     alternation like /#val-leak\.open|--val-leak\{/ splits at the `|` and the
     second branch looks for `--val-leak`, two hyphens, which no selector in
     this stylesheet will ever contain. */
  t.assert(!/(^|[^.\w#])#val-leak\s*\{[^}]*(?:--danger|#d8503c)/.test(css),
    'the door shouts in its GOOD state — only the state that is stopping you may shout');
  t.assert(/^#val-leak\.shut\s*\{/m.test(css),
    'the door has no .shut rule, so the state that is stopping you cannot shout at all');

  /* --- the clock changes colour, never size -------------------------- */
  const clockRule = css.match(/#val-clock\s*\{([^}]*)\}/);
  t.assert(!/animation/.test(clockRule[1]),
    'the clock itself animates — a resizing number reflows its own box once a second');
  t.assert(/#clock\.low #val-clock\s*\{[^}]*color/.test(css), 'the clock does not change colour when it is low');

  /* --- narrow windows: a permanent column costs play area, so it sheds -- */
  t.assert(/max-width\s*:\s*900px/.test(css) && /max-width\s*:\s*680px/.test(css),
    'the sidebar does not respond to narrow windows — it is the one HUD shape whose cost grows as the window shrinks');

  console.log(`  ${stats.length} stats in one column, bars on ${barLabels.length} of them; `+
    `labels ${px('.lbl')}px, values ${px('.val')}px, clock ${px('#val-clock')}px, overlaying a full-width canvas`);
}
  t.done();
});

