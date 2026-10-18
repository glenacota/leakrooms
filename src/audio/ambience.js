/* ---------- THE TITLE-SCREEN BED ----------
   A noise floor and a held chord under the title, so the first thing you hear is
   the building and not a menu. Three layers, all synthesized and all very slow:

     ROOM   filtered noise whose band drifts under 0.04 Hz. Air handling in an
            empty corridor. It does most of the work, and it is the layer you stop
            hearing, which is the point of having it.
     PAD    three detuned saws (A1, A1 a third of a semitone up, E2) through a
            lowpass whose cutoff drifts at 0.02 Hz. Nothing here is above 165 Hz.
     NOTES  one triangle note every 7 to 14 seconds from an A minor pentatonic
            scale, with two seconds of attack and six of release. "Very slow" is
            a scheduling choice, not a tempo: there is no tempo.

   Notes are scheduled about a second ahead from a timer and are not fired at the
   moment they are due. setTimeout can be late by tens of milliseconds, and an LFO
   with a twenty second period needs the timing to be exact. */
export const ambience = {
  amb:null, ambOn:false, _ambTimer:null, _ambNext:0,
  ambience(on){
    if (!this.ok || on===this.ambOn) return;
    this.ambOn = on;
    if (on) this._ambStart(); else this._ambStop();
  },
  _ambStart(){
    /* Checked on the context as well as on `ok`. ambience() checks both, but a
       half-built bed would leave a setInterval running against a null context if
       anything ever called this directly. */
    if (!this.ok || !this.ctx) return;
    const a=this.ctx, t=a.currentTime;
    const out=a.createGain(); out.gain.value=0; out.connect(this.master);
    const live=[];
    // Fades in over about four seconds, so the bed is already there when the title is
    out.gain.setTargetAtTime(0.85, t, 1.6);

    const n=a.createBufferSource(); n.buffer=this.noise; n.loop=true;
    const bp=a.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=420; bp.Q.value=0.7;
    const ng=a.createGain(); ng.gain.value=0.055;
    const lfo=a.createOscillator(); lfo.frequency.value=0.035;
    const lfoG=a.createGain(); lfoG.gain.value=170;
    lfo.connect(lfoG); lfoG.connect(bp.frequency);
    n.connect(bp); bp.connect(ng); ng.connect(out);
    n.start(t); lfo.start(t); live.push(n, lfo);

    const pad=a.createGain(); pad.gain.value=0.5;
    const lp=a.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=300; lp.Q.value=3;
    pad.connect(lp); lp.connect(out);
    const plfo=a.createOscillator(); plfo.frequency.value=0.021;
    const plfoG=a.createGain(); plfoG.gain.value=150;
    plfo.connect(plfoG); plfoG.connect(lp.frequency);
    plfo.start(t); live.push(plfo);
    for (const f of [55, 55.35, 82.4]){
      const o=a.createOscillator(); o.type='sawtooth'; o.frequency.value=f;
      const g=a.createGain(); g.gain.value=0.10;
      o.connect(g); g.connect(pad); o.start(t); live.push(o);
    }

    this.amb={ out, live };
    this._ambNext = t + 2;
    this._ambTimer = setInterval(()=>this._ambTick(), 120);
  },
  _ambTick(){
    if (!this.amb || !this.ok || !this.ctx) return;
    const now=this.ctx.currentTime;
    while (this._ambNext < now + 1.2){
      this._ambNote(this._ambNext);
      /* The gap is measured from the NOTE, not from the tick. The tick fires
         more than a second before the note is due, so measuring from it would
         shave that lead time off every interval (a 7 to 14 second spacing became
         6 to 13). If the tab was suspended long enough for the schedule to fall
         behind the clock, it starts again from now. */
      this._ambNext += 7 + Math.random()*7;
      if (this._ambNext < now + 2) this._ambNext = now + 7 + Math.random()*7;
    }
  },
  _ambNote(t){
    if (!this.amb || !this.ok || !this.ctx) return;
    const a=this.ctx;
    const SCALE=[0,3,5,7,10,12,15];            // A minor pentatonic, plus the octave
    const deg=SCALE[(Math.random()*SCALE.length)|0];
    const oct=Math.random()<0.35 ? -12 : 0;   // now and then, the note below
    const f=110 * Math.pow(2, deg/12) * Math.pow(2, oct/12);
    const o=a.createOscillator(); o.type='triangle'; o.frequency.value=f;
    const lp=a.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=850;
    const g=a.createGain(); g.gain.value=0.0001;
    o.connect(lp); lp.connect(g); g.connect(this.amb.out);
    const dur=6 + Math.random()*4;
    g.gain.exponentialRampToValueAtTime(0.075, t+2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    o.start(t); o.stop(t+dur+0.2);
  },
  _ambStop(){
    if (!this.amb) return;
    const t=this.ctx ? this.ctx.currentTime : 0;
    /* Fades out over about a second and THEN stops the sources. They are not
       disconnected or cut to zero, because a hard stop on a pad is an audible
       click. */
    this.amb.out.gain.cancelScheduledValues(t);
    this.amb.out.gain.setTargetAtTime(0, t, 0.35);
    for (const n of this.amb.live){ try { n.stop(t+2.5); } catch(e){} }
    clearInterval(this._ambTimer);
    this._ambTimer=null; this._ambNext=0; this.amb=null;
  }
};