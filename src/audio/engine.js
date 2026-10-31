import { SETTINGS } from '../settings/store.js';

function noiseBed(a, buffer, gain, bus, {type, frequency, q, rate}){
  const filter=a.createBiquadFilter();
  filter.type=type; filter.frequency.value=frequency; filter.Q.value=q;
  filter.connect(gain);
  if (bus) gain.connect(bus);
  const source=a.createBufferSource(); source.buffer=buffer; source.loop=true;
  source.playbackRate.value=rate;
  source.connect(filter); source.start();
  return filter;
}

export const engine = {
  ctx:null, ok:false,
  droneGain:null, droneFilter:null,
  // The two continuous noise beds. See noiseFloor() and leakBed() in voices.js.
  floorGain:null, floorFilter:null,
  leakGain:null, leakFilter:null,
  beds:null, bedsVol:0.6,
  master:null, mute:null, masterVol:0.7, muted:false,

  init(){
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const a = this.ctx;

    /* On supporting Safari versions this lets Web Audio play with the ringer
       switch off. Missing on other browsers, and harmless if assignment throws. */
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (_) { /* not supported here */ }

    // One 2 second white-noise buffer, reused by the footsteps, the hiss, the sting and the beds
    const len = a.sampleRate * 2;
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i=0;i<len;i++) d[i] = Math.random()*2-1;
    this.noise = buf;

    this.master = a.createGain();
    this.master.gain.value = SETTINGS.master;
    /* Mute is its own node, after the volume. Folding it into the volume (set
       it to zero) would make the two settings fight: raising the volume while
       muted would bring the sound back. With a separate gain, M is M, the
       slider is the slider, and unmuting restores exactly the volume you had. */
    this.mute = a.createGain();
    this.mute.gain.value = SETTINGS.muted ? 0 : 1;
    this.master.connect(this.mute);
    /* A compressor between the mute and the speakers. Loud simultaneous sounds
       can sum past 0 dB and clip. It sits AFTER the mute so muting stays total,
       and after the master so it never fights the volume slider. The settings
       are gentle on purpose: this is a safety net, not a loudness effect. */
    this.comp = a.createDynamicsCompressor();
    this.comp.threshold.value = -3;
    this.comp.knee.value = 6;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.25;
    this.mute.connect(this.comp);
    this.comp.connect(a.destination);

    this.beds = a.createGain();
    this.beds.gain.value = SETTINGS.ambience;
    this.beds.connect(this.master);

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
       low sine under it that only comes up as the bar fills. It ramps over
       0.06 s: fast enough to answer the bar, slow enough that a 0.26 s sprint
       burst does not click. */
    this.floorGain = a.createGain();
    this.floorGain.gain.value = 0;
    this.floorFilter = noiseBed(a, buf, this.floorGain, this.beds,
      {type:'lowpass', frequency:200, q:0.7, rate:0.5});
    // A slow LFO on the gain, so the bed pulses like footsteps
    const slfo=a.createOscillator(); slfo.frequency.value=2.2;
    const slg=a.createGain(); slg.gain.value=0.03;
    slfo.connect(slg); slg.connect(this.floorGain.gain); slfo.start();
    // The pressure under it: inaudible while you walk, there when you wrench
    const fr=a.createOscillator(); fr.type='sine'; fr.frequency.value=74;
    const frg=a.createGain(); frg.gain.value=0.15;
    fr.connect(frg); frg.connect(this.floorGain); fr.start();

    /* --- THE LEAK BED.
       What an open leak sounds like: pressurised water, not a drip. One shared
       voice, driven by the leaks' TOTAL noise and quieter with distance to the
       nearest leak, so a burst pipe is something you can walk toward with
       your ears. */
    this.leakGain = a.createGain();
    this.leakGain.gain.value = 0;
    this.leakFilter = noiseBed(a, buf, this.leakGain, this.beds,
      {type:'bandpass', frequency:1400, q:0.6, rate:1.25});
    // gurgle: the same noise, lowpassed and breathing slowly
    const lg=noiseBed(a, buf, this.leakGain, null,
      {type:'lowpass', frequency:260, q:2, rate:0.55});
    const llfo=a.createOscillator(); llfo.frequency.value=0.7;
    const llg=a.createGain(); llg.gain.value=140;
    llfo.connect(llg); llg.connect(lg.frequency); llfo.start();

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
  unlock(){ this.resume(); },

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
    if (st === 'suspended' || st === 'interrupted')
      try { this.ctx.resume().catch(()=>{}); } catch(e){}
  },
};