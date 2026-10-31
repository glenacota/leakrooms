/* The one-shot sounds and the two continuous noise beds. Every voice is
   synthesized from oscillators and the shared noise buffer, so the game needs no
   audio files. Each one connects to `this.master` (see engine.js) and returns at
   once when there is no audio context. */
function tone(a, dest, {
  type, f0, f1, t, dur, peak, frequencyDur=dur, fadeAt=t+dur,
  stopAt=t+dur, initial=peak, attackAt=null, frequencyValue=false, gainValue=false
}){
  const o=a.createOscillator(); o.type=type;
  if (frequencyValue) o.frequency.value=f0;
  else o.frequency.setValueAtTime(f0, t);
  if (f1 != null) o.frequency.exponentialRampToValueAtTime(f1, t+frequencyDur);
  const g=a.createGain();
  if (gainValue) g.gain.value=initial;
  else g.gain.setValueAtTime(initial, t);
  if (attackAt != null) g.gain.exponentialRampToValueAtTime(peak, attackAt);
  g.gain.exponentialRampToValueAtTime(0.0001, fadeAt);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(stopAt);
  return g;
}

function noiseBurst(a, buffer, dest, {type, frequency, t, dur, peak, fadeAt=t+dur}){
  const s=a.createBufferSource(); s.buffer=buffer;
  const f=a.createBiquadFilter(); f.type=type; f.frequency.value=frequency;
  const g=a.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, fadeAt);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t); s.stop(t+dur);
}

export const voices = {
  /* How much louder a sound is for being a louder noise. Without it every voice
     had a fixed peak, and the two loudest actions (a sprint and a wrench) could
     only be told apart on the HUD. A walk (0.22) comes out at 1.09x and a sprint
     at 2.0x, so the bar and the speakers agree. It scales the peaks of the
     voices, never the master: this is the mix, not the volume slider. */
  powerVol(p){ return 0.8 + Math.min(2, Math.max(0, p||0))*1.3; },

  step(vol, power){
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime, k=this.powerVol(power);
    tone(a, this.master, {type:'sine', f0:80, f1:40, t, dur:0.1, frequencyDur:0.08,
      fadeAt:t+0.09, peak:0.12*vol*k});
  },

  splash(vol, power){
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime, k=this.powerVol(power);
    noiseBurst(a, this.noise, this.master, {type:'lowpass', frequency:600, t, dur:0.3,
      fadeAt:t+0.25, peak:0.10*vol*k});
    tone(a, this.master, {type:'sine', f0:70, f1:40, t, dur:0.25, frequencyDur:0.2,
      fadeAt:t+0.22, peak:0.08*vol*k});
  },

  drip(vol){
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const g=tone(a, this.master, {type:'sine', f0:900+Math.random()*300, f1:180, t,
      dur:0.15, frequencyDur:0.09, fadeAt:t+0.13, peak:0.08*vol});
    const del=a.createDelay(); del.delayTime.value=0.12;
    const fb=a.createGain(); fb.gain.value=0.3;
    const eg=a.createGain(); eg.gain.value=0.4;
    g.connect(del); del.connect(fb); fb.connect(del); del.connect(eg); eg.connect(this.master);
  },

  wrench(power){
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime, k=this.powerVol(power);
    for (let i=0;i<5;i++){
      const st=t+i*0.09;
      tone(a, this.master, {type:'square', f0:1200, t:st, dur:0.06,
        fadeAt:st+0.05, peak:0.07*k, frequencyValue:true});
    }
  },

  seal(){
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    tone(a, this.master, {type:'sine', f0:90, f1:50, t, dur:0.5, frequencyDur:0.4,
      fadeAt:t+0.45, peak:0.14});
    const st=t+0.05;
    tone(a, this.master, {type:'square', f0:400, t:st, dur:0.1,
      fadeAt:st+0.07, peak:0.10, frequencyValue:true});
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
    this.silenceBeds();
    [392,494,587,784].forEach((f,i)=>{
      const st=t+i*0.1;
      tone(a, this.master, {type:'sine', f0:f, t:st, dur:1, peak:0.1,
        initial:0.0001, attackAt:st+0.03, fadeAt:st+0.9, frequencyValue:true});
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

  door(power){
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime, k=this.powerVol(power);
    for(let i=0;i<3;i++){
      const st=t+i*0.25;
      tone(a, this.master, {type:'square', f0:120, t:st, dur:0.15,
        fadeAt:st+0.12, peak:0.12*k, frequencyValue:true});
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

  /* The open leaks. `total` is their summed noise (the same number as the blue
     part of the bar) and `dist` is the distance to the nearest one. The
     attenuation is squared so the leak is a direction you can walk toward and not
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

  clink(vol=0.4){
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    for(let i=0;i<4;i++){
      const st=t+i*0.08+Math.random()*0.02;
      tone(a, this.master, {type:'triangle', f0:1800+Math.random()*1200, t:st,
        dur:0.13, fadeAt:st+0.12, peak:0.09*vol, frequencyValue:true});
    }
  },

  /* A soft confirmation tone, so pressing M is never a guess. It is deliberately
     not one of the game's own sounds: this is the shell talking and not the
     building, and reusing a footstep for a UI acknowledgement would make the
     control sound like it broke something. */
  blip(up){
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    tone(a, this.master, {type:'sine', f0:up?520:390, t, dur:0.25, peak:0.05,
      initial:0.0001, attackAt:t+0.02, fadeAt:t+0.22,
      frequencyValue:true, gainValue:true});
  },
};