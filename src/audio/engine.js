import { SETTINGS } from '../settings/store.js';

export const engine = {
  ctx:null, ok:false,
  hum:null, humGain:null,
  hiss:null, hissGain:null,
  drone:null, droneGain:null, droneFilter:null,
  /* The two continuous noise beds. See noiseFloor() and leakBed(). */
  floorGain:null, floorFilter:null,
  leakGain:null, leakFilter:null,
  master:null, mute:null, masterVol:0.7, muted:false,

  init(){
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const a = this.ctx;

    // 2s white-noise buffer, reused for hiss / steps / sting
    const len = a.sampleRate * 2;
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i=0;i<len;i++) d[i] = Math.random()*2-1;
    this.noise = buf;

    /* --- MASTER. Every voice below connects to this and not to destination.
       There is no other way to make a volume slider: each of the eleven voices
       used to wire itself straight to the speakers, so turning the game down
       meant editing eleven call sites. One node in front of all of them is the
       whole feature. It is also the node the settings modal drives, and it is
       created before anything connects to it.

       ...and it connects to the DESTINATION. This line read
       `connect(this.master)` — the master wired to itself — which builds a closed
       loop: every voice in the game chains up into a node that goes nowhere, and
       the result is total silence that behaves perfectly in every other
       respect. No voice is missing, no voice throws, the master gain tracks the
       slider; the graph simply terminates in a circle.

       It survived because the headless harness runs with no AudioContext at all,
       so every voice method returns on `if (!this.ok)` before it builds a node —
       a graph bug is only findable by building the graph, so the suite now does
       that too. */
    this.master = a.createGain();
    this.master.gain.value = SETTINGS.master;
    /* MUTE IS ITS OWN NODE, downstream of the volume slider. It used to be
       folded into the master by pushing the slider to zero, which reads as a
       game with no sound rather than a game you have turned the sound off, and
       — worse — makes the two settings fight: raise the volume while muted and
       the sound comes back by surprise. A separate gain means M is M, the slider
       is the slider, and unmuting restores exactly the volume you had. */
    this.mute = a.createGain();
    this.mute.gain.value = SETTINGS.muted ? 0 : 1;
    this.master.connect(this.mute);
    /* THE COMPRESSOR, between the mute and the speakers. Twelve voices all
       peaking at once is a thing this mix actually does — a door cycling while
       a wrench is running while a stalker arrives — and without a limiter those
       peaks sum past 0dB and clip, which on a laptop speaker is the loudest,
       ugliest and least controllable sound the game can make. It sits AFTER the
       mute rather than before it so that muting is still total, and after the
       master so it never fights the volume slider. The settings are gentle on
       purpose: this is a safety net against clipping, not a loudness contest
       (the browser's own defaults are a 12:1 ratio above -24dB, which would
       flatten a mix that was never in trouble). */
    this.comp = a.createDynamicsCompressor();
    this.comp.threshold.value = -3;
    this.comp.knee.value = 6;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.25;
    this.mute.connect(this.comp);
    this.comp.connect(a.destination);

    // --- 60Hz fluorescent hum + its 2nd/3rd harmonics ---
    this.humGain = a.createGain();
    this.humGain.gain.value = 0.035;
    this.humGain.connect(this.master);
    [[60,0.55],[120,0.3],[180,0.12]].forEach(([f,g])=>{
      const o = a.createOscillator(); o.type='sine'; o.frequency.value=f;
      const gg = a.createGain(); gg.gain.value=g;
      o.connect(gg); gg.connect(this.humGain); o.start();
    });

    // --- tape hiss ---
    this.hissGain = a.createGain();
    this.hissGain.gain.value = 0.006;
    const hp = a.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=3800;
    const hs = a.createBufferSource(); hs.buffer=buf; hs.loop=true;
    hs.connect(hp); hp.connect(this.hissGain); this.hissGain.connect(this.master);
    hs.start();

    // --- proximity drone (Lifeform) ---
    this.droneGain = a.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter = a.createBiquadFilter();
    this.droneFilter.type='lowpass'; this.droneFilter.frequency.value=180;
    this.droneGain.connect(this.droneFilter); this.droneFilter.connect(this.master);
    const o1=a.createOscillator(); o1.type='sawtooth'; o1.frequency.value=41;
    const o2=a.createOscillator(); o2.type='sine';     o2.frequency.value=55.5;
    const g2=a.createGain(); g2.gain.value=0.6;
    o1.connect(this.droneGain); o2.connect(g2); g2.connect(this.droneGain);
    o1.start(); o2.start();

    /* --- THE NOISE FLOOR.
       A bandpassed noise layer whose gain IS the HUD's NOISE bar, plus a low
       sine under it that only comes up as the bar fills. This is the layer that
       makes the meter and the mix the same fact: every noise source in the game
       is a one-shot with a fixed peak, so a bar that fills and a mix that does
       not change are two different instruments reporting two different
       numbers. It ramps at 0.06s — fast enough to answer the bar, slow enough
       that a 0.26s sprint burst does not click. */
    this.floorGain = a.createGain();
    this.floorGain.gain.value = 0;
    this.floorFilter = a.createBiquadFilter();
    this.floorFilter.type='lowpass';
    this.floorFilter.frequency.value=1200; this.floorFilter.Q.value=0.7;
    this.floorFilter.connect(this.floorGain);
    this.floorGain.connect(this.master);
    const fn=a.createBufferSource(); fn.buffer=buf; fn.loop=true;
    fn.playbackRate.value=0.5;
    fn.connect(this.floorFilter); fn.start();
    /* scuff cadence: a slow LFO on the gain so the bed pulses like footsteps */
    const slfo=a.createOscillator(); slfo.frequency.value=2.2;
    const slg=a.createGain(); slg.gain.value=0.03;
    slfo.connect(slg); slg.connect(this.floorGain.gain); slfo.start();
    /* the pressure under it — inaudible while you walk, there when you wrench */
    const fr=a.createOscillator(); fr.type='sine'; fr.frequency.value=74;
    const frg=a.createGain(); frg.gain.value=0.55;
    fr.connect(frg); frg.connect(this.floorGain); fr.start();

    /* --- THE LEAK BED.
       What an open pipe actually sounds like: pressurised water, not a drip.
       One shared voice, gain driven by the pipes' TOTAL noise and pulled down
       with distance to the nearest open one, so a burst pipe is something you
       can walk toward with your ears. It is under the wrench by construction —
       the wrench has to stay the loudest decision in the game. */
    this.leakGain = a.createGain();
    this.leakGain.gain.value = 0;
    this.leakFilter = a.createBiquadFilter();
    this.leakFilter.type='bandpass';
    this.leakFilter.frequency.value=1400; this.leakFilter.Q.value=0.6;
    this.leakFilter.connect(this.leakGain);
    this.leakGain.connect(this.master);
    const ln=a.createBufferSource(); ln.buffer=buf; ln.loop=true;
    ln.playbackRate.value=1.25;
    ln.connect(this.leakFilter); ln.start();
    /* gurgle: the same noise, lowpassed and breathing slowly */
    const lg=a.createBiquadFilter(); lg.type='lowpass'; lg.frequency.value=260; lg.Q.value=2;
    lg.connect(this.leakGain);
    const ln2=a.createBufferSource(); ln2.buffer=buf; ln2.loop=true;
    ln2.playbackRate.value=0.55;
    ln2.connect(lg); ln2.start();
    const llfo=a.createOscillator(); llfo.frequency.value=0.7;
    const llg=a.createGain(); llg.gain.value=140;
    llfo.connect(llg); llg.connect(lg.frequency); llfo.start();

    /* The store is applied AFTER the graph exists rather than before, because
       applySettings() runs at boot and could not reach a node that had not been
       built yet — which is how a restored "muted" used to be silently ignored
       for the whole session. `ok` goes true first: both setters guard on it. */
    this.ok = true;
    this.setMaster(SETTINGS.master);
    this.setMuted(SETTINGS.muted);
  },

  /* How much louder a one-shot sounds for making more noise. Without it every
     voice had a fixed peak and the two loudest things in the game — a sprint at
     1.0 and a wrench at 0.85 — were only distinguishable by the HUD. Walking
     (0.22) comes out at 1.09x, sprinting at 2.0x, so the bar and the speakers
     finally agree. Applied to the peaks, never to the master: this is the mix,
     not the volume slider. */
  setMaster(v){
    this.masterVol = Math.max(0.02, Math.min(1, v));
    if (this.ok && this.master) this.master.gain.setTargetAtTime(this.masterVol, this.ctx.currentTime, 0.05);
  },

  /* M. Separate from the slider by design — see the note where the node is
     built. Ramps rather than jumps, so toggling it mid-chord does not click. */
  setMuted(v){
    this.muted = !!v;
    if (this.ok && this.mute) this.mute.gain.setTargetAtTime(this.muted?0:1, this.ctx.currentTime, 0.04);
  },

  /* Browsers will not let an AudioContext start without a user gesture, so the
     context exists from boot and stays silent until the first key or click.
     Every interaction that can start the game already runs through one of the
     two entry points that call this, so there is nothing to add to the wiring.

     `interrupted` is the third state and it is the one Safari and Chrome reach
     on their own — an incoming call, a headphone unplug, a tab switch on some
     platforms — so the game comes back to a suspended context that nothing is
     going to resume. The gesture that gets the player back is the next key or
     click, which is what this is. The promise is dropped rather than left
     floating: a refused resume rejects, and an unhandled rejection now reaches
     the error boundary and puts the fatal card over a game that is working
     perfectly. */
  unlock(){
    const st = this.ctx && this.ctx.state;
    if (this.ctx && (st === 'suspended' || st === 'interrupted') && this.ctx.resume)
      this.ctx.resume().catch(()=>{});
  },

  /* The pause holds the clock, the flood and the simulation — and now the audio
     context too. A paused game that is still rendering into a live graph is
     doing work nobody is listening to, and on a laptop that is the difference
     between a tab that idles and a tab that keeps a fan going. `suspend()` is
     the one call that stops all of it at once.

     resume() is called without a gesture, so a browser that refuses it will
     refuse it; the game stays silent until the next key, which calls unlock()
     with a gesture and is the path that always works. */
  suspend(){
    if (!this.ctx) return;
    try { if (this.ctx.state === 'running' && this.ctx.suspend) this.ctx.suspend().catch(()=>{}); }
    catch(e){ /* a context that will not suspend is not worth a fatal card */ }
  },
  resume(){
    if (!this.ctx) return;
    const st = this.ctx.state;
    if ((st === 'suspended' || st === 'interrupted') && this.ctx.resume)
      try { this.ctx.resume().catch(()=>{}); } catch(e){}
  },

  /* A soft confirmation tone, so pressing M is never a guess. Deliberately not
     one of the game's own sounds: this is the shell talking, not the building,
     and reusing a footstep for a UI acknowledgement is how a control ends up
     sounding like it broke something. */
};
