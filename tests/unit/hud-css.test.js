import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fakeAudioContext } from '../helpers/stubs.js';
import { softAssert } from '../helpers/soft-assert.js';
import { readCss, readHtml, readSrc } from '../helpers/src-text.js';
import { loadGame } from '../helpers/harness.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const { A, G, els, calls, store, press } = await loadGame();
const buildFloor = A.buildFloor;


/* ============ TEST 24: the HUD — one glass panel in the corner

   The HUD is the one part of this game that is pure presentation, which makes
   it the one part with nothing stopping a later pass from quietly undoing it.
   Style regressions are exactly the kind that survive: the game still runs, the
   numbers are still correct, and nobody notices until someone squints.
*/
test('[24] the HUD — one glass panel in the corner, and it reserves nothing', () => {
  const t = softAssert();
  console.log('[24] the HUD — one glass panel in the corner, and it reserves nothing');
{
  const html = readHtml();
  const css  = readCss();
  const src  = readSrc();
  const hudHtml = html.slice(html.indexOf('<div id="hud">'), html.indexOf('<!-- ============ SCREENS'));

  /* --- one panel in one corner, and no column ----------------------- */
  t.assert(!/hud-side/.test(hudHtml) && !/\.hud-side/.test(css),
    'the sidebar column is back — it gave the window 180 pixels and the map a wall');
  const panels = (hudHtml.match(/class="crt /g)||[]).length;
  t.assert(panels===1, `expected 1 instrument panel, found ${panels}`);
  t.assert(/class="crt crt-tl"/.test(hudHtml), 'there is no top-left panel');
  t.assert(!/crt-tr/.test(hudHtml) && !/\.crt-tr/.test(css),
    'the top-right panel is back — every reading belongs in the one panel');

  /* The panel is pinned to its corner. A panel that is only "somewhere
     at the top" drifts when the markup is edited, and a drifted panel is
     a panel that eventually sits on the player. */
  const tl = css.match(/\.crt-tl\s*\{([^}]*)\}/);
  t.assert(tl && /\btop\s*:/.test(tl[1]) && /\bleft\s*:/.test(tl[1]),
    'the panel is not anchored to the top left');

  /* --- and the panel takes NO width ----------------------------------
     The overlay spans the frame and the stage starts at the left edge, so
     the map is the whole window. The old --side-w variable is the thing that
     used to take the space, and it is gone from every sheet. */
  const hudRule = css.match(/#hud\s*\{([^}]*)\}/);
  t.assert(hudRule, 'no #hud rule');
  t.assert(/inset\s*:\s*0/.test(hudRule[1]),
    '#hud is not spread over the frame — the panel cannot reach the corner');
  t.assert(/z-index/.test(hudRule[1]),
    '#hud has no stacking level — anything painted later covers it silently');
  t.assert(/pointer-events\s*:\s*none/.test(hudRule[1]),
    '#hud swallows clicks — the game underneath must still be playable');

  const stageRule = css.match(/#stage\s*\{([^}]*)\}/);
  t.assert(stageRule, 'no #stage rule — the canvas has no play area to live in');
  const stageLeft = ((stageRule[1].match(/left\s*:\s*([^;]+)/)||[])[1]||'').trim();
  t.assert(/^0$/.test(stageLeft),
    `#stage starts at ${stageLeft} — the panel is supposed to reserve no width at all`);
  t.assert(/position\s*:\s*absolute/.test(stageRule[1]),
    '#stage is not absolutely positioned — it would sit in flow and the canvas below it would still span the window');
  t.assert(!/--side-w/.test(css),
    'a sidebar width variable is still in the stylesheets — the panel does not need one');

  /* --- and the canvas is INSIDE the stage ----------------------------
     A stage that does not contain the canvas, or a canvas left on the window
     root, puts the map back under the frame one level up. */
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

  /* --- the readouts, and only the readouts ---------------------------
     The panel can only carry so much. So the set of labels is the contract:
     lives, leaks, noise and radar power. Anything else has to be argued
     for.

     A label can be more than one word, so the parser takes a run of
     capitals and spaces. A class of capitals alone stops at the first
     space and then fails on the tag, which reads as a missing label
     rather than as a label with a space in it. */
  const labels = (hudHtml.match(/class="crt-lbl[^"]*">([A-Z][A-Z ]*)</g)||[]).map(s => s.replace(/.*>/,'').replace(/<.*/,''));
  t.assert(JSON.stringify(labels)===JSON.stringify(['NOISE','RADAR','LIVES','LEAKS']),
    `the HUD shows ${JSON.stringify(labels)}, expected NOISE/RADAR/LIVES/LEAKS`);

  for (const gone of ['val-flood','bar-flood','val-leak']){
    t.assert(!hudHtml.includes(gone), `the HUD still carries #${gone}`);
  }
  t.assert(!/>FLOOD</.test(hudHtml), 'the HUD still shows a flood reading');
  t.assert(!/>DOOR</.test(hudHtml), 'the HUD still shows a door reading');
  t.assert(!/\.bar\.flood/.test(css), 'the flood bar is still in the stylesheet');
  t.assert(!/#val-leak/.test(css), 'the door readout is still in the stylesheet');

  /* The clock is the one number that can end a level on its own, so it has to
     come from the run's own formatter. Whether it carries a T- prefix is a
     look and not a contract, and the test does not pin one. */
  t.assert(/clockText\(G\.clock\)/.test(src),
    "the clock is not written from the run's own clockText");

  /* --- bars on the continuous readings, and ONLY those --------------
     Over-collecting is a real failure here, not pedantry: a bar under a count
     is actively misleading, because a half-full gradient next to "2/4" invites
     you to read the gradient as the number. */
  const barRows = hudHtml.split('<div class="crt-row"').slice(1).filter(s => s.includes('class="bar'));
  const barLabels = barRows.map(s => (s.match(/class="crt-lbl[^"]*">([A-Z][A-Z ]*)</)||[])[1]).sort();
  /* The labels are a set, so the expectation is sorted too and the assertion
     does not depend on which of them happens to come first alphabetically. */
  t.assert(JSON.stringify(barLabels)===JSON.stringify(['NOISE','RADAR'].sort()),
    `bars are on ${JSON.stringify(barLabels)}, expected NOISE/RADAR only`);
  t.assert((hudHtml.match(/class="bar/g)||[]).length===2,
    'there are more bars than the two continuous readings');

  /* --- the battery --------------------------------------------------- */
  t.assert(/class="bar batt"[^>]*id="bar-batt"/.test(hudHtml),
    'the radar power gauge is not a .batt battery');
  const shell = css.match(/\.bar\.batt\s*\{([^}]*)\}/);
  t.assert(shell, 'no .bar.batt rule — the gauge has no battery shell');
  t.assert(/border\s*:/.test(shell[1]), 'the battery has no shell outline');
  t.assert(/border-radius\s*:/.test(shell[1]), 'the battery shell has square corners');
  t.assert(/overflow\s*:\s*visible/.test(shell[1]),
    'the battery shell clips the terminal that sticks out of it');
  const terminal = css.match(/\.bar\.batt::after\s*\{([^}]*)\}/);
  t.assert(terminal, 'the battery has no terminal — a battery without a terminal is a box');
  t.assert(/right\s*:/.test(terminal[1]), 'the terminal is not on the right end');
  t.assert(/\.bar\.batt span\s*\{/.test(css), 'the battery has no cells');
  t.assert(/\.bar\.batt span\.lit\s*\{/.test(css), 'the battery has no lit cell');
  /* Low charge is a warning, and the warning colour in this HUD is red. */
  const lowBatt = css.match(/\.bar\.batt\.hot span\.lit\s*\{([^}]*)\}/);
  t.assert(lowBatt && /--danger|#d8503c|#ff8f6b/i.test(lowBatt[1]),
    'the battery does not turn red when it is low');
  t.assert(/BATT_LOW/.test(src), 'the battery has no low-charge threshold');

  /* --- the pipe marks ----------------------------------------------
     One mark per pipe, in the order the floor put them, so a mark never
     moves once it is on screen. It is a mark and not a bar: a bar under a
     count invites reading the gradient as the number. */
  t.assert(/class="crt-pipes"[^>]*id="val-pipes"/.test(hudHtml),
    'the pipe row is not a .crt-pipes container');
  t.assert(!/class="[^"]*\bbar\b[^"]*"[^>]*id="val-pipes"/.test(hudHtml),
    'the pipe row is a bar — a bar under a count invites reading the gradient as the number');

  /* Lives and pipes share the row, so the panel is a row shorter. */
  const livesRow = hudHtml.split('<div class="crt-row"').slice(1)
    .find(s => s.includes('id="val-lives"'));
  t.assert(livesRow && livesRow.includes('id="val-pipes"'),
    'lives and the pipe marks are not on the same row');

  /* The open mark is water and the loud thing on the row; the sealed one is
     hollow, so a filled mark can never be mistaken for an open one. */
  const openPip = css.match(/\.crt-pipes span\.open\s*\{([^}]*)\}/);
  t.assert(openPip && /#8fc4cc|#3c5a60/i.test(openPip[1]),
    "the open pipe mark is not water blue — blue is the water's colour, full stop");
  const donePip = css.match(/\.crt-pipes span\.done\s*\{([^}]*)\}/);
  t.assert(donePip && /background\s*:\s*transparent/.test(donePip[1]),
    'the sealed pipe mark is not hollow — a filled mark reads as still open');
  t.assert(donePip && /border\s*:/.test(donePip[1]),
    'the sealed pipe mark has no outline — a hole with no edge is nothing');

  /* The row DRAINS: the open pipes pack to the left and the sealed ones sit
     hollow on the right, so the lit run is the number still open. */
  buildFloor(3, 1234);                       // a four-pipe floor
  A.sealLeak(A.G.leaks[0]);
  A.updateHUD();
  const marks = els['val-pipes'].innerHTML.match(/class="(open|done)"/g) || [];
  t.assert(marks.length === A.G.pipes,
    `the pipe row has ${marks.length} marks for ${A.G.pipes} pipes`);
  t.assert(marks[0] === 'class="open"',
    'the first mark is not an open pipe — the row has to drain from the left');
  t.assert(marks[marks.length-1] === 'class="done"',
    'the last mark is not a sealed pipe — the row has to drain from the left');
  t.assert(marks.filter(m => m === 'class="open"').length === A.G.leaksOpen,
    'the row does not show one open mark for every open pipe');

  /* --- type floors ---------------------------------------------------
     The parser has to be a little more forgiving than `font-size:NNpx`.
     rem/em are resolved against a 16px root, which is the browser default and
     nothing in this sheet overrides html's font-size. */
  const px = (sel)=>{
    const m = css.match(new RegExp('(^|\\})\\s*'+sel.replace(/[.#]/g,'\\$&')+'\\s*\\{([^}]*)\\}','m'));
    if (!m) return NaN;
    const s = m[2].match(/font-size\s*:\s*([\d.]+)\s*(px|rem|em)/);
    if (!s) return NaN;
    return s[2]==='px' ? Number(s[1]) : Number(s[1])*16;
  };
  t.assert(px('.crt-lbl')>=10, `labels are ${px('.crt-lbl')}px — the floor is 10`);
  t.assert(px('.crt-val')>=12, `values are ${px('.crt-val')}px — the floor is 12`);
  t.assert(px('#val-clock')>=26, `the clock is ${px('#val-clock')}px — it can end a level by itself, it should be the biggest thing`);
  t.assert(px('#val-clock')>px('.crt-val'),
    'the clock is not larger than an ordinary value — the hierarchy is inverted');

  /* --- label contrast: not the floor of the palette ------------------ */
  t.assert(!/color\s*:\s*var\(--yellow-deep\)/.test(css.match(/\.crt-lbl\s*\{([^}]*)\}/)[1]),
    'labels are back to --yellow-deep, the darkest yellow in the palette');

  /* --- the panel is GLASS, and the type carries itself */
  const crtRule = css.match(/\.crt\s*\{([^}]*)\}/);
  t.assert(crtRule, 'no .crt rule — the panel has no type treatment');
  const shadow = (crtRule[1].match(/text-shadow\s*:\s*([^;]+)/)||[])[1];
  t.assert(shadow, 'the panel has no text-shadow — the type has no outline and will vanish over a lit carpet');
  const stops = shadow.split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
  t.assert(stops.length>=4,
    `the text outline is ${stops.length} stops — it needs a hard edge on all four sides plus a bloom`);
  const dark = (shadow.match(/#[0-9a-f]{6}/gi)||[]).some(h =>
    parseInt(h.slice(1,3),16)<0x30 && parseInt(h.slice(3,5),16)<0x30 && parseInt(h.slice(5,7),16)<0x30);
  t.assert(dark, 'the outline is not a near-black — over a lit carpet the type would have nothing to sit against');
  t.assert(/rgba\(\s*228\s*,\s*230\s*,\s*168/.test(shadow),
    'the bloom is not the palette yellow — the type has no glow to carry it in the dark');

  /* The glass is nearly clear. */
  const bg = (crtRule[1].match(/background\s*:\s*([^;]+)/)||[])[1] || '';
  const alphaOf = (v)=>{
    const m = v.match(/rgba\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(s => s.trim());
    if (p.length<4) return 1;
    return p[3].startsWith('.') ? parseFloat('0'+p[3]) : parseFloat(p[3]);
  };
  const alpha = alphaOf(bg);
  t.assert(alpha!==null, 'the panel background is not an rgba with an alpha — a solid panel hides the map');
  t.assert(alpha<0.6, `the panel is ${alpha} opaque — that is a plate, not glass`);

  /* The scanlines are the tube tell, and they sit BEHIND the type: a stripe
     across a number is a number you cannot read. */
  const before = css.match(/\.crt::before\s*\{([^}]*)\}/);
  t.assert(before && /repeating-linear-gradient/.test(before[1]),
    'the panel has no scanlines — it is a box, not a tube');
  const above = css.match(/\.crt\s*>\s*\*\s*\{([^}]*)\}/);
  t.assert(above && /z-index\s*:\s*1/.test(above[1]),
    'the content is not lifted above the scanlines — the type would be striped');

  /* --- one meaning per colour ----------------------------------------
     The LOUD hairline is the one mark on the bar that is red: it is the line
     the player is trying to stay under, and nothing else on the bar is a
     limit. Past it, only YOUR fill turns red, so red always means "this is
     about you". */
  const loud = css.match(/\.bar\.noise u\.loud\s*\{([^}]*)\}/);
  t.assert(loud && /--danger|#d8503c/i.test(loud[1]),
    'the LOUD hairline is not red — it is the one mark on the bar that is a limit');
  const hot = css.match(/\.bar\.noise\.hot i:not\(\.leak\)\s*\{([^}]*)\}/);
  t.assert(hot && /--danger|#d8503c/i.test(hot[1]),
    'the noise bar does not turn red past LOUD');
  const leak = css.match(/\.bar\.noise i\.leak\s*\{([^}]*)\}/);
  t.assert(leak && /#3c5a60|#8fc4cc/i.test(leak[1]),
    "the pipe-noise fill is not blue — blue is the water's colour, full stop");

  /* --- the clock changes colour, never size -------------------------- */
  const clockRule = css.match(/#val-clock\s*\{([^}]*)\}/);
  t.assert(clockRule && !/animation/.test(clockRule[1]),
    'the clock itself animates — a resizing number reflows its own box once a second');
  t.assert(/#clock\.low #val-clock\s*\{[^}]*color/.test(css), 'the clock does not change colour when it is low');

  /* The low and critical flags are set on the WRAPPER — src/ui/hud.js puts
     them on #clock, not on the number inside it — so both selectors have to
     descend from the wrapper. */
  t.assert(/#clock\.critical #val-clock\s*\{[^}]*animation/.test(css),
    'the clock does not blink in its last ten seconds — the critical rule does not match the wrapper it is set on');

  /* --- narrow windows: the panel still has to fit -------------------- */
  t.assert(/max-width\s*:\s*900px/.test(css) && /max-width\s*:\s*680px/.test(css),
    'the panel does not respond to narrow windows — it would grow off the screen');

  console.log(`  ${panels} glass panel, labels ${JSON.stringify(labels)}, `+
    `bars on ${barLabels.length} readouts; `+
    `labels ${px('.crt-lbl')}px, values ${px('.crt-val')}px, clock ${px('#val-clock')}px, over a full-window canvas`);
}
  t.done();
});
