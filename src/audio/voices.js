export const voices = {
  powerVol(p){ return 0.8 + Math.min(2, Math.max(0, p||0))*1.3; },

  step(vol, power){                 // rubber sole on damp concrete thud
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const k=this.powerVol(power);
    const o=a.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(80*k?80:80, t);
    o.frequency.exponentialRampToValueAtTime(40, t+0.08);
    const g=a.createGain();
    g.gain.setValueAtTime(0.12*vol*k, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.09);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+0.1);
  },

  splash(vol, wet, power){         // wet boot squelch with low thump
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const k=this.powerVol(power);
    const s=a.createBufferSource(); s.buffer=this.noise;
    const f=a.createBiquadFilter(); f.type='lowpass';
    f.frequency.value = 600;
    const g=a.createGain();
    g.gain.setValueAtTime(0.10*vol*k, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.25);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t+0.3);
    const o=a.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(40, t+0.2);
    const g2=a.createGain();
    g2.gain.setValueAtTime(0.08*vol*k, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t+0.22);
    o.connect(g2); g2.connect(this.master);
    o.start(t); o.stop(t+0.25);
  },

  drip(vol){                      // single water drop with a short echo (more "pipe")
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const o=a.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(900+Math.random()*300, t);
    o.frequency.exponentialRampToValueAtTime(180, t+0.09);
    const g=a.createGain();
    g.gain.setValueAtTime(0.08*vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.13);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+0.15);
    // short echo
    const del=a.createDelay(); del.delayTime.value=0.12;
    const fb=a.createGain(); fb.gain.value=0.3;
    const eg=a.createGain(); eg.gain.value=0.4;
    g.connect(del); del.connect(fb); fb.connect(del); del.connect(eg); eg.connect(this.master);
  },

  wrench(power){                   // ratchet clicks with metallic clank
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const k=this.powerVol(power);
    for (let i=0;i<5;i++){
      const st=t+i*0.09;
      const o=a.createOscillator(); o.type='square';
      o.frequency.value=1200;
      const g=a.createGain();
      g.gain.setValueAtTime(0.07*k, st);
      g.gain.exponentialRampToValueAtTime(0.0001, st+0.05);
      o.connect(g); g.connect(this.master);
      o.start(st); o.stop(st+0.06);
    }
  },

  seal(){                          // valve closing clunk + pressure drop
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const o=a.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(90,t);
    o.frequency.exponentialRampToValueAtTime(50,t+0.4);
    const g=a.createGain();
    g.gain.setValueAtTime(0.14,t);
    g.gain.exponentialRampToValueAtTime(0.0001,t+0.45);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+0.5);
    const c=a.createOscillator(); c.type='square'; c.frequency.value=400;
    const gc=a.createGain();
    gc.gain.setValueAtTime(0.10,t+0.05);
    gc.gain.exponentialRampToValueAtTime(0.0001,t+0.12);
    c.connect(gc); gc.connect(this.master);
    c.start(t+0.05); c.stop(t+0.15);
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
    const notes=[392,494,587,784];
    notes.forEach((f,i)=>{
      const o=a.createOscillator(); o.type='sine'; o.frequency.value=f;
      const g=a.createGain();
      const st=t+i*0.1;
      g.gain.setValueAtTime(0.0001,st);
      g.gain.exponentialRampToValueAtTime(0.1,st+0.03);
      g.gain.exponentialRampToValueAtTime(0.0001,st+0.9);
      o.connect(g); g.connect(this.master);
      o.start(st); o.stop(st+1);
    });
  },

  rattle(vol){                     // electrical spark / static crackle (audible)
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    for(let i=0;i<6;i++){
      const st=t+Math.random()*0.3;
      const s=a.createBufferSource(); s.buffer=this.noise;
      const f=a.createBiquadFilter(); f.type='highpass'; f.frequency.value=3000;
      const g=a.createGain();
      g.gain.setValueAtTime(0.42*vol, st);
      g.gain.exponentialRampToValueAtTime(0.0001, st+0.04);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(st); s.stop(st+0.05);
    }
    // low clack so it reads on small speakers
    const o=a.createOscillator(); o.type='square'; o.frequency.value=180;
    const g2=a.createGain();
    g2.gain.setValueAtTime(0.32*vol, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t+0.06);
    o.connect(g2); g2.connect(this.master);
    o.start(t); o.stop(t+0.08);
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

  door(power){                    // heavy vault door with bolt clunks
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const k=this.powerVol(power);
    for(let i=0;i<3;i++){
      const st=t+i*0.25;
      const o=a.createOscillator(); o.type='square'; o.frequency.value=120;
      const g=a.createGain();
      g.gain.setValueAtTime(0.12*k, st);
      g.gain.exponentialRampToValueAtTime(0.0001, st+0.12);
      o.connect(g); g.connect(this.master);
      o.start(st); o.stop(st+0.15);
    }
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
    this.floorGain.gain.setTargetAtTime(l*l*0.07, t, 0.06);
    this.floorFilter.frequency.setTargetAtTime(800 + l*1200, t, 0.1);
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
    this.leakGain.gain.setTargetAtTime(l*near*near*0.10, t, 0.12);
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
  clink(vol=0.4){
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    for(let i=0;i<4;i++){
      const st=t+i*0.08+Math.random()*0.02;
      const o=a.createOscillator(); o.type='triangle';
      o.frequency.value=1800+Math.random()*1200;
      const g=a.createGain();
      g.gain.setValueAtTime(0.09*vol, st);
      g.gain.exponentialRampToValueAtTime(0.0001, st+0.12);
      o.connect(g); g.connect(this.master);
      o.start(st); o.stop(st+0.13);
    }
  },

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
