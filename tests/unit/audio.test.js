import test from 'node:test';
import { fakeAudioContext } from '../helpers/stubs.js';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';

const { A } = await loadGame();


/* ============ TEST 23: the audio graph actually reaches the speakers ===
   Every other test in this file runs with no AudioContext at all, so `Audio_.ok`
   is false and every voice method returns on its first line without building a
   node. That is the right way to test the fallback — and it means a game that
   makes no sound whatsoever looks identical to a game that makes all of it.

   It was one line. The master gain was connected to ITSELF:

       this.master.connect(this.master);

   which is a closed loop: every voice in the game chains up into a node that
   goes nowhere. No voice is missing, nothing throws, the volume slider tracks
   the setting — the graph simply terminates in a circle, so the game is silent
   from the splash screen to the win screen and no assertion here could see it.

   So this builds the graph for real and walks it. */
test('[23] audio — the graph reaches the destination', () => {
  const t = softAssert();
console.log('[23] audio — the graph reaches the destination');
{
  /* no AudioContext at all: the fallback must be a no-op, not a crash */
  t.assert(global.window.AudioContext===undefined, 'the fallback path is not being tested');
  const before = A.Audio_.ok;
  t.assert(before===false, 'audio came up without an AudioContext — the fallback is not guarded');
  A.Audio_.step(1); A.Audio_.seal(); A.Audio_.drone(1,0);
  t.assert(global.__audioNodes.length===0, 'the no-AudioContext path built nodes anyway');

  /* now give it one, and build the whole thing */
  global.__audioNodes.length = 0;
  const ctx = fakeAudioContext();
  global.window.AudioContext = function(){ return ctx; };
  A.Audio_.ctx = null; A.Audio_.ok = false;
  A.Audio_.init();
  t.assert(A.Audio_.ok===true, 'Audio_.init did not come up with a context available');
  t.assert(A.Audio_.ctx===ctx, 'Audio_.init did not keep the context it created');

  /* reachability: follow the wires from the master to the speakers. A node
     that feeds an AudioParam counts as connected — an LFO driving a filter
     cutoff has no node-path to the speakers and is not supposed to have one. */
  const reaches = (start, dest)=>{
    const seen = new Set(), q = [start];
    while (q.length){
      const n = q.pop();
      if (n===dest || (n && n._mod)) return true;
      if (!n || seen.has(n)) continue;
      seen.add(n);
      for (const o of (n._out||[])) q.push(o);
    }
    return false;
  };
  t.assert(reaches(A.Audio_.master, ctx.destination),
    'the master gain does not reach the audio destination — the game is silent');
  t.assert(A.Audio_.master._out.indexOf(A.Audio_.master) < 0,
    'the master gain is connected to itself');

  /* every voice the game builds has to end up in that graph too, or it is a
     node that runs for the whole session and reaches nobody */
  const orphans = global.__audioNodes.filter(n=>!reaches(n, ctx.destination));
  t.assert(orphans.length===0,
    `${orphans.length} audio nodes reach nothing (${orphans.slice(0,4).map(n=>n.kind).join(', ')})`+
    ' — the voices built so far are inaudible');

  /* and the long-running ones have to be running */
  const started = global.__audioNodes.filter(n=>n._starts>0).length;
  t.assert(started>=5, `only ${started} nodes were started — the hum, the hiss and the drone are silent`);

  /* every one-shot voice: build it and check it lands */
  /* Every VOICE, driven with plausible arguments. Enumerated from the object
     itself so a new sound cannot skip the test — with the shell's own methods
     named out, because those move gains and start timers rather than making a
     sound, and "built no nodes" is the correct answer for all of them. */
  const SHELL = ['init','setMaster','setMuted','setBeds','unlock','suspend','resume','ambience',
                 '_ambStart','_ambTick','_ambStop','_ambNote',
                 /* the two continuous noise beds, their silencer, and the
                    gain curve they share with the one-shots: all four move gains
                    that already exist, so "built no nodes" is the right answer */
                 'noiseFloor','leakBed','silenceBeds','powerVol'];
  const oneShots = Object.keys(A.Audio_).filter(k=>typeof A.Audio_[k]==='function'
                                               && !SHELL.includes(k));
  t.assert(oneShots.length>=9, `only found ${oneShots.length} voices on Audio_`);
  for (const name of oneShots){
    const args = new Array(A.Audio_[name].length).fill(0.5);
    const n0 = global.__audioNodes.length;
    A.Audio_[name](...args);
    const made = global.__audioNodes.length - n0;
    /* silence/drone/setMaster are continuous, not one-shots: they move an
       existing gain rather than building a voice, so they legitimately build
       nothing. */
    const continuous = (name==='silence'||name==='drone');
    t.assert(continuous || made>0, `Audio_.${name} built no nodes — it is inaudible`);
    const dead = global.__audioNodes.slice(n0).filter(n=>!reaches(n, ctx.destination));
    t.assert(dead.length===0, `Audio_.${name} built ${dead.length} nodes that reach nothing`);
  }

  /* ---------- THE MIX FOLLOWS THE METER ----------
     Every voice in the game is a one-shot with a fixed peak, so the bar could
     fill to its top and the speakers would not move: a sprint (1.0) and a walk
     (0.22) were 2x and 1x of the same hand-picked number, while the HUD read a
     percentage of the BATTERY maximum. Three claims here — the bed's gain
     rises with the level it is handed, the leak bed rises with the pipes and
     falls with distance, and a louder action is a louder voice. */
  {
    const gainOf = n => n.gain._scheduled;
    A.Audio_.noiseFloor(0);   const quiet = gainOf(A.Audio_.floorGain);
    A.Audio_.noiseFloor(0.5); const mid   = gainOf(A.Audio_.floorGain);
    A.Audio_.noiseFloor(1);   const full  = gainOf(A.Audio_.floorGain);
    t.assert(quiet===0, 'the noise floor is not silent at zero');
    t.assert(mid>quiet && full>mid,
      `the noise bed does not follow the bar (${quiet}, ${mid}, ${full}) — the HUD and the mix are two instruments`);

    A.Audio_.leakBed(0.5, 0);   const near = gainOf(A.Audio_.leakGain);
    A.Audio_.leakBed(0.5, 15);  const midD = gainOf(A.Audio_.leakGain);
    A.Audio_.leakBed(0.5, 40);  const far  = gainOf(A.Audio_.leakGain);
    A.Audio_.leakBed(0, 0);     const none = gainOf(A.Audio_.leakGain);
    t.assert(near>midD && midD>far && far===0,
      `the leak bed ignores distance (${near}, ${midD}, ${far}) — an open pipe has to be somewhere you can walk toward`);
    t.assert(none===0, 'a building with no water in it still has water noise in the mix');

    A.Audio_.silenceBeds();
    t.assert(gainOf(A.Audio_.floorGain)===0 && gainOf(A.Audio_.leakGain)===0,
      'silenceBeds left a bed open — update() has stopped, so nothing will close it');
  }

  /* ...and the one-shots are louder when they are making more noise. The peak
     is the MAX of what the gain was told, not its last value: a one-shot
     schedules an attack and then a decay to silence, so the last number is
     always 0.0001 and every voice would tie. */
  {
    const peak = (fn, ...args) => {
      const n0 = global.__audioNodes.length;
      fn(...args);
      let hi = 0;
      for (const n of global.__audioNodes.slice(n0))
        for (const v of (n.gain._hist||[])) if (v>hi) hi=v;
      return hi;
    };
    const walk   = peak(()=>A.Audio_.step(1, 0.22));
    const sprint = peak(()=>A.Audio_.step(1, A.SPRINT_NOISE));
    t.assert(sprint > walk*1.5,
      `a sprinting footstep peaks at ${(sprint/walk).toFixed(2)}x a walking one — the mix does not know you are running`);
    const wrench = peak(()=>A.Audio_.wrench(A.REPAIR_NOISE));
    const door   = peak(()=>A.Audio_.door(A.DOOR_NOISE));
    t.assert(wrench > walk, 'the wrench is quieter than a footstep');
    t.assert(door >= wrench, 'cycling the door is quieter than the wrench');
  }

  /* ---------- the splash bed ----------
     The title screen is the only place this plays, so "it is on while you are
     looking at the title" and "it stops when the run starts" are the two claims
     worth making, and neither is visible from the graph alone. */
  {
    const n0 = global.__audioNodes.length;
    A.Audio_.ambience(true);
    t.assert(A.Audio_.ambOn===true, 'ambience(true) did not turn the bed on');
    t.assert(global.__audioNodes.length > n0, 'the bed built no nodes — the title screen is silent');
    t.assert(A.Audio_._ambTimer, 'the bed has no scheduler — no note will ever be played');
    const dead = global.__audioNodes.slice(n0).filter(n=>!reaches(n, ctx.destination));
    t.assert(dead.length===0, `${dead.length} ambience nodes reach nothing — the bed is inaudible`);

    /* the scheduler actually schedules: push the clock forward and tick it */
    const before = global.__audioNodes.length;
    ctx.currentTime = 400;
    A.Audio_._ambTick();
    t.assert(global.__audioNodes.length > before,
      'the note scheduler built nothing after half a minute — the "music" is three drones');

    /* and it is quiet by construction: a bed that can out-loud the wrench is
       not a bed. Every voice it owns must start well under LOUD. */
    A.Audio_.ambience(false);
    t.assert(A.Audio_.ambOn===false, 'ambience(false) did not turn the bed off');
    t.assert(A.Audio_._ambTimer===null, 'the note scheduler survived the bed — it will keep firing forever');
    t.assert(A.Audio_.amb===null, 'the ambience graph was left attached after stopping');
    A.Audio_.ambience(true); A.Audio_.ambience(false);   // idempotent either way
  }

  /* M is a separate node from the volume slider, so the two cannot undo each
     other: dragging the volume while muted must not unmute. Read the SCHEDULED
     gain, which is what setTargetAtTime is told, not `.value`, which a real
     AudioParam does not write back when you schedule a ramp. */
  {
    A.Audio_.setMuted(true);
    t.assert(A.Audio_.mute.gain._scheduled===0, 'muting did not close the mute gain');
    A.Audio_.setMaster(1);
    t.assert(A.Audio_.mute.gain._scheduled===0, 'raising the volume unmuted the game — the two settings are the same node');
    t.assert(A.Audio_.master.gain._scheduled===1, 'the volume slider stopped working while muted');
    A.Audio_.setMuted(false);
    t.assert(A.Audio_.mute.gain._scheduled===1, 'unmuting did not reopen the mute gain');
    t.assert(reaches(A.Audio_.mute, ctx.destination), 'the mute node does not reach the speakers');

    /* ...and going through the SETTINGS STORE, not the audio method directly,
       has to move the same node. This is the exact shape of the bug where
       applySettings pushed the volume slider and forgot the mute: the flag
       saved, survived a reload, toasted "AUDIO MUTED", and left the speakers
       exactly as they were. A setting that appears to work is worse than one
       that visibly does not. */
    A.setOption('muted', true);
    t.assert(A.Audio_.mute.gain._scheduled===0,
      'the stored mute flag is set and the audio node is still open — the setting does nothing');
    A.setOption('muted', false);
    t.assert(A.Audio_.mute.gain._scheduled===1, 'unmuting through the store did not reopen the node');
    A.setOption('muted', false);
  }

  /* the volume slider is the one thing in front of all of them */
  A.Audio_.setMaster(0);
  t.assert(A.Audio_.masterVol===0.02, `muting gave ${A.Audio_.masterVol}, not the documented floor`);
  A.Audio_.setMaster(1);
  t.assert(A.Audio_.masterVol===1, 'the master volume does not track the setting');

  /* and it all has to survive being called with no context, which is what a
     browser that refuses to start one does */
  let threw='';
  A.Audio_.ctx = null; A.Audio_.ok = false;
  for (const name of oneShots) A.Audio_[name](...new Array(A.Audio_[name].length).fill(0.5));
  for (const name of SHELL) { try { A.Audio_[name](false); } catch(e){ threw=String(e && e.message); } }
  t.assert(!threw, 'a shell method threw with no audio context: '+threw);
  A.Audio_.silence(); A.Audio_.setMaster(0.5);
  console.log(`  ${global.__audioNodes.length} nodes built, all reaching the destination; `+
    `${oneShots.length} one-shots wired; muted to ${A.Audio_.masterVol}, no-context path is a no-op`);
  global.window.AudioContext = undefined;
}
  t.done();
});


/* ---- the mix when the run stops ------------------------------------------
   Two continuous voices are driven from update(), and update() stops the
   instant the run does. If the state change does not close them, the noise
   floor and the drone sit at whatever the last frame told them — under the
   pause ticket, under the death card, and under the WIN screen, where the run
   ends without a clock to run out. The win path was the sharpest version of
   this: it changed state by hand and never announced it, so nothing in the
   audio side ever heard that the game had finished. */
test('[42] leaving play closes the mix, and pausing stops the context', () => {
  const t = softAssert();
console.log('[42] leaving play closes the mix, and pausing stops the context');
{
  /* A real graph again — test 23 tears its own down at the end. */
  const ctx = fakeAudioContext();
  global.window.AudioContext = function(){ return ctx; };
  A.Audio_.ctx = null; A.Audio_.ok = false;
  A.Audio_.init();
  const gainOf = n => n.gain._scheduled;

  /* A loud, wet, hunted floor. */
  A.Audio_.noiseFloor(0.9);
  A.Audio_.drone(0.8);
  t.assert(gainOf(A.Audio_.floorGain) > 0 && gainOf(A.Audio_.droneGain) > 0,
    'the beds did not open — there is nothing here to close');

  /* ...and the win. nextFloor() past the last floor is the one path that used
     to change state without telling anybody. */
  A.floorIdx = A.FLOORS;
  A.nextFloor();
  t.assert(A.STATE==='win', `nextFloor() on the last floor left STATE '${A.STATE}', want 'win'`);
  t.assert(gainOf(A.Audio_.floorGain)===0,
    `the noise floor is still at ${gainOf(A.Audio_.floorGain)} under the win card — update() stopped and nothing closed it`);

  /* The pause, which is the same bug with a screen on it. */
  A.STATE = 'play';
  A.Audio_.noiseFloor(0.9);
  A.Audio_.drone(0.9);
  A.togglePause();
  t.assert(A.STATE==='pause', `togglePause() left STATE '${A.STATE}', want 'pause'`);
  t.assert(gainOf(A.Audio_.droneGain)===0,
    `the drone is still at ${gainOf(A.Audio_.droneGain)} under the pause ticket`);
  t.assert(gainOf(A.Audio_.floorGain)===0,
    `the noise floor is still at ${gainOf(A.Audio_.floorGain)} under the pause ticket`);
  t.assert(ctx.state==='suspended',
    `a paused game leaves the audio context '${ctx.state}' — a suspended context is the one call that stops the whole graph`);

  /* ...and the run comes back, graph and all. */
  A.togglePause();
  t.assert(A.STATE==='play', `unpausing left STATE '${A.STATE}'`);
  t.assert(ctx.state==='running', `the context stayed '${ctx.state}' after the run resumed`);

  /* Mute is still total, which is why the compressor sits after it. */
  A.Audio_.setMuted(true);
  t.assert(A.Audio_.mute.gain._scheduled===0, 'muting stopped working with the compressor in the chain');
  A.Audio_.setMuted(false);

  global.window.AudioContext = undefined;
  A.Audio_.ctx = null; A.Audio_.ok = false;
  console.log('  win card and pause both close the beds and the drone; the context sleeps and wakes');
}
  t.done();
});

test('[AUDIO] audioSession type playback on iOS Safari, harmless when absent or throwing', () => {
  const t = softAssert();
console.log('[AUDIO] audioSession type playback on iOS Safari, harmless when absent or throwing');
{
  const ctx = fakeAudioContext();
  global.window.AudioContext = function(){ return ctx; };
  const realNav = globalThis.navigator;
  const navIsObject = typeof realNav === 'object' && realNav !== null;
  const nav = navIsObject ? realNav : {};
  const navDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const realAudioSession = nav.audioSession;

  try {
    if (!navIsObject) {
      A.Audio_.ctx = null; A.Audio_.ok = false;
      A.Audio_.init();
      t.assert(A.Audio_.ok === true, 'audio did not come up without navigator');
      Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
    }

    /* present: audioSession exists and its type is set to playback */
    let sessionType = null;
    const session = { get type(){ return sessionType; }, set type(v){ sessionType = v; } };
    Object.defineProperty(nav, 'audioSession', { get(){ return session; }, configurable: true });
    A.Audio_.ctx = null; A.Audio_.ok = false;
    A.Audio_.init();
    t.assert(sessionType === 'playback', `audioSession.type is '${sessionType}', want 'playback'`);
    
    /* absent: harmless, audio still comes up */
    Object.defineProperty(nav, 'audioSession', { value: undefined, configurable: true, writable: true });
    A.Audio_.ctx = null; A.Audio_.ok = false;
    A.Audio_.init();
    t.assert(A.Audio_.ok === true, 'audio did not come up without audioSession');

    /* assignment throws: harmless, audio still comes up */
    const throwing = { set type(_){ throw new Error('audioSession not assignable'); } };
    Object.defineProperty(nav, 'audioSession', { get(){ return throwing; }, configurable: true });
    A.Audio_.ctx = null; A.Audio_.ok = false;
    let threw = '';
    try { A.Audio_.init(); } catch(e){ threw = String(e && e.message); }
    t.assert(!threw, `audioSession assignment throw was not caught: ${threw}`);
    t.assert(A.Audio_.ok === true, 'audio did not come up when audioSession assignment throws');
  } finally {
    if (realAudioSession === undefined){
      try { delete nav.audioSession; } catch(_) {}
    } else {
      Object.defineProperty(nav, 'audioSession', { value: realAudioSession, configurable: true, writable: true });
    }
    if (!navIsObject) {
      if (navDescriptor) Object.defineProperty(globalThis, 'navigator', navDescriptor);
      else delete globalThis.navigator;
    }
    global.window.AudioContext = undefined;
    A.Audio_.ctx = null; A.Audio_.ok = false;
  }
  console.log('  audioSession set to playback when present, harmless when absent or throwing');
}
  t.done();
});
