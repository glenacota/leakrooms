/* DOM/canvas/Web-Audio stubs for the headless harness. Moved verbatim from
   test.js — the behaviour they encode (recording draw calls, remembering
   scheduled AudioParam values, round-tripping packed pixels) is load-bearing
   for the render, audio and flood tests. */
export const calls = { pattern:0, imageData:0, gradient:0, list:[] };

/* getImageData reads back what putImageData last wrote. That round-trip is not
   incidental: the flood is rendered through a packed image, and asserting on
   wetArr alone would pass while the renderer drew nothing — the exact class of
   bug the README says several of these tests missed. Reading the pixels is the
   only way to see what the frame actually contains. */
export function fakeCtx(){
  const noop = ()=>{};
  const grad = { addColorStop: noop };
  const self = {
    canvas:{width:0,height:0},
    _last:null,
    setTransform(...a){ calls.list.push(['setTransform',...a]); },
    translate(...a){ calls.list.push(['translate',...a]); },
    drawImage(...a){ calls.list.push(['drawImage',...a]); },
    createPattern: ()=>{ calls.pattern++; return {}; },
    createImageData:(w,h)=>{ calls.imageData++; const im={width:w,height:h,data:new Uint8ClampedArray(w*h*4)}; self._last=im; return im; },
    putImageData(im){ self._last = im; },
    getImageData(x,y,w,h){
      const src = self._last;
      const out = {width:w, height:h, data:new Uint8ClampedArray(w*h*4)};
      if (src && src.data && src.width===w && src.height===h) out.data.set(src.data);
      return out;
    },
    createLinearGradient: (...a)=>{ calls.gradient++; calls.list.push(['createLinearGradient',...a]); return grad; },
    createRadialGradient: (...a)=>{ calls.gradient++; calls.list.push(['createRadialGradient',...a]); return grad; },
    fillRect(...a){ calls.list.push(['fillRect',...a]); },
    /* arc and stroke are recorded because the repair ring is drawn with them
       and nothing else. It used to be asserted through the leak's gradients
       instead, which is measuring a different object two inches away and lands
       exactly on the tolerance boundary for any pipe north or south of the
       spot — a test that passes or fails on the seed. */
    arc(...a){ calls.list.push(['arc',...a]); },
    /* ellipse is recorded for the same reason arc is, and for the same reason it
       was missing: both sprites open with a contact shadow drawn as an ellipse,
       so it is the first primitive that reveals where the figure was actually
       placed. Without it the harness silently swallowed the one call that
       answers "is this drawn at its true position". */
    ellipse(...a){ calls.list.push(['ellipse',...a]); },
    stroke(...a){ calls.list.push(['stroke',...a]); },
    measureText: ()=>({width:10}),
    globalAlpha:1, globalCompositeOperation:'', fillStyle:'', strokeStyle:'',
    lineWidth:1, font:'', textAlign:'', imageSmoothingEnabled:true,
  };
  return new Proxy(self, {
    get(t,k){ if (k in t) return t[k]; return noop; },
    set(t,k,v){ t[k]=v; return true; }
  });
}

export function fakeCanvas(){
  const cv = { width:0, height:0, clientWidth:1280, clientHeight:720,
               getContext:()=>cv._ctx, style:{} };
  cv._ctx = fakeCtx();
  return cv;
}

export function fakeEl(id){
  const el = {
    id, style:{}, dataset:{}, textContent:'', innerHTML:'', value:'',
    clientWidth:1280, clientHeight:720,
    classList:{ _s:new Set(),
      add(c){ (Array.isArray(c)?c:[c]).forEach(x=>this._s.add(x)); },
      remove(c){ (Array.isArray(c)?c:[c]).forEach(x=>this._s.delete(x)); },
      toggle(c,f){ f? this._s.add(c) : this._s.delete(c); },
      contains(c){ return this._s.has(c); } },
    addEventListener(){}, removeEventListener(){},
    getContext:()=>fakeCtx(),
    width:0,height:0,
    /* The game drives modal transitions through button.click(), including
       from the key handler, so the stub has to activate the handler the same
       way a browser would — not just hold the property. */
    click(){ if (this.onclick) this.onclick(); },
  };
  return el;
}

export const els = {};

/* An AudioParam that remembers what it was last TOLD to do. The real one does
   not write `.value` back when you schedule a ramp — setTargetAtTime is a
   schedule, not an assignment — so a test that reads `.value` to find out where
   a gain is going is reading the wrong number in the browser and in here. */
export function fakeParam(v){
  /* _hist keeps EVERY value the param was told, in order. _scheduled alone is
     the last one, which is the right answer for "where is this gain going" and
     the wrong answer for "how loud did this voice peak" — a one-shot schedules
     attack then decay, so its last value is always silence. */
  return { value:v, _scheduled:null, _hist:[],
    setValueAtTime(x){ this._scheduled=x; this._hist.push(x); },
    setTargetAtTime(x){ this._scheduled=x; this._hist.push(x); },
    linearRampToValueAtTime(x){ this._scheduled=x; this._hist.push(x); },
    exponentialRampToValueAtTime(x){ this._scheduled=x; this._hist.push(x); },
    cancelScheduledValues(){ this._scheduled=null; }, setValueCurveAtTime(){} };
}
export function fakeAudioNode(kind){
  const n = {
    kind, _out: [], _starts: 0, _stops: 0, _mod: false,
    connect(x){
      /* A node connected to something that is not a node is a MODULATOR: an
         LFO feeding filter.frequency, or a gain feeding a panner. It has no
         node-path to the destination by design and is not an orphan. */
      if (!x || x.kind===undefined) n._mod = true;
      else n._out.push(x);
      return x;
    },
    disconnect(){ n._out.length = 0; },
    start(){ n._starts++; }, stop(){ n._stops++; },
    gain: fakeParam(1), frequency: fakeParam(440), detune: fakeParam(0),
    Q: fakeParam(1), playbackRate: fakeParam(1),
    buffer: null, loop: false, type: 'sine', pan: fakeParam(0),
  };
  global.__audioNodes.push(n);
  return n;
}
/* A Web Audio stub that RECORDS THE GRAPH.

   The harness deliberately runs the whole suite with no AudioContext, which is
   the right call for exercising the fallback path and is also why a completely
   silent game stayed silent through every run: with no context `Audio_.ok` is
   false and every voice method returns on its first line without building a
   single node. Nothing in this file had ever constructed the audio graph.

   So this builds one on demand and remembers every node, so the wiring can be
   walked. A synthesis bug is only findable by synthesising. */
export function fakeAudioContext(){
  return {
    currentTime: 0, sampleRate: 48000, state: 'running',
    destination: { isDestination: true },
    createGain: ()=>fakeAudioNode('gain'),
    createOscillator: ()=>fakeAudioNode('osc'),
    createBufferSource: ()=>fakeAudioNode('bufsrc'),
    createBiquadFilter: ()=>fakeAudioNode('biquad'),
    createStereoPanner: ()=>fakeAudioNode('pan'),
    createBuffer: (ch,len)=>({ length:len, getChannelData: ()=>new Float32Array(len) }),
    resume(){ this.state='running'; return Promise.resolve(); },
    suspend(){ this.state='suspended'; return Promise.resolve(); },
    close(){ this.state='closed'; return Promise.resolve(); },
  };
}
