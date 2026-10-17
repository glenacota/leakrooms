export const voices = {
  powerVol(p){ return 0.8 + Math.min(2, Math.max(0, p||0))*1.3; },

  step(vol, power){                 // wet carpet footstep
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const k=this.powerVol(power);
    const s=a.createBufferSource(); s.buffer=this.noise;
    s.playbackRate.value = 0.7 + Math.random()*0.4;
    const f=a.createBiquadFilter(); f.type='lowpass'; f.frequency.value=520;
    const g=a.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.10*vol*k, t+0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.17);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t+0.2);
  },

  splash(vol, wet, power){         // footstep through standing water
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const k=this.powerVol(power);
    const s=a.createBufferSource(); s.buffer=this.noise;
    s.playbackRate.value = 1.1 + Math.random()*0.5;
    /* Deeper water is a lower, longer splash. Filtered LOW rather than high:
       the wet carpet step is already a lowpass, so a wet step has to move the
       other way to be distinguishable from a dry one at a glance. */
    const f=a.createBiquadFilter(); f.type='lowpass';
    f.frequency.value = 900 + wet*700;
    const g=a.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.11*vol*k, t+0.010);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.22);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t+0.25);
  },

  drip(vol){                      // the leak, at range — a positional cue
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const o=a.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(900+Math.random()*700, t);
    o.frequency.exponentialRampToValueAtTime(180, t+0.09);
    const f=a.createBiquadFilter(); f.type='lowpass'; f.frequency.value=2600;
    const g=a.createGain();
    /* 0.08 rather than 0.035: the drip is the only cue that says WHICH pipe, and
       at the old peak it was under the tape hiss from two rooms away. */
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.08*vol, t+0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.13);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+0.15);
  },

  wrench(power){                   // working the pipe — loud, on purpose
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const k=this.powerVol(power);
    for (let i=0;i<3;i++){
      const st = t + i*0.16 + Math.random()*0.05;
      const o=a.createOscillator(); o.type='square';
      o.frequency.setValueAtTime(240+Math.random()*160, st);
      o.frequency.exponentialRampToValueAtTime(90, st+0.12);
      const f=a.createBiquadFilter(); f.type='bandpass';
      f.frequency.value=1500; f.Q.value=4;
      const g=a.createGain();
      g.gain.setValueAtTime(0.0001,st);
      g.gain.exponentialRampToValueAtTime(0.085*k, st+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st+0.16);
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start(st); o.stop(st+0.18);
    }
  },

  seal(){                          // the pipe stops
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const o=a.createOscillator(); o.type='sawtooth';
    o.frequency.setValueAtTime(320,t);
    o.frequency.exponentialRampToValueAtTime(52,t+0.9);
    const f=a.createBiquadFilter(); f.type='lowpass';
    f.frequency.setValueAtTime(3200,t);
    f.frequency.exponentialRampToValueAtTime(180,t+0.9);
    const g=a.createGain();
    g.gain.setValueAtTime(0.14,t);
    g.gain.exponentialRampToValueAtTime(0.0001,t+1.1);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+1.2);
  },

  /* THE KUDOS — what a sealed floor sounds like. seal() turned the right way
     round: the same saw and the same filter sweep, but climbing instead of
     falling, and the hiss-stop underneath it is the noise bed being pulled
     shut as the chord opens. The room goes QUIET on success, which is the one
     thing sting() never does, and the quiet is the reward — the whole level
     has been four pipes hissing and something walking toward them.

     A major triad a fifth and a fourth up, staggered by 90ms and detuned a
     hair each side, so it lands as a chime on a tape deck rather than as a
     chord from an instrument. Nothing here is tuned to a key; there is no
     music in this building and the win sting is not going to start one. */
  acclaim(){
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    this.silenceBeds();                  // the old floor stops gurgling behind the card

    /* the hiss-stop */
    const s=a.createBufferSource(); s.buffer=this.noise;
    s.playbackRate.value = 0.8;
    const hf=a.createBiquadFilter(); hf.type='highpass'; hf.frequency.value=1800;
    const hg=a.createGain();
    hg.gain.setValueAtTime(0.10,t);
    hg.gain.exponentialRampToValueAtTime(0.0001,t+0.45);
    s.connect(hf); hf.connect(hg); hg.connect(this.master);
    s.start(t); s.stop(t+0.5);

    /* the rising seal — filter and pitch climbing together, the opposite sweep */
    const o=a.createOscillator(); o.type='sawtooth';
    o.frequency.setValueAtTime(96,t);
    o.frequency.exponentialRampToValueAtTime(392,t+0.55);
    const f=a.createBiquadFilter(); f.type='lowpass';
    f.frequency.setValueAtTime(600,t);
    f.frequency.exponentialRampToValueAtTime(3800,t+0.55);
    const g=a.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.11,t+0.05);
    g.gain.exponentialRampToValueAtTime(0.0001,t+0.8);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+0.9);

    /* the triad */
    const notes=[523.25, 659.25, 783.99];
    for(let i=0;i<3;i++){
      const n=a.createOscillator(); n.type='sine';
      n.frequency.value = notes[i] * (1 + (i-1)*0.0015);
      const ng=a.createGain();
      const st=t+i*0.09;
      ng.gain.setValueAtTime(0.0001,st);
      ng.gain.exponentialRampToValueAtTime(0.10/(i+1.4), st+0.02);
      ng.gain.exponentialRampToValueAtTime(0.0001, st+1.1);
      n.connect(ng); ng.connect(this.master);
      n.start(st); n.stop(st+1.2);
    }
  },

  rattle(vol){                     // wire shifting
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    for(let i=0;i<5;i++){
      const s=a.createBufferSource(); s.buffer=this.noise;
      s.playbackRate.value = 1.4 + Math.random();
      const f=a.createBiquadFilter(); f.type='bandpass';
      f.frequency.value = 1400+Math.random()*2600; f.Q.value=7;
      const g=a.createGain();
      const st=t+i*0.045+Math.random()*0.02;
      g.gain.setValueAtTime(0.0001,st);
      g.gain.exponentialRampToValueAtTime(0.05*vol, st+0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, st+0.07);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(st); s.stop(st+0.09);
    }
  },

  sting(){                         // caught
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const s=a.createBufferSource(); s.buffer=this.noise;
    const f=a.createBiquadFilter(); f.type='lowpass';
    f.frequency.setValueAtTime(5200,t);
    f.frequency.exponentialRampToValueAtTime(90,t+1.3);
    const g=a.createGain();
    g.gain.setValueAtTime(0.32,t);
    g.gain.exponentialRampToValueAtTime(0.0001,t+1.5);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t+1.6);
  },

  door(power){                    // heavy door cycling open
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const k=this.powerVol(power);
    const o=a.createOscillator(); o.type='sawtooth';
    o.frequency.setValueAtTime(70,t);
    o.frequency.exponentialRampToValueAtTime(28,t+1.1);
    const f=a.createBiquadFilter(); f.type='lowpass'; f.frequency.value=420;
    const g=a.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.16*k, t+0.08);
    g.gain.exponentialRampToValueAtTime(0.0001,t+1.2);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+1.3);
  },

  /* ---------- THE TWO NOISE BEDS ----------
     Continuous voices: they move a gain that already exists rather than building
     one per call. Both are driven from tickAudio, which is the only place that
     knows the current noise level. */

  /* The HUD bar, in the speakers. `level` is G.noise/NOISE_FS, so the mix IS
     the meter rather than a mood running alongside it. Gain follows the square,
     because a bar a third full should sound like a third of the way to
     shouting, not a third of shouting. */
  noiseFloor(level){
    if (!this.ok) return;
    const t=this.ctx.currentTime;
    const l=Math.max(0, Math.min(1, level||0));
    this.floorGain.gain.setTargetAtTime(l*l*0.11, t, 0.06);
    this.floorFilter.frequency.setTargetAtTime(500 + l*2600, t, 0.1);
  },

  /* The open pipes. `total` is their summed noise — the same number the
     water-blue floor of the bar draws — and `dist` the distance to the nearest
     one. Attenuation is squared so the pipe is a direction you can walk toward
     rather than a level that is simply always on. */
  leakBed(total, dist){
    if (!this.ok) return;
    const t=this.ctx.currentTime;
    const l=Math.max(0, Math.min(1, total||0));
    const near=Math.max(0, 1 - Math.max(0, dist==null?99:dist)/20);
    this.leakGain.gain.setTargetAtTime(l*near*near*0.16, t, 0.12);
    this.leakFilter.frequency.setTargetAtTime(1100 + near*2400, t, 0.15);
  },

  /* Both beds off. For death and for leaving play, where update() stops running
     and would otherwise freeze them at whatever they last were told. */
  silenceBeds(){
    if (!this.ok) return;
    const t=this.ctx.currentTime;
    this.floorGain.gain.setTargetAtTime(0, t, 0.15);
    this.leakGain.gain.setTargetAtTime(0, t, 0.2);
  },

  drone(level){
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const g = level * 0.16;
    this.droneGain.gain.setTargetAtTime(g, t, 0.35);
    this.droneFilter.frequency.setTargetAtTime(140 + (1-level)*40 + 90*level, t, 0.4);
  },
  silence(){ if (this.ok) this.droneGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); },

  /* Live volume. Ramped rather than assigned, and clamped to a small floor
     rather than to zero: a mute slider that truly reaches 0 leaves the graph
     in a state where a later unmute has to re-prime it, and a 0.0001 gain is
     inaudible in practice. */
  blip(up){
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const o=a.createOscillator(); o.type='sine'; o.frequency.value = up?520:390;
    const g=a.createGain(); g.gain.value=0.0001;
    g.gain.exponentialRampToValueAtTime(0.05, t+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.22);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+0.25);
  },

  /* ---------- THE SPLASH BED ----------
     A title screen with a noise floor and a held chord under it, so the first
     thing you hear is the building rather than a menu. Three layers, all
     synthesised, all very slow:

       ROOM   filtered noise, the band drifting under 0.04Hz. Air handling in an
              empty corridor. This is the "noise" half of the brief and it does
              most of the work — it is the layer you stop hearing, which is the
              point of putting it in.
       PAD    three detuned saws (A1, A1 a third of a semitone up, E2) through
              a lowpass whose cutoff is itself drifting at 0.02Hz. Low key,
              literally: nothing here is above 165Hz.
       NOTES  one triangle note every 7-14 seconds out of A minor pentatonic,
              two seconds of attack and six of release. "Very slow" here is a
              scheduling decision, not a tempo — there is no tempo.

     Notes are scheduled a second ahead from an interval rather than fired by a
     timeout at the moment they are due: setTimeout drifts by tens of
     milliseconds and an LFO with a twenty second period cares about that. */
};
