/* The one-shot sounds and the two continuous noise beds. Every voice is
   synthesized from oscillators and the shared noise buffer, so the game needs no
   audio files. Each one connects to `this.master` (see engine.js) and returns at
   once when there is no audio context. */
export const voices = {
  /* How much louder a sound is for being a louder noise. Without it every voice
     had a fixed peak, and the two loudest actions (a sprint and a wrench) could
     only be told apart on the HUD. A walk (0.22) comes out at 1.09x and a sprint
     at 2.0x, so the bar and the speakers agree. It scales the peaks of the
     voices, never the master: this is the mix, not the volume slider. */
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

  /* THE KUDOS: what a sealed floor sounds like. It is sealLeak() turned the right
     way round: the pitch climbs instead of falling, and the noise beds are pulled
     shut as the chord opens. The room goes QUIET on success, which the death
     sting never does, and the quiet is the reward: the whole level has been
     pipes hissing and something walking toward them.

     It is four notes of a major chord, 90 ms apart, so it lands as a chime on a
     tape deck and not as an instrument. Nothing here is tuned to a key, and
     there is no music in this building. */
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
     Continuous voices: they move a gain that already exists instead of building
     a new one per call. Both are driven from tickAudio (sim/update.js), the only
     place that knows the current noise level. */

  /* The HUD noise bar, in the speakers. `level` is the noise divided by
     NOISE_FS, so the mix IS the meter and not a mood running beside it. The gain
     follows the square of the level, because a bar a third full should sound like
     a third of the way to shouting, not a third of shouting. */
  noiseFloor(level){
    if (!this.ok) return;
    const t=this.ctx.currentTime;
    const l=Math.max(0, Math.min(1, level||0));
    this.floorGain.gain.setTargetAtTime(l*l*0.07, t, 0.06);
    this.floorFilter.frequency.setTargetAtTime(800 + l*1200, t, 0.1);
  },

  /* The open pipes. `total` is their summed noise (the same number as the blue
     part of the bar) and `dist` is the distance to the nearest one. The
     attenuation is squared so the pipe is a direction you can walk toward and not
     a level that is always on. */
  leakBed(total, dist){
    if (!this.ok) return;
    const t=this.ctx.currentTime;
    const l=Math.max(0, Math.min(1, total||0));
    const near=Math.max(0, 1 - Math.max(0, dist==null?99:dist)/20);
    this.leakGain.gain.setTargetAtTime(l*near*near*0.10, t, 0.12);
    this.leakFilter.frequency.setTargetAtTime(1100 + near*2400, t, 0.15);
  },

  /* Both beds off. For death and for leaving play, where update() stops running
     and would otherwise leave them at whatever level they last had. */
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

  clink(vol=0.4){                  // small metal rattle, played while the radar drains the battery
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

  /* A soft confirmation tone, so pressing M is never a guess. It is deliberately
     not one of the game's own sounds: this is the shell talking and not the
     building, and reusing a footstep for a UI acknowledgement would make the
     control sound like it broke something. */
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
};