/* ============================================================
   THE HUD SCOPE
   The noise instrument in the header panel.

   The old sidebar carried the noise in one bar with three fills: the
   noise you were making, the standing hiss of the open pipes, and a
   tick at the last loud moment. A bar can hold that, but only if you
   read three separate things at once, and the number above it only
   ever showed one of them.

   A scope says the same three things in one glance, because a scope
   IS a loudness display:

     the bright wave   the noise YOU are making, and the only thing
                       that can pass LOUD
     the blue wave     the open pipes: a constant hiss that never does
     the dashed pair   the LOUD threshold, so the wave can be seen
                       about to cross it
     the orange line   peak hold: where your last loud moment reached

   It is its own small canvas because a live trace has to be redrawn
   every frame.
   ============================================================ */

import { LOUD, NOISE_FS } from '../config/constants.js';
import { G } from '../sim/state.js';

const TAU = Math.PI * 2;

/* The face is a fixed 56 CSS pixels square. The panel is a fixed size
   too, so the instrument is the same size on every screen; only the
   backing store follows the device pixel ratio. */
const FACE = 56;
const CX = FACE/2;
const CY = FACE/2;
const DIAL = 24;
const SPAN = DIAL*0.9;         // the height of the noise axis, in face pixels

let cvs = null;
let ctx = null;
let dpr = 1;

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

/* ---------- the axis ----------
   The height of the trace for a given level, in face pixels, and the
   height of the LOUD band. The band is where the trace's peak lands at
   exactly the threshold, so the two are read off the same axis: a wave
   that reaches the dashed line is loud, and a wave that does not is
   not. Exported so a test can check that they agree. */
export function traceHeight(level){ return level * SPAN; }
export const LOUD_BAND = (LOUD/NOISE_FS)*SPAN;

/* ---------- colour ---------- */
function rgb(h){
  return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
}
function mix(a, b, t){
  const A = rgb(a);
  const B = rgb(b);
  return 'rgb(' + A.map((v,i)=>Math.round(v+(B[i]-v)*t)).join(',') + ')';
}

/* Your own noise: pale yellow while you are quiet, going orange and
   then red as you get louder. Past LOUD it snaps to the alarm red the
   rest of the HUD uses, because past LOUD is not a shade, it is a
   state. */
export function selfColor(power){
  if (power >= LOUD) return '#ff4a30';
  const t = clamp01(power/LOUD);
  return t < 0.5 ? mix('#e4e6a8', '#e0903a', t*2) : mix('#e0903a', '#d8503c', (t-0.5)*2);
}

/**
 * What the scope is showing, read out of the floor state. Exported so a
 * test can ask what the instrument says without reading pixels.
 */
export function scopeState(){
  if (!G) return { self:0, pipes:0, peak:0, loud:false, color:'#e4e6a8' };
  return {
    self:  clamp01(G.selfNoise/NOISE_FS),
    pipes: clamp01(G.leakTotal/NOISE_FS),
    peak:  clamp01(G.noisePeak/NOISE_FS),
    loud:  G.selfNoise >= LOUD,
    color: selfColor(G.selfNoise)
  };
}

/**
 * Finds the scope's canvas and sizes its backing store.
 *
 * The element is looked up here and not at module scope, so the module
 * can be loaded by a test that has no DOM at all.
 */
export function initScope(){
  cvs = document.getElementById('hud-scope');
  if (!cvs) return;
  ctx = cvs.getContext('2d');
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cvs.width  = Math.round(FACE*dpr);
  cvs.height = Math.round(FACE*dpr);
}

/* One wave across the face. `level` is 0..1 of full scale, `cycles` how
   many waves fit across it and `scroll` how fast the pattern travels, in
   face pixels a second. */
function wave(level, cycles, scroll, color, width, now){
  if (level <= 0.002) return;
  const phase = now * cycles * TAU * scroll / (2*DIAL);
  ctx.save();
  ctx.beginPath(); ctx.arc(CX, CY, DIAL, 0, TAU); ctx.clip();
  ctx.beginPath();
  for (let px = -DIAL; px <= DIAL; px += 1.5){
    const u = (px+DIAL)/(2*DIAL);
    const a = u*cycles*TAU - phase;
    const w = Math.sin(a)*0.82 + Math.sin(a*2.7 + 1.1)*0.18;
    const y = CY - w*traceHeight(level);
    if (px <= -DIAL) ctx.moveTo(CX+px, y); else ctx.lineTo(CX+px, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws the scope.
 *
 * @param {number} t - the browser's frame timestamp in milliseconds.
 */
export function paintScope(t){
  if (!ctx || !G) return;
  const now = (t || 0)/1000;
  const st = scopeState();

  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,FACE,FACE);

  /* the face */
  ctx.fillStyle = '#0a0b05';
  ctx.beginPath(); ctx.arc(CX, CY, DIAL, 0, TAU); ctx.fill();

  /* the graticule */
  ctx.strokeStyle = 'rgba(228,230,168,.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CX-DIAL, CY); ctx.lineTo(CX+DIAL, CY);
  ctx.moveTo(CX, CY-DIAL); ctx.lineTo(CX, CY+DIAL);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(CX, CY, DIAL*0.55, 0, TAU); ctx.stroke();

  /* the LOUD band: the two lines the wave has to cross */
  const band = LOUD_BAND;
  ctx.setLineDash([3,3]);
  ctx.strokeStyle = 'rgba(228,230,168,.30)';
  ctx.beginPath();
  ctx.moveTo(CX-DIAL, CY-band); ctx.lineTo(CX+DIAL, CY-band);
  ctx.moveTo(CX-DIAL, CY+band); ctx.lineTo(CX+DIAL, CY+band);
  ctx.stroke();
  ctx.setLineDash([]);

  /* the pipes: a slow blue hiss behind everything */
  if (st.pipes > 0.01) wave(st.pipes*0.8, 1.1, 0.55, '#3c5a60', 1.2, now);

  /* peak hold: where your last loud moment reached */
  if (st.peak > 0.02){
    ctx.strokeStyle = 'rgba(255,143,107,.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CX-DIAL, CY-st.peak*SPAN); ctx.lineTo(CX+DIAL, CY-st.peak*SPAN);
    ctx.stroke();
  }

  /* you */
  wave(st.self, 1.3 + 2.4*st.self, 18 + 110*st.self, st.color, 1.6, now);

  /* the bezel, which flashes once the room can hear you */
  ctx.strokeStyle = st.loud && Math.floor(now*4) % 2 ? '#d8503c' : '#a99c4a';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(CX, CY, DIAL+1, 0, TAU); ctx.stroke();
}
