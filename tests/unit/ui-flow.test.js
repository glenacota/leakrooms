import test from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { softAssert } from '../helpers/soft-assert.js';
import { readCss, readHtml } from '../helpers/src-text.js';
import { loadGame } from '../helpers/harness.js';

const __dirname = fileURLToPath(new URL('../..', import.meta.url));
const { A, G, els, calls, store, press, askedIds } = await loadGame();
const keys = A.keys;
const buildFloor = A.buildFloor;


/* Two splash frames sit in front of the game, so the path a player walks to reach
   the first frame is part of the build: which screen is up, what each key does,
   and what is left held afterwards. */
test('the splash chain walks the riser, then the work order, then the run', () => {
  const t = softAssert();
  const html = readHtml();
  const css  = readCss();

  /* The markup contract: the title and the binder are present, and only the
     title ships visible. */
  t.assert(!/screen-title/.test(html), 'the old title screen is still wired into index.html');
  const splashHtml = html.slice(html.indexOf('id="screen-splash"'), html.indexOf('id="screen-binder"'));
  const binderHtml = html.slice(html.indexOf('id="screen-binder"'), html.indexOf('id="screen-clear"'));
  t.assert(splashHtml.length>0 && binderHtml.length>0, 'the title or the binder is missing from index.html');
  t.assert(/LEAKROOMS/.test(splashHtml), 'the title does not show the name');
  t.assert(!/\bhidden\b/.test(splashHtml), 'the title ships hidden — the boot frame would be a blank canvas');
  t.assert(/class="screen hidden"/.test(binderHtml), 'the binder ships visible over the title');
  t.assert(/id="btn-start"/.test(binderHtml), 'the binder has no start button for btn-start to bind');
  const cta = binderHtml.match(/<div class="order-cta">([\s\S]*?)<\/div>/)?.[1] || '';
  for (const id of ['btn-start', 'btn-resume', 'btn-reset-run'])
    t.assert(cta.includes(`id="${id}"`), `#${id} is not in the shared binder CTA`);
  t.assert(/id="btn-reset-run"[^>]*>RESTART SHIFT<\/button>/.test(cta), 'reset CTA is not named RESTART SHIFT');
  for (const id of ['menu-start','menu-manual','menu-settings'])
    t.assert(splashHtml.includes(`id="${id}"`), `the title has no #${id}`);

  /* The controls live in the field manual page, and only there. */
  const manualHtml = binderHtml.slice(binderHtml.indexOf('data-binder-page="manual"'), binderHtml.indexOf('data-binder-page="settings"'));
  for (const key of ['WASD','SHIFT','ESC']){
    t.assert(new RegExp('>'+key+'[^<]*<').test(manualHtml), `the field manual never lists ${key}`);
  }
  t.assert(/>R</.test(manualHtml), 'the field manual never lists R, the radar');
  t.assert(/>M</.test(manualHtml), 'the field manual never lists M, the mute');

  /* Legibility, not just presence: the requirement is a floor on rendered size,
     not the existence of the text. */
  const px = (sel)=>{ const m = css.match(sel); return m ? Number(m[1]) : NaN; };
  t.assert(px(/\.controls-big span\{[^}]*font-size:(\d+)px/)>=14,
         'the controls summary body text is under 14px');
  t.assert(px(/\.controls-big b\{[^}]*font-size:(\d+)px/)>=14,
         'the control keys are under 14px');
  t.assert(px(/\.order \.field\s*\{[^}]*?font-size:(\d+)px/)>=16,
         'the work order body text is under 16px');
  t.assert(px(/\.order-head h2\{[^}]*font-size:(\d+)px/)>=20,
         'the work order title is under 20px');
  console.log(`  work order type: title ${px(/\.order-head h2\{[^}]*font-size:(\d+)px/)}px, `+
            `body ${px(/\.order \.field\s*\{[^}]*?font-size:(\d+)px/)}px, controls ${px(/\.controls-big b\{[^}]*font-size:(\d+)px/)}px`);
  /* The chain itself, driven through the real key handler rather than the API. */
  const keydown = global.window._h.keydown;
  t.assert(typeof keydown==='function', 'no keydown handler was registered');
  const press = (key, extra={})=> keydown({ key, repeat:false, metaKey:false, ctrlKey:false,
                                            altKey:false, preventDefault(){}, ...extra });
  const vis = ()=> A.SCREENS.filter(s=>!els['screen-'+s].classList.contains('hidden'));

  A.hideAll(); A.STATE='splash'; A.show('splash');
  t.assert(vis().join()==='splash', `boot shows ${vis().join()||'nothing'}, expected the riser`);

  press('Enter');
  t.assert(A.STATE==='binder', `ENTER on the title left STATE at ${A.STATE}`);
  t.assert(vis().join()==='binder', `ENTER showed ${vis().join()||'nothing'}, expected the binder alone`);
  t.assert(A.binderTab==='order', `CLOCK IN landed on '${A.binderTab}', expected the work order`);

  press('Escape');
  t.assert(A.STATE==='splash' && vis().join()==='splash', 'ESC did not walk back to the title');
  press('Escape');
  t.assert(A.STATE==='splash', 'ESC on the title advanced anyway — there is nothing behind it');

  /* The title is a menu: an ordinary key does nothing, the arrows pick an entry. */
  press('q');
  t.assert(A.STATE==='splash', 'an ordinary key advanced the title');
  press('ArrowDown');
  press('Enter');
  t.assert(A.STATE==='binder' && A.binderTab==='manual', `FIELD MANUAL entry opened '${A.binderTab}'`);
  press('ArrowRight');
  t.assert(A.binderTab==='settings', 'the right arrow did not turn to the next tab');
  press('Escape');
  t.assert(A.STATE==='splash', 'ESC on a non-order tab did not go back to the title');

  A.selectMenu('start');
  press('Enter');
  /* Terms are picked with the number keys on the work order page. */
  const at = ()=> A.SETTINGS.difficulty;
  press('1');
  t.assert(at()==='relaxed', 'the 1 key did not pick the first term');
  press('3');
  t.assert(at()==='hard', 'the 3 key did not pick the last term');
  press('w');
  t.assert(A.STATE==='binder', 'an ordinary key on the work order clocked the player in');
  t.assert(!A.keys['w'], 'a key swallowed by the binder stayed held — the player walks on spawn');

  A.setOption('difficulty','normal');
  press(' ');
  t.assert(A.STATE==='play', `SPACE on the work order did not start the run (STATE=${A.STATE})`);
  t.assert(!A.keys['w'], 'a key that was swallowed by the binder is still held');
  t.assert(els['hud'].classList.contains('on'), 'the HUD did not come up with the run');
  t.assert(vis().length===0, `${vis().join()} still up on top of the run`);

  /* Auto-repeat is how a held key behaves, and it must not advance twice. */
  A.hideAll(); A.STATE='splash'; A.show('splash');
  press('Enter', {repeat:true});
  t.assert(A.STATE==='splash', 'an auto-repeating ENTER advanced the title');
  press('Enter');
  press('Enter', {repeat:true});
  t.assert(A.STATE==='binder', 'an auto-repeating ENTER skipped the work order and started the run');
  press('Enter');
  t.assert(A.STATE==='play', `two ENTER presses on the chain did not reach the run (STATE=${A.STATE})`);

  /* M is the one control with no button, so the key path is the feature. A hotkey
     wired to the wrong state, or one that also advances the splash, does not
     work. */
  const mutedAt = ()=> A.SETTINGS.muted;
  const storeAt = ()=> JSON.parse(global.__store.get(A.SETTINGS_KEY) || '{}');
  const stored = ()=> {
    A.saveSettings();
    const s = storeAt();
    A.loadSettings();
    return s;
  };
  for (const st of ['splash','binder','pause','dead','win']){
    A.STATE = st;
    t.assert(mutedAt()===false || typeof mutedAt()==='boolean',
      `could not read the muted flag in state ${st}`);
    press('m');
    t.assert(mutedAt()===true, `M did not mute from the ${st} screen`);
    press('m');
    t.assert(mutedAt()===false, `M did not unmute from the ${st} screen`);
  }
  /* A held M must not toggle twenty times. */
  A.STATE='play';
  press('m', {repeat:true});
  t.assert(mutedAt()===false, 'a held M toggled the mute anyway');
  press('m');
  t.assert(mutedAt()===true, 'M stopped working after an auto-repeat');

  /* The muted value is the one that persists. */
  t.assert(stored().muted===true, 'the mute did not survive a save/load round trip');
  A.setOption('muted', false);
  t.assert(stored().muted===false, 'unmuting did not persist');

  /* M is not a splash advance. A mute key that doubles as "skip intro" is a bug. */
  A.hideAll(); A.STATE='splash'; A.show('splash');
  press('m');
  t.assert(A.STATE==='splash', 'M advanced the splash chain');
  A.setOption('muted', false);
  console.log('  ENTER / any key / click advance, ESC steps back, one screen at a time');
  console.log('  M toggles mute from every screen, survives a reload, and never advances the splash');;
});
/* The splash paints a floor plan, and the only version of that worth shipping is
   the one the run is actually built from. Nothing the player does between seeing
   the plan and playing it may re-roll the seed. */
test('the splash plan is painted from the seed the run uses', () => {
  const t = softAssert();
  const html = readHtml();
  const css  = readCss();
  const splashHtml = html.slice(html.indexOf('id="screen-splash"'), html.indexOf('id="screen-binder"'));

  /* Two layers plus the tape pass over the plan. */
  t.assert(/id="splash-plan"/.test(splashHtml),  'the splash has no plan canvas');
  t.assert(/id="splash-plan-far"/.test(splashHtml), 'the parallax layer is missing from the splash');
  t.assert(/splash-bands/.test(splashHtml) && /splash-track/.test(splashHtml),
    'the tape pass over the plan is missing');

  /* The roll has to loop: -50% of the canvas must be exactly one period of the
     painting, or a seam travels across the title. */
  const roll = css.match(/@keyframes planroll\{[\s\S]*?translateX\(-50%\)/);
  t.assert(roll, 'the plan does not roll, or does not end at -50% — the period is not the frame width');
  t.assert(/\.splash-plan\s+canvas\{[^}]*animation:planroll/.test(css), 'the plan layer is not wired to the roll');
  t.assert(/prefers-reduced-motion[\s\S]*\.splash-plan canvas[^{]*\{[^}]*animation:none/.test(css),
    'the plan still rolls when the system asks for reduced motion');

  /* The plan is faded. At full strength it is a tutorial. */
  const op = css.match(/\.splash-plan\{[^}]*opacity:([\d.]+)/);
  t.assert(op && Number(op[1])>0 && Number(op[1])<=0.15,
    `the plan sits at opacity ${op?op[1]:'unset'} — it is supposed to be a hint, not a map`);

  /* Painting runs headless, and sizes itself so one period is one frame. */
  buildFloor(0, 4242);
  const cv = els['splash-plan'], far = els['splash-plan-far'];
  const before = calls.list.length;
  A.paintSplashPlan();
  t.assert(calls.list.length>before, 'paintSplashPlan drew nothing at all');
  t.assert(cv.width === cv.clientWidth*2,
    `the canvas is ${cv.width}px for a ${cv.clientWidth}px frame — the roll seam is not on a period boundary`);
  t.assert(far.width === cv.width && far.height === cv.height,
    'the parallax layer is not the same painting at a different speed');

  /* The seed contract. This is the assertion that stops the splash from becoming
     a picture of a building the player never walks. */
  const seedAtBoot = A.RUN_SEED;
  document.getElementById('btn-start').click();
  t.assert(A.RUN_SEED===seedAtBoot, 'clocking in re-rolled the seed — the splash was showing a different level');
  t.assert(G.seed===A.RUN_SEED, 'the run was not built from the seed the splash was painted with');

  /* A finished run is entitled to a new building. */
  A.rollRunSeed();
  t.assert(A.RUN_SEED!==seedAtBoot, 'a new run kept the old seed — RUN IT AGAIN is the same building');
  t.assert(G.seed===A.RUN_SEED, 'the re-rolled seed did not reach the level');
  console.log(`  plan rolls at two speeds, faded to ${op?op[1]:'?'}, loops seamlessly, and matches seed #${(A.RUN_SEED>>>0).toString(16)}`);;
});
/* The work order and the pause screen are one binder: the manual and settings
   pages are the same markup in both modes, so they cannot drift apart. The RUN
   page carries numbers that belong to the run in front of you. */
test('the pause screen is the binder with the run written on it', () => {
  const t = softAssert();
  const html = readHtml();
  const binder = html.slice(html.indexOf('id="screen-binder"'), html.indexOf('id="screen-clear"'));
  t.assert(binder.length>0, 'the binder is missing from index.html');
  t.assert(!/id="screen-pause"/.test(html) && !/id="screen-order"/.test(html),
    'an old order or pause screen is still in index.html');
  t.assert(!/id="screen-settings"/.test(html), 'the settings modal is still in index.html');

  const page = name => {
    const at = binder.indexOf(`data-binder-page="${name}"`);
    return at < 0 ? '' : binder.slice(at);
  };
  t.assert(/id="set-difficulty"/.test(page('order')) && !/id="set-difficulty"/.test(page('run')),
    'the terms chooser must be on the work order page, and not on the run page');
  for (const id of ['set-master','set-hue','set-contrast','btn-settings-reset'])
    t.assert(binder.includes(`id="${id}"`), `the binder has no ${id}`);
  t.assert(binder.split('id="set-master"').length===2, 'the settings rows are in the binder more than once');
  t.assert(/id="pause-terms"/.test(binder), 'the run page does not print the terms the run is on');
  for (const tab of ['order','run','manual','settings'])
    t.assert(binder.includes(`data-binder-tab="${tab}"`), `the binder has no ${tab} tab`);

  /* The numbers are the run's. */
  buildFloor(2, 9090);
  G.openLeaks = G.totalLeaks; G.floodCover = 0.31; G.batt = 42; G.stat.noises = 7;
  A.STATE = 'play';
  A.togglePause();
  t.assert(A.STATE==='pause', 'ESC did not pause');
  t.assert(A.binderMode==='pause' && A.binderTab==='run', `a pause lands on '${A.binderMode}/${A.binderTab}', expected pause/run`);
  const shownTabs = document.querySelectorAll('[data-binder-tab]').filter(x=>!x.classList.contains('hidden'));
  t.assert(shownTabs.map(x=>x.dataset.binderTab).join()==='run,manual,settings',
    'a pause does not show exactly its own three tabs');

  /* ESC resumes from any tab. Driven through the real key handler. */
  const keydown = global.window._h.keydown;
  t.assert(typeof keydown==='function', 'no keydown handler was registered');
  const press = (key, extra={})=> keydown({ key, repeat:false, metaKey:false, ctrlKey:false,
                                            altKey:false, preventDefault(){}, ...extra });
  A.setBinderTab('manual');
  press('Escape');
  t.assert(A.STATE==='play', 'ESC on the manual tab did not resume');
  A.togglePause();
  press('ArrowRight');
  t.assert(A.binderTab==='manual', 'the right arrow did not turn the pause tab');
  press('ArrowRight'); press('ArrowRight');
  t.assert(A.binderTab==='run', 'the tabs do not wrap');
  const txt = id=> els[id] ? els[id].innerHTML : '';
  press('Escape');
  A.togglePause();
  t.assert(txt('pause-floor')==='3/5', `depth reads "${txt('pause-floor')}" on floor 3`);
  t.assert(txt('pause-leaks').includes('0/'), `the leak tally reads "${txt('pause-leaks')}"`);
  t.assert(txt('pause-clock')===A.clockText(G.clock), 'the clock on the run page is not the clock in state');

  /* The life pips include the spent ones, matching the count the HUD shows. */
  A.lives = Math.max(1, A.runLives-1);
  A.STATE='play'; A.togglePause();
  t.assert(/gone/.test(txt('pause-lives')), 'a spent life is not drawn as spent on the run page');
  A.lives = A.runLives;

  G.openLeaks = 0;
  A.STATE='play'; A.togglePause();
  t.assert(txt('pause-leaks')===`${G.totalLeaks}/${G.totalLeaks}`,
    `with every leak sealed the tally reads "${txt('pause-leaks')}"`);

  /* ENTER resumes from the run page. */
  A.STATE='play'; A.togglePause();
  press('Enter');
  t.assert(A.STATE==='play', 'ENTER did not resume from the run page');

  /* The run is built with the chosen terms, and the run page says so. */
  A.setOption('difficulty','hard');
  t.assert(A.FLOOR_CLOCK===A.DIFFICULTIES.hard.clock,
    'choosing HARD did not move the clock the run is built with');
  document.getElementById('btn-start').click();
  t.assert(A.runLives===1, 'clocking in on HARD did not set the attempts to 1');
  t.assert(G.clock===A.DIFFICULTIES.hard.clock, 'the floor was not built with the HARD clock');
  A.togglePause();
  t.assert(txt('pause-terms')==='HARD', `the run page reads "${txt('pause-terms')}" on HARD`);

  /* The manual is written for the terms: it follows the choice. */
  const prose = (id)=> (els[id] ? els[id].textContent : '');
  A.setOption('difficulty','hard');
  t.assert(prose('manual-return')==='2 minutes 30 seconds' && prose('manual-repair')==='4 seconds',
    `the manual reads "${prose('manual-return')}" and "${prose('manual-repair')}" on HARD`);
  A.setOption('difficulty','relaxed');
  t.assert(prose('manual-return')==='4 minutes' && prose('manual-repair')==='7 seconds',
    'the manual did not follow RELAXED');
  A.setOption('difficulty','normal');
  t.assert(prose('manual-return')==='3 minutes' && prose('manual-repair')==='5 seconds',
    'the manual did not return to the NORMAL numbers');
  t.assert(/lives/.test(prose('note-difficulty')) && /floor/.test(prose('note-difficulty')),
    `the terms note reads "${prose('note-difficulty')}"`);

  A.setOption('difficulty','normal');
  document.getElementById('btn-start').click();
  /* RESTART SHIFT is the only control that ends a run, so it arms first. */
  A.togglePause();
  t.assert(A.STATE==='pause' && A.binderTab==='run', 'the binder did not open on the run page for the reset check');
  const resetBtn = els['btn-reset-run'];
  t.assert(resetBtn, 'the binder has no RESTART SHIFT button');
  const seedBefore = A.RUN_SEED;
  resetBtn.click();
  t.assert(A.STATE==='pause', 'the first press of RESTART SHIFT fired — it must arm first');
  t.assert(/TAP AGAIN/.test(resetBtn.textContent), `the armed label reads "${resetBtn.textContent}"`);
  t.assert(A.RUN_SEED===seedBefore, 'arming RESTART SHIFT rolled the seed');
  t.assert(A.resetArmed, 'RESTART SHIFT did not report itself armed');

  /* An armed reset does not survive the player moving on. */
  A.setBinderTab('manual');
  t.assert(!A.resetArmed, 'the armed RESTART SHIFT survived a tab switch');
  t.assert(resetBtn.textContent==='RESTART SHIFT', `the button reads "${resetBtn.textContent}" after the tab switch`);
  A.setBinderTab('run');

  resetBtn.click();
  resetBtn.click();
  t.assert(A.STATE==='splash', `RESTART SHIFT did not return to the title (STATE=${A.STATE})`);
  t.assert(!els['screen-splash'].classList.contains('hidden'), 'RESTART SHIFT left the title hidden');
  t.assert(A.RUN_SEED!==seedBefore, 'RESTART SHIFT kept the seed');
  t.assert(G.floor===0 && G.openLeaks===G.totalLeaks && G.clock>=A.FLOOR_CLOCK,
    'the floor after RESTART SHIFT is not a fresh floor 0');
  t.assert(A.lives===A.runLives, 'RESTART SHIFT did not restore the attempts');
  t.assert(!els['hud'].classList.contains('on'), 'the HUD stayed up over the title');

  const termsKept = A.SETTINGS.difficulty;
  document.getElementById('btn-start').click();
  t.assert(A.STATE==='play' && A.lives===A.runLives, 'the run after RESTART SHIFT did not start whole');
  t.assert(A.SETTINGS.difficulty===termsKept, 'RESTART SHIFT wiped the chosen terms — preferences are not progress');

  A.STATE='play'; A.hideAll();
  console.log('  pause = the binder with a run page; manual and settings shared; terms chosen at the door; RESTART SHIFT two-stage');
});

/* The one screen between two levels, asserted on three axes because each of
   them can fail alone: the markup, the content (the next floor's briefing and
   the clock just left behind), and the behaviour (the floor under the card is
   real, its clock is frozen, ENTER lets go). */
test('the floor-clear card shows the clock left and the next floor', () => {
  const t = softAssert();
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

  /* The content: the briefing is the LEVELS row for the floor being entered. */
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
  t.assert(A.clearCard.leaks===spec.leaks && A.clearCard.lifeforms===spec.lifeforms,
    `the briefing says ${A.clearCard.leaks} bursts / ${A.clearCard.lifeforms} lifeforms, `+
    `LEVELS[1] says ${spec.leaks} / ${spec.lifeforms}`);
  t.assert(!els['screen-clear'].classList.contains('hidden'), 'show(\'clear\') left the card hidden');
  t.assert(els['screen-splash'].classList.contains('hidden')
      && els['screen-binder'].classList.contains('hidden'),
    'the clear card came up without dismissing the screens behind it');
  t.assert(els['hud'].classList.contains('on')===false, 'the HUD is still lit behind the clear card');

  /* An unstyled div inherits the body font, and a briefing nobody can read is a
     briefing nobody reads. */
  t.assert(/\.clear-next\{/.test(css), 'the clear card has no stylesheet rule — it ships unstyled');
  console.log(`  card: ${A.clearCard.leaks} bursts / ${A.clearCard.lifeforms} lifeforms on floor `+
    `${A.floorIdx+1}, ${A.clockText(A.clearCard.clock)} left on the floor behind it, ENTER to descend`);

  /* The floor under the card is real and its clock is not running. Driven through
     frame(), not update(): the freeze is the loop's gate, and a direct update()
     call is not a state a player is ever in. */
  t.assert(G.totalLeaks===spec.leaks && G.openLeaks===spec.leaks,
    `the floor under the card has ${G.openLeaks} of ${G.totalLeaks} bursts open — it is not built`);
  const c0 = G.clock;
  let now = Date.now();
  for (let i=0;i<120;i++) A.frame(now += 1000/60);   // two seconds of real frames
  t.assert(Math.abs(G.clock-c0) < 1e-9,
    `the clock moved from ${c0.toFixed(2)} to ${G.clock.toFixed(2)} while the card was up — `+
    'the card is not a frozen state, so reading the next floor costs the player time');

  /* ENTER lets go with every key released. */
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

  /* The last floor goes to the win card instead: there is no level six. */
  buildFloor(4, 24601);
  A.floorIdx=4;
  A.STATE = 'play';
  A.nextFloor();
  t.assert(A.STATE==='win',
    `clearing the fifth floor went to '${A.STATE}', want 'win' — the card must not appear with no floor after it`);;
});

/* The stub invents an element for any id index.html does not carry, so a write
   to a missing id succeeds and the player never sees it. Every id the game asked
   for must be in the markup, unless the game creates it at runtime. */
test('every id the game asks the document for exists in index.html', () => {
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

  console.log(`  ${asked.length} ids asked, all in index.html, ${RUNTIME.size} runtime ids allowed`);
});
