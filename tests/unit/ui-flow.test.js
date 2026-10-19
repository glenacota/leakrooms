import test from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fakeAudioContext } from '../helpers/stubs.js';
import assert from 'node:assert/strict';
import { softAssert } from '../helpers/soft-assert.js';
import { readCss, readHtml, readSrc } from '../helpers/src-text.js';
import { loadGame } from '../helpers/harness.js';

const __dirname = fileURLToPath(new URL('../..', import.meta.url));
const { A, G, els, calls, store, press, askedIds } = await loadGame();
const seededRNG = A.mulberry32(0xC0FFEE);
const moveEnt = A.moveEnt;
const blocked = A.blocked;
const keys = A.keys;
const emitNoise = A.emitNoise;
const buildFloor = A.buildFloor;
const update = A.update;
const render = A.render;


/* ============ TEST 21: the splash chain — 03 riser, 04 work order, then the run
   Two splash frames sit in front of the game now, so the path a player walks
   to reach the first frame is part of the build and has to be tested like
   one: which screen is up, what each key does, what is left held afterwards. */
test('[21] the splash chain — 03 riser, 04 work order, then the run', () => {
  const t = softAssert();
console.log('[21] the splash chain — 03 riser, 04 work order, then the run');
{
  const html = readHtml();
  const css  = readCss();

  /* --- the markup contract --- */
  t.assert(!/screen-title/.test(html), 'the old title screen is still wired into index.html');
  const splashHtml = html.slice(html.indexOf('id="screen-splash"'), html.indexOf('id="screen-order"'));
  const orderHtml  = html.slice(html.indexOf('id="screen-order"'), html.indexOf('id="screen-pause"'));
  t.assert(splashHtml.length>0 && orderHtml.length>0, 'the splash or work-order screen is missing from index.html');
  t.assert(/LEAKROOMS/.test(splashHtml), 'splash 03 does not show the title');
  t.assert(!/\bhidden\b/.test(splashHtml), 'splash 03 ships hidden — the boot frame would be a blank canvas');
  t.assert(/class="screen hidden"/.test(orderHtml), 'work order 04 ships visible over the riser');
  t.assert(/id="btn-start"/.test(orderHtml), 'work order 04 has no clock-in button for btn-start to bind');

  /* --- the controls summary is the reason screen 04 exists --- */
  for (const key of ['WASD','SHIFT','ESC']){
    t.assert(new RegExp('>'+key+'[^<]*<').test(orderHtml), `work order 04 never lists ${key}`);
  }
  t.assert(/>R</.test(orderHtml), 'work order 04 never lists R, the radar');
  t.assert(/>M</.test(orderHtml), 'work order 04 never lists M, the mute');

  /* --- and it is legible, not merely present.
         The old title screen was 11px and nobody read it, so the requirement
         is a floor on rendered size, not the existence of the text. --- */
  const px = (sel)=>{ const m = css.match(sel); return m ? Number(m[1]) : NaN; };
  t.assert(px(/\.controls-big span\{[^}]*font-size:(\d+)px/)>=14,
         'the controls summary body text is under 14px');
  t.assert(px(/\.controls-big b\{[^}]*font-size:(\d+)px/)>=14,
         'the control keys are under 14px');
  t.assert(px(/\.order \.field b\{[^}]*font-size:(\d+)px/)>=15,
         'the work order body text is under 15px');
  t.assert(px(/\.order-head h2\{[^}]*font-size:(\d+)px/)>=20,
         'the work order title is under 20px');
  console.log(`  work order type: title ${px(/\.order-head h2\{[^}]*font-size:(\d+)px/)}px, `+
              `body ${px(/\.order \.field b\{[^}]*font-size:(\d+)px/)}px, controls ${px(/\.controls-big b\{[^}]*font-size:(\d+)px/)}px`);

  /* --- the chain itself, driven through the real key handler --- */
  const keydown = global.window._h.keydown;
  t.assert(typeof keydown==='function', 'no keydown handler was registered');
  const press = (key, extra={})=> keydown({ key, repeat:false, metaKey:false, ctrlKey:false,
                                            altKey:false, preventDefault(){}, ...extra });
  const vis = ()=> A.SCREENS.filter(s=>!els['screen-'+s].classList.contains('hidden'));

  A.hideAll(); A.STATE='splash'; A.show('splash');
  t.assert(vis().join()==='splash', `boot shows ${vis().join()||'nothing'}, expected the riser`);

  press('Enter');
  t.assert(A.STATE==='order', `ENTER on the riser left STATE at ${A.STATE}`);
  t.assert(vis().join()==='order', `ENTER showed ${vis().join()||'nothing'}, expected the work order alone`);
  t.assert(/^#88D-[0-9A-F]{1,4}$/.test(els['order-seed'].textContent),
    `the run seed is "${els['order-seed'].textContent}" — the stub does not carry the seed of the floor it clocks into`);

  press('Escape');
  t.assert(A.STATE==='splash' && vis().join()==='splash', 'ESC did not walk back to the riser');
  press('Escape');
  t.assert(A.STATE==='splash', 'ESC on the riser advanced anyway — there is nothing behind it');

  press('q');
  t.assert(A.STATE==='order', 'an ordinary key did not advance the splash');

  /* --- the terms chooser on the work order --------------------------------
     The order screen is a form while the chooser is open: the any-key advance
     has to stop clocking the player in, the number row picks a term, the
     arrows cycle, and both dismiss keys fold the chooser shut before they do
     anything else. Driven through the real handler, because the any-key
     advance is exactly the branch a chooser has to survive. */
  A.setTermsOpen(true);
  t.assert(A.termsOpen, 'the terms chooser did not open');

  press('w');
  t.assert(A.STATE==='order', 'a key with the terms chooser open clocked the player in');
  t.assert(!A.keys['w'], 'a key swallowed by the chooser stayed held — the player walks on spawn');

  const at = ()=> A.SETTINGS.difficulty;
  press('1');
  t.assert(at()==='relaxed', 'the 1 key did not pick the first term');
  press('3');
  t.assert(at()==='hard', 'the 3 key did not pick the last term');
  press('ArrowRight');
  t.assert(at()==='relaxed', 'the arrow keys did not cycle the terms');
  press('ArrowLeft');
  t.assert(at()==='hard', 'the arrow keys did not cycle back');

  press('Enter');
  t.assert(A.STATE==='order', 'ENTER with the chooser open clocked the player in instead of folding it shut');
  t.assert(!A.termsOpen, 'ENTER did not fold the terms chooser shut');

  A.setTermsOpen(true);
  press('Escape');
  t.assert(A.STATE==='order', 'ESC with the chooser open left the ticket instead of folding it shut');
  t.assert(!A.termsOpen, 'ESC did not fold the terms chooser shut');

  /* ESC on a shut chooser still walks the chain — the guard is only for the
     open fold */
  press('Escape');
  t.assert(A.STATE==='splash', 'ESC with the chooser shut did not walk back to the riser');
  press('q');

  /* and with the chooser shut the frame is a splash again */
  A.setOption('difficulty','normal');
  press('w');
  t.assert(A.STATE==='play', `the clock-in did not start the run (STATE=${A.STATE})`);
  t.assert(!A.keys['w'], 'the key that dismissed the splash is still held — the player walks before they can react');
  t.assert(els['hud'].classList.contains('on'), 'the HUD did not come up with the run');
  t.assert(vis().length===0, `${vis().join()} still up on top of the run`);

  /* repeat is how a held key behaves, and it must not advance twice */
  A.hideAll(); A.STATE='splash'; A.show('splash');
  press('Enter', {repeat:true});
  t.assert(A.STATE==='splash', 'an auto-repeating ENTER advanced the splash');
  press('Enter');
  press('Enter', {repeat:true});
  t.assert(A.STATE==='order', 'an auto-repeating ENTER skipped the work order and started the run');
  press('Enter');
  t.assert(A.STATE==='play', `two ENTER presses on the chain did not reach the run (STATE=${A.STATE})`);

  /* --- M, on the real key handler, in every state ---
     It is the one control with no button, so the key path IS the feature: a
     hotkey that is wired to the wrong state, or that fires on auto-repeat, or
     that also advances the splash, is a hotkey that does not work. */
  const mutedAt = ()=> A.SETTINGS.muted;
  const storeAt = ()=> JSON.parse(global.__store.get(A.SETTINGS_KEY) || '{}');
  const stored = ()=> {
    A.saveSettings();
    const s = storeAt();
    A.loadSettings();
    return s;
  };
  for (const st of ['splash','order','pause','dead','win']){
    A.STATE = st;
    t.assert(mutedAt()===false || typeof mutedAt()==='boolean',
      `could not read the muted flag in state ${st}`);
    press('m');
    t.assert(mutedAt()===true, `M did not mute from the ${st} screen`);
    press('m');
    t.assert(mutedAt()===false, `M did not unmute from the ${st} screen`);
  }
  /* auto-repeat must not toggle twenty times while the key is held */
  A.STATE='play';
  press('m', {repeat:true});
  t.assert(mutedAt()===false, 'a held M toggled the mute anyway');
  press('m');
  t.assert(mutedAt()===true, 'M stopped working after an auto-repeat');

  /* and it is the muted one that persists */
  t.assert(stored().muted===true, 'the mute did not survive a save/load round trip');
  A.setOption('muted', false);
  t.assert(stored().muted===false, 'unmuting did not persist');

  /* M must NOT be a splash advance: pressing it on the title leaves you on the
     title. A mute key that doubles as "skip intro" is a bug report. */
  A.hideAll(); A.STATE='splash'; A.show('splash');
  press('m');
  t.assert(A.STATE==='splash', 'M advanced the splash chain');
  A.setOption('muted', false);
  console.log('  ENTER / any key / click advance, ESC steps back, one screen at a time');
  console.log('  M toggles mute from every screen, survives a reload, and never advances the splash');
}
  t.done();
});
/* ============ TEST 25: the plan behind the title — it is the level you get
   The splash paints a floor plan. The only version of that worth shipping is
   the one the run is actually built from, so the seed contract is the test:
   the painting cannot be re-rolled by anything the player does between seeing
   it and playing it. */
test('[25] the splash plan — painted from the seed the run uses', () => {
  const t = softAssert();
console.log('[25] the splash plan — painted from the seed the run uses');
{
  const html = readHtml();
  const css  = readCss();
  const splashHtml = html.slice(html.indexOf('id="screen-splash"'), html.indexOf('id="screen-order"'));

  /* --- markup: two layers plus the tape pass --- */
  t.assert(/id="splash-plan"/.test(splashHtml),  'the splash has no plan canvas');
  t.assert(/id="splash-plan-far"/.test(splashHtml), 'the parallax layer is missing from the splash');
  t.assert(/splash-bands/.test(splashHtml) && /splash-track/.test(splashHtml),
    'the tape pass over the plan is missing');

  /* --- the roll has to loop: -50% of the canvas must be exactly one period
         of the painting, or there is a seam travelling across the title. --- */
  const roll = css.match(/@keyframes planroll\{[\s\S]*?translateX\(-50%\)/);
  t.assert(roll, 'the plan does not roll, or does not end at -50% — the period is not the frame width');
  t.assert(/\.splash-plan\s+canvas\{[^}]*animation:planroll/.test(css), 'the plan layer is not wired to the roll');
  t.assert(/prefers-reduced-motion[\s\S]*\.splash-plan canvas[^{]*\{[^}]*animation:none/.test(css),
    'the plan still rolls when the system asks for reduced motion');

  /* --- it is faded. A plan at full strength is a tutorial. --- */
  const op = css.match(/\.splash-plan\{[^}]*opacity:([\d.]+)/);
  t.assert(op && Number(op[1])>0 && Number(op[1])<=0.15,
    `the plan sits at opacity ${op?op[1]:'unset'} — it is supposed to be a hint, not a map`);

  /* --- painting runs headless, and sizes itself so one period is one frame --- */
  buildFloor(0, 4242);
  const cv = els['splash-plan'], far = els['splash-plan-far'];
  const before = calls.list.length;
  A.paintSplashPlan();
  t.assert(calls.list.length>before, 'paintSplashPlan drew nothing at all');
  t.assert(cv.width === cv.clientWidth*2,
    `the canvas is ${cv.width}px for a ${cv.clientWidth}px frame — the roll seam is not on a period boundary`);
  t.assert(far.width === cv.width && far.height === cv.height,
    'the parallax layer is not the same painting at a different speed');

  /* --- the seed contract: nothing between seeing the plan and playing it may
         re-roll the seed. This is the assertion that stops the splash from
         quietly becoming a picture of a building you will never walk. --- */
  const seedAtBoot = A.RUN_SEED;
  document.getElementById('btn-start').click();
  t.assert(A.RUN_SEED===seedAtBoot, 'clocking in re-rolled the seed — the splash was showing a different level');
  t.assert(G.seed===A.RUN_SEED, 'the run was not built from the seed the splash was painted with');

  /* ...but a finished run is entitled to a new building. */
  A.rollRunSeed();
  t.assert(A.RUN_SEED!==seedAtBoot, 'a new run kept the old seed — RUN IT AGAIN is the same building');
  t.assert(G.seed===A.RUN_SEED, 'the re-rolled seed did not reach the level');
  console.log(`  plan rolls at two speeds, faded to ${op?op[1]:'?'}, loops seamlessly, and matches seed #${(A.RUN_SEED>>>0).toString(16)}`);
}
  t.done();
});
/* ============ TEST 26: the pause screen IS the work order
   Splash 04 and the pause modal are the same document. That is a design claim,
   so it is asserted as one: same ticket markup, same controls block, and the
   numbers on it are the run's real numbers rather than the static copy the
   splash ships with. A pause screen showing stale text is worse than a plain
   one, because the player trusts it. */
test('[26] the pause screen — the work order, with the run written on it', () => {
  const t = softAssert();
console.log('[26] the pause screen — the work order, with the run written on it');
{
  const html = readHtml();
  const splash = html.slice(html.indexOf('id="screen-splash"'));
  const order  = html.slice(html.indexOf('id="screen-order"'),  html.indexOf('id="screen-pause"'));
  const pause  = html.slice(html.indexOf('id="screen-pause"'),   html.indexOf('id="screen-dead"'));
  t.assert(pause.length>0, 'the pause screen is missing from index.html');

  /* --- same furniture --- */
  t.assert(/class="order perf"/.test(pause), 'the pause screen is not the ticket');
  t.assert(!/class="tape"/.test(pause), 'the pause screen still has its own layout');

  /* --- the settings that remain are pages of the ticket ---
     The modal they used to live in is gone, and the rows it held are inside
     the ticket — that inversion is the assertion: the old test demanded the
     settings link sit BELOW the ticket, and that is exactly what is no
     longer true. */
  t.assert(!/id="screen-settings"/.test(html),
    'the settings modal is still in index.html — the settings belong on the ticket');
  for (const id of ['set-master','set-hue','set-contrast','btn-settings-reset'])
    t.assert(new RegExp('id="'+id+'"').test(pause),
      `the pause ticket has no ${id} — a settings row left the ticket`);
  t.assert(pause.indexOf('id="set-master"') > pause.indexOf('class="order perf"'),
    'the settings rows are outside the ticket instead of inside it');

  /* --- and the difficulty is not one of them. The terms are taken at the
     door: the chooser lives on the work order, the run is built with whatever
     the stamp says at clock-in, and the pause screen prints the terms as a
     fact. A difficulty control on the pause ticket is the mid-run rewrite
     this move exists to kill — applySettings() would move FLOOR_CLOCK and
     REPAIR_TIME under a floor already being played. --- */
  t.assert(!/id="set-difficulty"/.test(pause),
    'the difficulty chooser is still on the pause ticket — the terms belong at the door');
  t.assert(!/id="note-difficulty"/.test(pause),
    'the difficulty note is still on the pause ticket');
  t.assert(/id="set-difficulty"/.test(order)
         && order.indexOf('id="set-difficulty"') > order.indexOf('class="order perf"'),
    'the work order has no terms chooser inside the ticket');
  t.assert(/id="order-terms"/.test(order) && /id="btn-terms-change"/.test(order),
    'the work order has no SHIFT TERMS stamp or no CHANGE link');
  t.assert(/id="pause-terms"/.test(pause),
    'the pause ticket does not print the shift terms the run is on');
  
  /* --- and SPLASH 02 is a page of the ticket too --- */
  t.assert(/data-pause-page="briefing"/.test(pause), 'the pause ticket has no briefing page');
  t.assert(/data-pause-tab="settings"/.test(pause) && /data-pause-tab="briefing"/.test(pause),
    'the pause ticket has no tabs for its two pages');

  /* --- the same controls, in the same place: the stub, under CONTROLS --- */
  const ctrlBlock = (s)=>{ const m = s.match(/<small>CONTROLS<\/small>([\s\S]*?)<\/div>\s*<\/(?:p|div)>/); return m?m[1]:''; };
  const keysOf = (s)=> [...ctrlBlock(s).matchAll(/<b>([^<]+)<\/b>/g)].map(m=>m[1]);
  const pk = keysOf(pause), ok = keysOf(order);
  t.assert(ctrlBlock(pause).length>0, 'the pause ticket has no controls block');
  t.assert(ctrlBlock(order).length>0, 'the splash ticket has no controls block');
  /* The chips are styled with letter-spacing, so the labels are free to be
     written in prose case ("WASD / arrows"); matching is case-insensitive. */
  const has = (list, k)=> list.some(x=>x.toUpperCase().includes(k.toUpperCase()));
  for (const k of ['WASD','ARROWS','SHIFT','R','M','ESC']){
    t.assert(has(pk, k), `the pause ticket never lists ${k}`);
  }
  /* ENTER is chipped on the splash's list as the confirm key. The pause stub
     lists the keys you use while playing plus ESC, and ENTER is not among
     them — it resumes, as the strip under the ticket says, but a chip list
     and a resume hint are different furniture and the stub only carries the
     first. A key listed as doing something it does not do is worse than a key
     missing from a list. */
  t.assert(!has(pk, 'ENTER'), 'the pause stub still lists ENTER, which resumes nothing');
  for (const k of ok.filter(x=>!x.toUpperCase().includes('ENTER'))){
    t.assert(has(pk, k), `the pause ticket dropped ${k}, which the splash lists`);
  }

  /* --- the briefing page reprints the ticket's WORK: scope and notes ---
     It is SPLASH 02's payload without the 88D letterhead and without a second
     copy of the controls list — the stub carries the controls on every page,
     so reprinting them would be a second thing to keep in sync for no reader.
     What the briefing owes the splash is the work itself, so that is what is
     asserted, line by line, rather than by vibe. Scoped to the briefing page
     alone: the slice stops at the stub, or the stub's own chips would answer
     for the page and the check would pass on a page that says nothing. */
  const body = pause.slice(pause.indexOf('data-pause-page="briefing"'),
                           pause.indexOf('class="order-side"'));
  t.assert(/Scope of work/i.test(body), 'the briefing page has no scope of work');
  t.assert(body.includes('Locate and repair all leaks on 5 floors'),
    'the briefing page dropped the splash scope sentence');
  const notesOf = (s)=> [...s.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m=>m[1].trim());
  const splashNotes = notesOf(order);
  t.assert(splashNotes.length>0, 'the splash ticket has no notes to reprint');
  /* The apostrophe may be encoded on one ticket and typed on the other, and
     the numbers on it are wrapped in spans now, so the comparison flattens
     the entities and strips the tags first — checking the words the player
     reads, not the markup that carries them. */
  const flat = (s)=> s.replace(/<[^>]+>/g,'')
                      .replace(/&rsquo;/g,"'").replace(/&lsquo;/g,"'")
                      .replace(/&#39;/g,"'").replace(/&amp;/g,"&");
  for (const n of splashNotes){
    t.assert(flat(body).includes(flat(n)), `the briefing page dropped a splash note: ${n.slice(0,44)}…`);
  }
  t.assert(!/controls-big/.test(body),
    'the briefing page reprints the controls list — the stub already carries it');

  /* --- and the numbers are the run's --- */
  buildFloor(2, 9090);
  G.leaksOpen = G.pipes; G.floodCover = 0.31; G.batt = 42; G.stat.noises = 7;
  A.STATE = 'play';
  A.togglePause();
  t.assert(A.STATE==='pause', 'ESC did not pause');
  /* A pause lands on the settings page — it is the page with something to
     change on it, and the reason most players come back to the ticket. */
  t.assert(A.pausePage==='settings', 'a pause does not land on the settings page');

  /* ESC walks the pages backwards before it leaves the ticket: briefing back
     to settings, settings back to the run. Driven through the real key
     handler, because a chain asserted only at the API level is a chain that
     disagrees with the key the player actually presses. */
  const keydown = global.window._h.keydown;
  t.assert(typeof keydown==='function', 'no keydown handler was registered');
  const press = (key, extra={})=> keydown({ key, repeat:false, metaKey:false, ctrlKey:false,
                                            altKey:false, preventDefault(){}, ...extra });
  A.setPausePage('briefing');
  press('Escape');
  t.assert(A.pausePage==='settings', 'ESC on the briefing page did not return to the settings page');
  t.assert(A.STATE==='pause', 'ESC on the briefing page resumed the run instead of stepping back');
  press('Escape');
  t.assert(A.STATE==='play', 'ESC on the settings page did not resume');
  const txt = id=> els[id] ? els[id].innerHTML : '';
  t.assert(txt('pause-level')==='3/5', `depth reads "${txt('pause-level')}" on level 3`);
  t.assert(txt('pause-pipes').includes('0/'), `the riser tally reads "${txt('pause-pipes')}"`);
  t.assert(txt('pause-clock')===A.clockText(G.clock), 'the clock on the ticket is not the clock in state');
  
  /* the life pips are spent ones included — the count the HUD has been showing */
  A.lives = Math.max(1, A.runLives-1);
  A.STATE='play'; A.togglePause();
  t.assert(/gone/.test(txt('pause-lives')), 'a spent life is not drawn as spent on the ticket');
  A.lives = A.runLives;

  /* once every riser is sealed the LEAKS FIXED tally says so instead of stalling */
  G.leaksOpen = 0;
  A.STATE='play'; A.togglePause();
  t.assert(txt('pause-pipes')===`${G.pipes}/${G.pipes}`,
    `with every riser sealed the tally reads "${txt('pause-pipes')}"`);

  /* the strip under the ticket promises ENTER resumes as well as ESC. With no
     control focused, ENTER is the modal confirm key — assert the promise,
     through the real key handler, on the page a pause lands on. */
  A.STATE='play'; A.togglePause();
  t.assert(A.pausePage==='settings', 'a pause does not land on the settings page');
  press('Enter');
  t.assert(A.STATE==='play', 'ENTER did not resume from the settings page');

  /* --- the run is built with the stamped terms, and the ticket says so -----
     The whole move in a few asserts: the chooser moves the constants the run
     is built with, clocking in reads them, and the work order's stamp names
     the shift. */
  A.setOption('difficulty','hard');
  t.assert(A.FLOOR_CLOCK===A.DIFFICULTIES.hard.clock,
    'choosing HARD did not move the clock the run is built with');
  document.getElementById('btn-start').click();
  t.assert(A.runLives===1, 'clocking in on HARD did not set the attempts to 1');
  t.assert(G.clock===A.DIFFICULTIES.hard.clock, 'the floor was not built with the HARD clock');
  A.togglePause();
  const stamp = els['order-terms'] ? els['order-terms'].textContent : '';
  t.assert(stamp==='HARD', `the work order stamp reads "${stamp}" on HARD`);
  t.assert(txt('pause-terms')==='HARD',
    `the pause stub reads "${txt('pause-terms')}" — the run is on terms the ticket never names`);

  /* --- the briefing is written for the terms, not for NORMAL ----------------
     The work order used to say "3 minutes" and "5 seconds" whatever the
     terms, which is a lie on two of the three. Both copies of the document —
     the work order and the pause reprint — follow the choice. */
  const prose = (id)=> (els[id] ? els[id].textContent : '');
  A.setOption('difficulty','hard');
  t.assert(prose('order-return')==='2 minutes 30 seconds',
    `the work order reads "${prose('order-return')}" on HARD`);
  t.assert(prose('order-repair')==='4 seconds',
    `the repair note reads "${prose('order-repair')}" on HARD`);
  t.assert(prose('brief-return')==='2 minutes 30 seconds' && prose('brief-repair')==='4 seconds',
    'the pause reprint of the work order did not follow the terms');
  A.setOption('difficulty','relaxed');
  t.assert(prose('order-return')==='4 minutes' && prose('order-repair')==='7 seconds',
    `the work order reads "${prose('order-return')}" and "${prose('order-repair')}" on RELAXED`);
  A.setOption('difficulty','normal');
  t.assert(prose('order-return')==='3 minutes' && prose('order-repair')==='5 seconds',
    'the work order did not return to the NORMAL numbers');

  /* leave the store as the next test expects to find it */
  A.setOption('difficulty','normal');
  document.getElementById('btn-start').click();
  /* --- RESET GAME: two-stage, then a fresh run at the riser ---
     The only control on the ticket that ends a run, so it arms first: the
     first press must change nothing but the label, and the second press is
     the one that moves the player. */
  A.togglePause();
  t.assert(A.STATE==='pause' && A.pausePage==='settings',
    'the ticket did not open on the settings page for the reset check');
  const resetBtn = els['btn-reset-run'];
  t.assert(resetBtn, 'the pause settings have no RESET GAME button');
  const seedBefore = A.RUN_SEED;
  resetBtn.click();
  t.assert(A.STATE==='pause', 'the first press of RESET GAME fired — it must arm first');
  t.assert(/TAP AGAIN/.test(resetBtn.textContent),
    `the armed label reads "${resetBtn.textContent}"`);
  t.assert(A.RUN_SEED===seedBefore, 'arming RESET GAME rolled the seed — nothing should have moved');
  t.assert(A.resetArmed, 'RESET GAME did not report itself armed');

  /* an armed reset does not survive the player's attention moving on */
  A.setPausePage('briefing');
  t.assert(!A.resetArmed, 'the armed RESET GAME survived a page switch');
  t.assert(!/TAP AGAIN/.test(resetBtn.textContent),
    'the button still reads armed after the page switch');
  A.setPausePage('settings');

  /* the second press is the one that fires */
  resetBtn.click();
  resetBtn.click();
  t.assert(A.STATE==='splash', `RESET GAME did not return to the riser (STATE=${A.STATE})`);
  t.assert(!els['screen-splash'].classList.contains('hidden'),
    'RESET GAME left the riser hidden');
  t.assert(A.RUN_SEED!==seedBefore, 'RESET GAME kept the seed — the same building is waiting at the door');
  t.assert(G.floor===0 && G.leaksOpen===G.pipes && G.clock>=A.FLOOR_CLOCK,
    'the floor after RESET GAME is not a fresh floor 0');
  t.assert(A.lives===A.runLives, 'RESET GAME did not restore the attempts');
  t.assert(!els['hud'].classList.contains('on'), 'the HUD stayed up over the riser');

  /* and the run it starts from the riser is a full one on the same terms */
  const termsKept = A.SETTINGS.difficulty;
  document.getElementById('btn-start').click();
  t.assert(A.STATE==='play' && A.lives===A.runLives, 'the run after RESET GAME did not start whole');
  t.assert(A.SETTINGS.difficulty===termsKept,
    'RESET GAME wiped the stamped terms — preferences are not progress');

  A.STATE='play'; A.hideAll();
  console.log('  pause = the work order, live numbers, settings and briefing as pages of it; terms taken at the door; RESET GAME two-stage');
}
  t.done();
});

/* ============ TEST 34: the floor-clear card ==============================
   The one screen between two levels. It is asserted on three axes, because each
   of them can fail alone and none of them implies the others:

     markup    the card exists, ships hidden, and has something to press
     content   the briefing is the LEVELS row for the floor being entered, and
                the clock is the one that was left on the floor just finished
     behaviour it holds the player out of a floor that is already built and
                already running, the clock is frozen while it is up, and ENTER
                lets go with every key released
   ============================================================ */
test('[34] the floor-clear card — clock left, next floor, ENTER to descend', () => {
  const t = softAssert();
console.log('[34] the floor-clear card — clock left, next floor, ENTER to descend');
{
  const html = fs.readFileSync(__dirname+'/index.html','utf8');
  const css  = readCss();

  const at = html.indexOf('id="screen-clear"');
  const clearHtml = at>=0 ? html.slice(at, html.indexOf('id="screen-dead"')) : '';
  t.assert(at>=0, 'there is no #screen-clear in index.html');
  t.assert(/class="screen hidden"/.test(clearHtml),
    'the clear card ships visible — it would cover the first frame of the run');
  t.assert(/id="btn-descend"/.test(clearHtml), 'the clear card has no button for btn-descend to bind');
  for (const id of ['clear-clock','clear-leaks','clear-forms','clear-floor','clear-sub'])
    t.assert(new RegExp('id="'+id+'"').test(clearHtml), `the clear card is missing #${id}`);
  t.assert(A.SCREENS.includes('clear'),
    `'clear' is not in SCREENS, so show()/hideAll() will never bring the card up`);

  /* --- the content: the next floor's briefing is LEVELS, not a guess --- */
  buildFloor(0, 24601);
  A.floorIdx=0;
  A.STATE = 'play';
  /* Give the finished floor a clock the card can be checked against. The build
     above reset it, so this is set after, exactly as a played level would be. */
  G.clock = 47.5;
  const spec = A.LEVELS[1];
  A.nextFloor();

  t.assert(A.STATE==='clear', `the descent landed in STATE '${A.STATE}', want 'clear'`);
  t.assert(A.floorIdx===1, `the descent left floorIdx at ${A.floorIdx}, want 1`);
  t.assert(Math.abs(A.clearCard.clock-47.5) < 1e-9,
    `the card reported ${A.clearCard.clock}s left, want the 47.5s the finished floor had — `+
    'the clock is being read after buildFloor threw the old floor away');
  t.assert(A.clearCard.leaks===spec.leaks && A.clearCard.forms===spec.forms,
    `the briefing says ${A.clearCard.leaks} bursts / ${A.clearCard.forms} lifeforms, `+
    `LEVELS[1] says ${spec.leaks} / ${spec.forms}`);
  t.assert(!els['screen-clear'].classList.contains('hidden'), 'show(\'clear\') left the card hidden');
  t.assert(els['screen-splash'].classList.contains('hidden')
      && els['screen-order'].classList.contains('hidden'),
    'the clear card came up without dismissing the screens behind it');
  t.assert(els['hud'].classList.contains('on')===false, 'the HUD is still lit behind the clear card');

  /* --- and the card is styled, not just present: an unstyled div inherits the
         body font, and a briefing nobody can read is a briefing nobody reads --- */
  t.assert(/\.clear-next\{/.test(css), 'the clear card has no stylesheet rule — it ships unstyled');
  console.log(`  card: ${A.clearCard.leaks} bursts / ${A.clearCard.forms} lifeforms on floor `+
    `${A.floorIdx+1}, ${A.clockText(A.clearCard.clock)} left on the floor behind it, ENTER to descend`);

  /* --- behaviour: the floor under the card is REAL, and its clock is not
         running. Driven through frame(), not update(): the freeze is the loop's
         gate, and update() called directly is not a state a player is ever in. --- */
  t.assert(G.pipes===spec.leaks && G.leaksOpen===spec.leaks,
    `the floor under the card has ${G.leaksOpen} of ${G.pipes} bursts open — it is not built`);
  const c0 = G.clock;
  let now = Date.now();
  for (let i=0;i<120;i++) A.frame(now += 1000/60);   // two seconds of real frames
  t.assert(Math.abs(G.clock-c0) < 1e-9,
    `the clock moved from ${c0.toFixed(2)} to ${G.clock.toFixed(2)} while the card was up — `+
    'the card is not a frozen state, so reading the next floor costs the player time');

  /* --- and it is held the way a key is: nothing is simulating underneath, and
         ENTER lets go with every key released --- */
  A.keys['w'] = true; A.keys['shift'] = true;     // the player walked to the door
  A.dismissClear();
  t.assert(A.STATE==='play', `dismissClear left STATE '${A.STATE}', want 'play'`);
  t.assert(Object.keys(A.keys).every(k=>A.keys[k]===false || A.keys[k]===undefined),
    `keys were still held after the card cleared: ${JSON.stringify(A.keys)}`);
  t.assert(els['hud'].classList.contains('on'), 'the HUD did not come back on after the card');
  t.assert(els['screen-clear'].classList.contains('hidden'), 'the clear card stayed up after descending');

  const c1 = G.clock;
  for (let i=0;i<60;i++) A.frame(now += 1000/60);
  t.assert(A.STATE==='play' && G.clock < c1,
    `after the card the clock stood at ${G.clock.toFixed(2)} from ${c1.toFixed(2)} — the run is not running`);

  /* --- the LAST floor goes to the win card instead: no level six --- */
  buildFloor(4, 24601);
  A.floorIdx=4;
  A.STATE = 'play';
  A.nextFloor();
  t.assert(A.STATE==='win',
    `clearing the fifth floor went to '${A.STATE}', want 'win' — the card must not appear with no floor after it`);
}
  t.done();
});

/* ---- every id the game asks for is an id the markup carries ----
   The stub invents an element for anything index.html does not carry, so a
   write to a missing id succeeds: the number goes somewhere, the assertion on
   it passes, and the player never sees it. `pause-batt` survived that way.

   The harness records every id the game asked for. Each is either in
   index.html, or an id the game creates at runtime and lists below. */
test('[45] every id the game asks the document for exists', () => {
  const html = readHtml();
  const inMarkup = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

  /* Ids the game creates itself, so no markup can carry them. */
  const RUNTIME = new Set();

  const asked = [...new Set(askedIds)].sort();
  const ghosts = asked.filter(id => !inMarkup.has(id) && !RUNTIME.has(id));

  /* A stale allowlist entry is as dead as a ghost id. */
  const unused = [...RUNTIME].filter(id => !asked.includes(id));

  assert.deepEqual(ghosts, [],
    `the game asks the document for ids index.html does not carry — every write to one of these is invisible to the player:\n  ${ghosts.join('\n  ')}`);
  assert.deepEqual(unused, [],
    `these runtime ids are allowlisted but never asked for:\n  ${unused.join('\n  ')}`);

  console.log(`[45] every id the game asks the document for exists`);
  console.log(`  ${asked.length} ids asked, all in index.html, ${RUNTIME.size} runtime ids allowed`);
});
