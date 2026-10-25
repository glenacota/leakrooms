import test from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { softAssert } from '../helpers/soft-assert.js';
import { readCss, readHtml, readSrc } from '../helpers/src-text.js';
import { loadGame } from '../helpers/harness.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const { A, G, els, calls, store, press } = await loadGame();
const render = A.render;


/* ============ TEST 20: settings ==========================================
   A settings screen is a place to quietly break the game, and the two ways
   that matter are specific:

   1. The store must never be able to stop the game booting. localStorage is
      absent in this harness before this change, throws on some file://
      origins, and can be disabled outright in private browsing. Every failure
      path has to return defaults.
   2. DIFFICULTY MUST NOT BE ABLE TO TOUCH THE NOISE TABLE. That table is the
      design contract — quiet noise only makes it curious — and a difficulty
      control that could push a walk above LOUD would let a player configure
      the stealth layer out of existence. This is asserted by comparing the
      noise constants across every preset, not by trusting the implementation. */
test('[20] settings — persistence, validation, and the difficulty contract', () => {
  const t = softAssert();
console.log('[20] settings — persistence, validation, and the difficulty contract');
{
  /* --- defaults are a complete, valid schema --- */
  {
    const S=A.SETTINGS_DEFAULTS, SC=A.SETTINGS_SCHEMA;
    for (const k of Object.keys(SC)){
      t.assert(Object.prototype.hasOwnProperty.call(S,k), `no default for ${k}`);
      t.assert(A.settingsValid(k, S[k]), `the default for ${k} (${JSON.stringify(S[k])}) is not a legal value`);
    }
    t.assert(Object.keys(S).length === Object.keys(SC).length,
      'the defaults and the schema disagree about how many fields there are');
    console.log(`  ${Object.keys(SC).length} settings, all with valid defaults`);
  }

  /* --- round trip --- */
  {
    global.__store.clear();
    A.resetSettings();
    A.setOption('difficulty','hard');
    A.setOption('waterContrast', 1.6);
    A.setOption('waterHue','grey');
    const raw = global.__store.get(A.SETTINGS_KEY);
    t.assert(raw, 'nothing was written to the store');
    /* resetSettings PERSISTS — it is the Reset button — so calling it here
       clobbers the blob we just saved. Snapshot it and put it back, which is
       exactly what a page reload does. The first version of this test called
       reset and then asserted the old values came back, which is a test of a
       Reset button, not of persistence. */
    A.resetSettings();
    t.assert(A.SETTINGS.difficulty==='normal', 'reset did not restore the default difficulty');
    global.__store.set(A.SETTINGS_KEY, raw);
    A.loadSettings();
    t.assert(A.SETTINGS.difficulty==='hard', 'difficulty did not survive the round trip');
    t.assert(A.SETTINGS.waterContrast===1.6, `waterContrast came back as ${A.SETTINGS.waterContrast}`);
    t.assert(A.SETTINGS.waterHue==='grey', 'waterHue did not survive');
    console.log('  every field survives a write / wipe / read cycle');
  }

  /* --- a corrupt blob degrades per field, not wholesale --- */
  {
    const bad  = { difficulty:'NONSENSE',        // not an enum member
                   master:'loud',                // wrong type
                   waterHue:'chartreuse',
                   waterContrast:-4,             // below the floor
                   muted:false };                // the one legal field
    global.__store.set(A.SETTINGS_KEY, JSON.stringify(bad));
    A.loadSettings();
    /* The one good field is taken... */
    t.assert(A.SETTINGS.muted===false && A.SETTINGS_DEFAULTS.muted===false, 'the legal field in a partly-corrupt blob was discarded');
    /* ...and every bad one falls back on its own, rather than the whole load
       being rejected because one value is nonsense. */
    t.assert(A.SETTINGS.difficulty==='normal', 'a bad enum was accepted');
    t.assert(A.SETTINGS.master===A.SETTINGS_DEFAULTS.master, 'a string was accepted for a range');
    t.assert(A.SETTINGS.waterHue==='slate', 'a bad hue was accepted');
    t.assert(A.SETTINGS.waterContrast===A.SETTINGS_DEFAULTS.waterContrast, 'a below-floor contrast was accepted');
    /* A blob written by an older build carries fields this build has no
       control for. They must be dropped, not resurrected: the whole point of
       removing a setting is that a stale store cannot put it back. */
    t.assert(!('vhs' in A.SETTINGS), 'a removed setting came back from a stale store');
    console.log('  a blob of nonsense keeps its one good field, rejects the rest, and drops removed fields');
  }

  /* --- unparseable, non-object, and absent all fall back --- */
  {
    for (const junk of ['not json at all', '[1,2,3]', 'null', '"a string"', '42']){
      global.__store.set(A.SETTINGS_KEY, junk);
      A.loadSettings();
      t.assert(A.SETTINGS.difficulty==='normal' && A.SETTINGS.master===A.SETTINGS_DEFAULTS.master,
        `a ${junk} blob did not fall back to defaults`);
    }
    global.__store.clear();
    A.loadSettings();
    t.assert(A.SETTINGS.difficulty==='normal', 'an absent store did not fall back to defaults');
    /* loadSettings must be a total function of the blob, not of call order —
       a field ABSENT from a valid blob falls back rather than keeping whatever
       was live. This is the regression the "load over defaults" fix prevents.
       ORDER MATTERS: setOption persists, so the partial blob has to be written
       AFTER it, or setting an option overwrites the very blob under test. */
    A.setOption('difficulty','hard');
    t.assert(A.SETTINGS.difficulty==='hard', 'setOption did not take effect');
    global.__store.set(A.SETTINGS_KEY, JSON.stringify({master:0.4}));
    A.loadSettings();
    t.assert(A.SETTINGS.difficulty==='normal',
      'loading a partial blob kept the live difficulty — the result depends on call order');
    t.assert(A.SETTINGS.master===0.4, 'the one present field was not applied');
    console.log('  unparseable, non-object, and absent blobs fall back; a partial blob is a total reset plus its own fields');
  }

  /* --- a store that throws must not stop the game ---
     This is the one that matters in production: Safari in private mode throws
     on setItem, and a settings screen that throws during boot takes the whole
     game with it. */
  {
    const real = global.localStorage;
    global.localStorage = {
      getItem(){ throw new Error('SecurityError'); },
      setItem(){ throw new Error('QuotaExceededError'); },
    };
    let threw=false;
    try { A.resetSettings(); A.loadSettings(); A.saveSettings(); }
    catch(e){ threw=true; }
    global.localStorage = real;
    t.assert(!threw, 'a throwing localStorage propagated out of the settings code — it would take the boot with it');
    t.assert(A.SETTINGS.difficulty==='normal', 'a throwing store left the game in a broken settings state');
    console.log('  a localStorage that throws is survivable at every entry point');
  }

  /* --- THE CONTRACT: no preset touches the noise table --- */
  {
    const noiseBefore = { ...A.NOISE };
    const leakBefore = { base:A.LEAK_NOISE_BASE, gain:A.LEAK_NOISE_GAIN };
    const seen = [];
    for (const k of Object.keys(A.DIFFICULTIES)){
      A.setOption('difficulty', k);
      seen.push({ k, levels:A.FLOORS, clock:A.FLOOR_CLOCK, lives:A.DIFFICULTIES[k].lives,
                  repair:A.REPAIR_TIME, hunt:A.HUNT_BASE, step:A.HUNT_STEP });
      for (const key of Object.keys(noiseBefore))
        t.assert(A.NOISE[key]===noiseBefore[key],
          `preset ${k} changed NOISE.${key} — a difficulty must not reach the noise contract`);
      t.assert(A.LEAK_NOISE_BASE===leakBefore.base,
        `preset ${k} changed the leak's base noise`);
      t.assert(A.LEAK_NOISE_GAIN===leakBefore.gain,
        `preset ${k} changed the leak's noise gain`);
      /* The five levels are the run. A preset that trimmed one made the game
         have a different number of endings depending on the menu, so every
         preset plays all five and only the pressure around them moves. */
      t.assert(A.FLOORS===A.LEVELS_N,
        `preset ${k} plays ${A.FLOORS} levels — the five-level run is not a setting`);
    }
    /* and the ordering that makes the stealth layer work still holds */
    t.assert(A.LEAK_NOISE_BASE + A.LEAK_NOISE_GAIN < A.NOISE.LOUD,
      'the leak can cross LOUD under some preset — the lure becomes a hunt trigger');
    t.assert(A.LEAK_NOISE_BASE < A.NOISE.WADE, 'wading is no longer quieter than a wet step');
    t.assert(A.NOISE.REPAIR >= A.NOISE.LOUD, 'the repair is no longer the loud decision');
    t.assert(seen.length===3, `expected 3 difficulty presets, saw ${seen.length}`);
    for (const p of seen) t.assert(p.levels>=1 && p.lives>=1 && p.clock>0, `preset ${p.k} is degenerate`);
    console.log(`  3 presets move lives/clock/repair/chase only — noise table and level count untouched`);
    console.log(`    ${seen.map(p=>`${p.k}: ${p.lives} lives, ${p.levels} levels, ${p.clock}s clock, ${p.repair}s at the pipe, chase ${p.hunt}+${p.step}/level`).join('\n    ')}`);
    A.setOption('difficulty','normal');
  }

  /* --- difficulty reaches the game, not just the store --- */
  {
    A.setOption('difficulty','hard');
    t.assert(A.FLOOR_CLOCK===A.DIFFICULTIES.hard.clock, `the clock is ${A.FLOOR_CLOCK}s, want ${A.DIFFICULTIES.hard.clock}s`);
    t.assert(A.REPAIR_TIME===A.DIFFICULTIES.hard.repairTime, 'REPAIR_TIME did not follow the preset');
    A.setOption('difficulty','normal');
    t.assert(A.FLOORS===A.LEVELS_N && A.REPAIR_TIME===5 && A.FLOOR_CLOCK===180,
      'normal did not restore the documented tuning');
    console.log('  the preset actually reaches FLOOR_CLOCK and REPAIR_TIME');
  }
}
  t.done();
});
/* ============ TEST 27: the four removed settings are gone, and stay gone
   Settings that only had their widgets deleted would still be readable from a
   stale localStorage blob, still settable through the API, and still rendered
   by a branch nobody remembers writing. All four have to be absent from the
   schema, the store, the markup, and the renderer. */
test('[27] the removed settings — frame counter, flicker, tape, shake', () => {
  const t = softAssert();
console.log('[27] the removed settings — frame counter, flicker, tape, shake');
{
  const html = readHtml();
  const css  = readCss();
  const src  = readSrc();
  const GONE = ['showFps','flicker','vhs','shake'];

  for (const k of GONE){
    t.assert(!(k in A.SETTINGS_SCHEMA), `${k} is still in the schema`);
    t.assert(!(k in A.SETTINGS_DEFAULTS), `${k} is still a stored default`);
    t.assert(!(k in A.SETTINGS), `${k} is still live in the store`);
    t.assert(!html.includes(`data-opt="${k}"`), `index.html still renders a control for ${k}`);
    t.assert(!new RegExp(`SETTINGS\\.${k}\\b`).test(src), `game.js still reads SETTINGS.${k}`);
  }

  /* no control anywhere: the ids, the labels, the stylesheet rule */
  for (const id of ['set-fps','set-flicker','set-vhs','set-shake']){
    t.assert(!html.includes(id), `index.html still has #${id}`);
  }
  t.assert(!/FRAME COUNTER|FLUORESCENT FLICKER|TAPE DEGRADATION|CAMERA SHAKE/.test(html),
    'a removed setting still has a label on screen');
  t.assert(!/#fps\b/.test(css), 'the frame counter stylesheet rule survived');

  /* and the API refuses to set them, rather than silently growing SETTINGS */
  for (const k of GONE){
    t.assert(A.settingsValid(k, 1)===false, `${k} still validates`);
    t.assert(A.setOption(k, 1)===false, `setOption('${k}') was accepted`);
    t.assert(!(k in A.SETTINGS), `${k} appeared in the store after a set attempt`);
  }

  /* the effects themselves are still drawn — these were look, not preference,
     so removing the settings must not quietly remove the VHS pass */
  t.assert(/VHS_PASS\s*=\s*0\.7/.test(src), 'the VHS pass lost its constant');
  t.assert(/FLICKER_DEPTH\s*=\s*0\.65/.test(src), 'the flicker lost its constant');
  t.assert(/ctx\.fillStyle=scanPat/.test(src), 'the scanline pass is gone — the game no longer looks like a tape');
  t.assert(/if \(f\.flicker\)/.test(src), 'the tubes no longer stutter');
  render(1000);
  render(2000);
  console.log('  4 settings gone from schema, store, markup, stylesheet, and renderer');
  console.log('  and the effects they controlled are still on, as constants');
}
  t.done();
});


/* ---- RESET SETTINGS on the pause ticket keeps the terms ------------------
   The ticket's RESET button sits on the page of a run that was clocked in on a
   stamped set of terms, and the terms are stamped at the door for the whole
   shift. The reset used to clear them too, which rewrote the floor clock and
   the repair time of the floor the player was standing on — mid-run, from a
   button labelled with the word "settings". Asserted through the real button on
   the real ticket, because a store option nobody passes is a store option that
   does not exist. */
test('[28] resetting the settings from the ticket leaves the terms alone', () => {
  const t = softAssert();
console.log('[28] resetting the settings from the ticket leaves the terms alone');
{
  /* The run is on HARD terms, stamped. */
  A.setOption('difficulty', 'hard');
  A.STATE = 'pause';
  t.assert(A.SETTINGS.difficulty === 'hard' && A.REPAIR_TIME === A.DIFFICULTIES.hard.repairTime,
    `the run is not on hard terms to begin with (difficulty ${A.SETTINGS.difficulty}, repair ${A.REPAIR_TIME})`);

  /* Something on the ticket worth resetting, so the reset is not a no-op. */
  A.setOption('waterContrast', 1.6);
  els['btn-settings-reset'].click();

  t.assert(A.SETTINGS.difficulty === 'hard',
    `RESET SETTINGS on the ticket cleared the terms to '${A.SETTINGS.difficulty}' — the shift's terms are stamped at the door`);
  t.assert(A.REPAIR_TIME === A.DIFFICULTIES.hard.repairTime,
    `the repair time is ${A.REPAIR_TIME}s after the reset, want the hard terms' ${A.DIFFICULTIES.hard.repairTime}s`);
  t.assert(A.SETTINGS.waterContrast === A.SETTINGS_DEFAULTS.waterContrast,
    `water contrast is ${A.SETTINGS.waterContrast} after a reset — everything else still has to reset`);

  /* ...and the plain call is still a clean slate, because that is what it means
     everywhere else in the game. */
  A.resetSettings();
  t.assert(A.SETTINGS.difficulty === 'normal',
    `resetSettings() without keepTerms left the terms at '${A.SETTINGS.difficulty}' — the default path changed`);
  console.log('  ticket reset keeps HARD, plain reset is still a clean slate');
}
  t.done();
});

/* ============ the touch settings ==========================================
   Three enums that only show in touch mode. They go through the same store as
   everything else, so the same four promises apply: valid defaults, a round
   trip, an old save without them loads, and RESET puts them back. */
const TOUCH_KEYS = { touchHud: ['auto', 'always', 'minimal'], touchSide: ['left', 'right'], haptics: [true, false] };

test('[touch settings] defaults, validity and round trip', () => {
  const D = A.SETTINGS_DEFAULTS;
  assertEqual(D.touchHud, 'auto'); assertEqual(D.touchSide, 'left'); assertEqual(D.haptics, true);
  for (const [k, values] of Object.entries(TOUCH_KEYS)){
    for (const v of values) assertEqual(A.settingsValid(k, v), true, `${k}=${v} should be valid`);
    const bads = k === 'haptics' ? ['', 'on', 'off', 1, null, undefined] : ['', 'LEFT', 1, true, null, undefined];
    for (const bad of bads)
      assertEqual(A.settingsValid(k, bad), false, `${k}=${String(bad)} should be invalid`);
    for (const v of values){
      assertEqual(A.setOption(k, v), true);
      assertEqual(A.SETTINGS[k], v);
      assertEqual(JSON.parse(global.__store.get(A.SETTINGS_KEY))[k], v, `${k} was not saved`);
    }
    assertEqual(A.setOption(k, 'nonsense'), false);
  }
});

test('[touch settings] an old save without them loads with the defaults', () => {
  global.__store.set(A.SETTINGS_KEY, JSON.stringify({ difficulty: 'hard', master: 0.3, muted: true }));
  A.loadSettings();
  assertEqual(A.SETTINGS.difficulty, 'hard');
  assertEqual(A.SETTINGS.touchHud, 'auto');
  assertEqual(A.SETTINGS.touchSide, 'left');
  assertEqual(A.SETTINGS.haptics, true);
  // A bad value in the new fields falls back on its own and leaves the rest.
  global.__store.set(A.SETTINGS_KEY, JSON.stringify({ touchSide: 'up', haptics: false, master: 0.4 }));
  A.loadSettings();
  assertEqual(A.SETTINGS.touchSide, 'left');
  assertEqual(A.SETTINGS.haptics, false);
  assertEqual(A.SETTINGS.master, 0.4);
  // A save from before haptics was a boolean falls back to the default.
  global.__store.set(A.SETTINGS_KEY, JSON.stringify({ haptics: 'off' }));
  A.loadSettings();
  assertEqual(A.SETTINGS.haptics, true);
});

test('[touch settings] RESET SETTINGS restores them', () => {
  A.setOption('touchHud', 'minimal'); A.setOption('touchSide', 'right'); A.setOption('haptics', false);
  A.resetSettings({ keepTerms: true });
  assertEqual(A.SETTINGS.touchHud, 'auto');
  assertEqual(A.SETTINGS.touchSide, 'left');
  assertEqual(A.SETTINGS.haptics, true);
  // ...and the pause button does the same through the UI.
  A.setOption('touchSide', 'right');
  document.getElementById('btn-settings-reset').click();
  assertEqual(A.SETTINGS.touchSide, 'left');
});

test('[touch settings] every touch row is built, pressed correctly, and marked touch-only', () => {
  A.setOption('touchSide', 'right');
  const rows = document.querySelectorAll('.seg[data-opt]');
  for (const [k, values] of Object.entries(TOUCH_KEYS)){
    const row = rows.find(r => r.dataset.opt === k);
    assertEqual(!!row, true, `no row for ${k}`);
    assertEqual(row.querySelectorAll('button').map(b => b.dataset.value).join(), values.map(String).join());
  }
  const html = readHtml();
  for (const k of Object.keys(TOUCH_KEYS)){
    const row = html.match(new RegExp(`<div class="setrow([^"]*)">\\s*<span class="lbl">[^<]*</span>\\s*<div[^>]*data-opt="${k}"`));
    assertEqual(!!row && /touch-only/.test(row[1]), true, `${k} row is not marked touch-only`);
  }
  assertEqual(/\[data-input=kbm\]\s*\.touch-only\s*\{\s*display\s*:\s*none/.test(fs.readFileSync(new URL('../../css/touch.css', import.meta.url), 'utf8')), true);
  A.resetSettings();
});

function assertEqual(a, b, msg){
  if (a !== b) throw new Error(`${msg || 'mismatch'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
