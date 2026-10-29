/* DOM, canvas and Web Audio stubs for the headless harness.
   Recording draw calls, remembering scheduled AudioParam values and
   round-tripping packed pixels are all load-bearing for the render, audio and
   flood tests, so these stubs are not cosmetic. */
export const calls = { pattern:0, imageData:0, gradient:0, list:[] };

/* getImageData reads back what putImageData last wrote. The flood is rendered
   through a packed image, and asserting on wetArr alone would pass while the
   renderer drew nothing. Reading the pixels is the only way to see what the
   frame actually contains. */
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
    /* arc and stroke are recorded because the repair ring is drawn with them and
       nothing else, so they are the only way to find the ring's radius. */
    arc(...a){ calls.list.push(['arc',...a]); },
    /* ellipse is recorded for the same reason: both sprites open with a contact
       shadow drawn as an ellipse, so it is the first primitive that reveals
       where a figure was actually placed. */
    ellipse(...a){ calls.list.push(['ellipse',...a]); },
    stroke(...a){ calls.list.push(['stroke',...a]); },
    fillText(...a){
      const e = ['fillText',...a];
      /* The alpha, colour and font in force are kept on the call, so a test can
         read a label's fade, tint and size. */
      e.alpha = self.globalAlpha; e.style = self.fillStyle; e.font = self.font;
      calls.list.push(e);
    },
    /* strokeText is recorded so a test can see a label's outline. */
    strokeText(...a){
      const e = ['strokeText',...a];
      e.style = self.strokeStyle; e.width = self.lineWidth;
      calls.list.push(e);
    },
    /* moveTo and lineTo are recorded so a test can read a drawn waveform. */
    moveTo(...a){ calls.list.push(['moveTo',...a]); },
    lineTo(...a){ calls.list.push(['lineTo',...a]); },
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
               getContext:()=>cv._ctx, style:{}, _listeners:{} };
  /* The main canvas is where the context-loss events live, so the stub has to be
     a thing events can be attached to. */
  cv.addEventListener = (t, fn)=>{ (cv._listeners[t] || (cv._listeners[t]=[])).push(fn); };
  cv.removeEventListener = (t, fn)=>{
    const l = cv._listeners[t];
    if (l){ const i = l.indexOf(fn); if (i >= 0) l.splice(i,1); }
  };
  cv._fire = (t, arg)=>{ for (const fn of (cv._listeners[t]||[]).slice()) fn(arg); };
  cv._ctx = fakeCtx();
  return cv;
}

export const els = {};

/* An AudioParam that remembers what it was last told to do. The real one does
   not write `.value` back when you schedule a ramp, so a test that reads
   `.value` to find out where a gain is going reads the wrong number. */
export function fakeParam(v){
  /* _hist keeps every value the param was told, in order. _scheduled alone is
     the last one, which is wrong for "how loud did this voice peak": a one-shot
     schedules attack then decay, so its last value is always silence. */
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
      /* A node connected to something that is not a node is a MODULATOR: an LFO
         feeding filter.frequency, or a gain feeding a panner. It has no
         node-path to the destination by design and is not an orphan. */
      if (!x || x.kind===undefined) n._mod = true;
      else n._out.push(x);
      return x;
    },
    disconnect(){ n._out.length = 0; },
    start(){ n._starts++; }, stop(){ n._stops++; },
    gain: fakeParam(1), frequency: fakeParam(440), detune: fakeParam(0), delayTime: fakeParam(0),
    Q: fakeParam(1), playbackRate: fakeParam(1),
    /* DynamicsCompressorNode keeps its controls on the node. */
    threshold: fakeParam(-24), knee: fakeParam(30), ratio: fakeParam(12),
    attack: fakeParam(0.003), release: fakeParam(0.25),
    buffer: null, loop: false, type: 'sine', pan: fakeParam(0),
  };
  global.__audioNodes.push(n);
  return n;
}
/* A Web Audio stub that records the graph.

   The suite runs with no AudioContext by default, so with `Audio_.ok` false
   every voice method returns on its first line without building a node, and a
   completely silent game stays silent through every run. This builds the graph
   on demand and remembers every node so the wiring can be walked: a synthesis
   bug is only findable by synthesising. */
export function fakeAudioContext(){
  return {
    currentTime: 0, sampleRate: 48000, state: 'running',
    destination: { isDestination: true },
    createGain: ()=>fakeAudioNode('gain'),
    createOscillator: ()=>fakeAudioNode('osc'),
    createBufferSource: ()=>fakeAudioNode('bufsrc'),
    createBiquadFilter: ()=>fakeAudioNode('biquad'),
    createDelay: ()=>fakeAudioNode('delay'),
    createStereoPanner: ()=>fakeAudioNode('pan'),
    /* The compressor between the mute and the destination keeps its controls on
       the node itself rather than under `gain`. */
    createDynamicsCompressor: ()=>fakeAudioNode('comp'),
    createBuffer: (ch,len)=>({ length:len, getChannelData: ()=>new Float32Array(len) }),
    resume(){ this.state='running'; return Promise.resolve(); },
    suspend(){ this.state='suspended'; return Promise.resolve(); },
    close(){ this.state='closed'; return Promise.resolve(); },
  };
}
