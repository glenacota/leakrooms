import { SETTINGS } from '../settings/store.js';

export const engine = {
  ctx:null, ok:false,
  hum:null, humGain:null,
  hiss:null, hissGain:null,
  drone:null, droneGain:null, droneFilter:null,
  // The two continuous noise beds. See noiseFloor() and leakBed() in voices.js.
  floorGain:null, floorFilter:null,
  leakGain:null, leakFilter:null,
  /* The beds' own gain node, between the beds and the master. The continuous
     layers (hum, hiss, floor, leak, drone, title ambience) connect here instead
     of straight to master, so the ambience setting can turn them down without
     also turning down the one-shot SFX — the information channel stays at the
     master level while the atmosphere gets its own knob. */
  beds:null, bedsVol:0.6,
  master:null, mute:null, masterVol:0.7, muted:false,

  init(){
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const a = this.ctx;

    // One 2 second white-noise buffer, reused by the footsteps, the hiss, the sting and the beds
    const len = a.sampleRate * 2;
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i=0;i<len;i++) d[i] = Math.random()*2-1;
    this.noise = buf;

    /* --- MASTER. Every voice connects to this node and not to the
       destination, so one gain node is the whole volume control (and the
       settings panel drives it). It must connect onward to the mute node. An
       earlier version connected it to ITSELF, which is a closed loop: every
       voice fed a node that went nowhere, and the game was silent while
       everything else worked. The headless tests run with no AudioContext, so
       none of them could see it. The audio test now builds the graph and checks
       that it reaches the destination. */
    this.master = a.createGain();
    this.master.gain.value = SETTINGS.master;
    /* Mute is its own node, after the volume. Folding it into the volume (set
       it to zero) would make the two settings fight: raising the volume while
       muted would bring the sound back. With a separate gain, M is M, the
       slider is the slider, and unmuting restores exactly the volume you had. */
    this.mute = a.createGain();
    this.mute.gain.value = SETTINGS.muted ? 0 : 1;
    this.master.connect(this.mute);
    /* A compressor between the mute and the speakers. A door cycling while a
       wrench runs while a Stalker arrives can sum past 0 dB and clip, which is
       the loudest and ugliest sound the game could make. It sits AFTER the mute so
       muting stays total, and after the master so it never fights the volume
       slider. The settings are gentle on purpose: this is a safety net, not a
       loudness effect. */
    this.comp = a.createDynamicsCompressor();
    this.comp.threshold.value = -3;
    this.comp.knee.value = 6;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.25;
    this.mute.connect(this.comp);
    this.comp.connect(a.destination);

    /* --- BEDS BUS. Every continuous layer connects to this node and not to the
       master, so the ambience setting can turn the atmosphere down without
       touching the one-shot SFX. It sits before the mute and the master, so
       muting stays total and the volume slider still scales everything. */
    this.beds = a.createGain();
    this.beds.gain.value = SETTINGS.ambience;
    this.beds.connect(this.master);

    // --- 60Hz fluorescent hum + its 2nd/3rd harmonics ---
    this.humGain = a.createGain();
    this.humGain.gain.value = 0.035;
    this.humGain.connect(this.beds);
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
    hs.connect(hp); hp.connect(this.hissGain); this.hissGain.connect(this.beds);
    hs.start();

    // --- proximity drone (Lifeform) ---
    this.droneGain = a.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter = a.createBiquadFilter();
    this.droneFilter.type='lowpass'; this.droneFilter.frequency.value=180;
    this.droneGain.connect(this.droneFilter); this.droneFilter.connect(this.beds);
    const o1=a.createOscillator(); o1.type='sawtooth'; o1.frequency.value=41;
    const o2=a.createOscillator(); o2.type='sine';     o2.frequency.value=55.5;
    const g2=a.createGain(); g2.gain.value=0.6;
    o1.connect(this.droneGain); o2.connect(g2); g2.connect(this.droneGain);
    o1.start(); o2.start();

    /* --- THE NOISE FLOOR.
       A band-limited noise layer whose gain follows the HUD's NOISE bar, plus a
       low sine under it that only comes up as the bar fills. Every other noise
       source is a one-shot with a fixed peak, so without this layer the bar could
       fill while the mix stayed the same, and the meter and the speakers would be
       two instruments reporting two different numbers. It ramps over 0.06 s:
       fast enough to answer the bar, slow enough that a 0.26 s sprint burst does
       not click. */
    this.floorGain = a.createGain();
    this.floorGain.gain.value = 0;
    this.floorFilter = a.createBiquadFilter();
    this.floorFilter.type='lowpass';
    this.floorFilter.frequency.value=200; this.floorFilter.Q.value=0.7;
    this.floorFilter.connect(this.floorGain);
    this.floorGain.connect(this.beds);
    const fn=a.createBufferSource(); fn.buffer=buf; fn.loop=true;
    fn.playbackRate.value=0.5;
    fn.connect(this.floorFilter); fn.start();
    // A slow LFO on the gain, so the bed pulses like footsteps
    const slfo=a.createOscillator(); slfo.frequency.value=2.2;
    const slg=a.createGain(); slg.gain.value=0.03;
    slfo.connect(slg); slg.connect(this.floorGain.gain); slfo.start();
    // The pressure under it: inaudible while you walk, there when you wrench
    const fr=a.createOscillator(); fr.type='sine'; fr.frequency.value=74;
    const frg=a.createGain(); frg.gain.value=0.15;
    fr.connect(frg); frg.connect(this.floorGain); fr.start();

    /* --- THE LEAK BED.
       What an open pipe sounds like: pressurised water, not a drip. One shared
       voice, driven by the pipes' TOTAL noise and quieter with distance to the
       nearest open pipe, so a burst pipe is something you can walk toward with
       your ears. It stays under the wrench by construction, because the wrench
       has to remain the loudest decision in the game. */
    this.leakGain = a.createGain();
    this.leakGain.gain.value = 0;
    this.leakFilter = a.createBiquadFilter();
    this.leakFilter.type='bandpass';
    this.leakFilter.frequency.value=1400; this.leakFilter.Q.value=0.6;
    this.leakFilter.connect(this.leakGain);
    this.leakGain.connect(this.beds);
    const ln=a.createBufferSource(); ln.buffer=buf; ln.loop=true;
    ln.playbackRate.value=1.25;
    ln.connect(this.leakFilter); ln.start();
    // gurgle: the same noise, lowpassed and breathing slowly
    const lg=a.createBiquadFilter(); lg.type='lowpass'; lg.frequency.value=260; lg.Q.value=2;
    lg.connect(this.leakGain);
    const ln2=a.createBufferSource(); ln2.buffer=buf; ln2.loop=true;
    ln2.playbackRate.value=0.55;
    ln2.connect(lg); ln2.start();
    const llfo=a.createOscillator(); llfo.frequency.value=0.7;
    const llg=a.createGain(); llg.gain.value=140;
    llfo.connect(llg); llg.connect(lg.frequency); llfo.start();

    /* The saved settings are applied AFTER the graph exists. applySettings()
       runs at boot, before there is a node to reach, which used to make a saved
       "muted" be ignored for the whole session. `ok` goes true first because
       both setters check it. */
    this.ok = true;
    this.setMaster(SETTINGS.master);
    this.setMuted(SETTINGS.muted);
  },

  /* Live volume. It ramps instead of jumping, and the floor is a small value
     instead of zero: a gain that truly reaches 0 has to be re-primed on the next
     unmute, and 0.02 is inaudible in practice. */
  setMaster(v){
    this.masterVol = Math.max(0.02, Math.min(1, v));
    if (this.ok && this.master) this.master.gain.setTargetAtTime(this.masterVol, this.ctx.currentTime, 0.05);
  },

  /* M. Separate from the slider on purpose (see the mute node above). It ramps
     instead of jumping, so toggling it in the middle of a sound does not click. */
  setMuted(v){
    this.muted = !!v;
    if (this.ok && this.mute) this.mute.gain.setTargetAtTime(this.muted?0:1, this.ctx.currentTime, 0.04);
  },

  /* Live beds level. Same ramp pattern as setMaster, so changing it mid-session
     does not click. The floor is 0.02 for the same reason: a gain that truly
     reaches 0 has to be re-primed on the next change. */
  setBeds(v){
    this.bedsVol = Math.max(0.02, Math.min(1, v));
    if (this.ok && this.beds) this.beds.gain.setTargetAtTime(this.bedsVol, this.ctx.currentTime, 0.05);
  },

  /* Browsers will not start an AudioContext without a user gesture, so the
     context exists from boot and stays silent until the first key or click.
     Every key press and click that can start the game calls this.

     `interrupted` is a third state that Safari and Chrome reach on their own (an
     incoming call, unplugged headphones, a tab switch on some platforms). The
     game comes back to a context nothing will resume, so the next key or click
     does it. The promise's rejection is caught: an unhandled rejection reaches
     the error boundary and would show the fatal card over a game that works. */
  unlock(){
    const st = this.ctx && this.ctx.state;
    if (this.ctx && (st === 'suspended' || st === 'interrupted') && this.ctx.resume)
      this.ctx.resume().catch(()=>{});
  },

  /* Pausing also suspends the audio context. A paused game that keeps rendering
     into a live graph does work nobody hears, and on a laptop that can keep a fan
     going. suspend() stops the whole graph at once.

     resume() runs without a gesture, so a browser may refuse it. The game then
     stays silent until the next key press, whose unlock() always works. */
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
};