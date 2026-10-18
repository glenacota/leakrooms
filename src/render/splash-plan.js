import { FLOOR, MAP_W } from '../config/constants.js';
import { G } from '../sim/state.js';
import { VH, VW } from './canvas.js';

/* ------------------------------------------------------------
   THE PLAN ON THE SPLASH
   The blueprint behind the title is the level the run is about to be built
   from — the same G the player is seconds away from standing in, drawn from
   the same RUN_SEED. It is faded to the point of being unreadable on purpose:
   a splash that handed over a legible map would be a tutorial, and a tutorial
   here would give away the only thing the player earns, which is finding the
   pipes by following water downhill.
   ------------------------------------------------------------ */
export function paintSplashPlan(){
  const cv = document.getElementById('splash-plan');
  if (!cv || !G || !G.grid || !cv.getContext) return;
  const far = document.getElementById('splash-plan-far');
  const ctx = cv.getContext('2d');
  const W = Math.max(320, Math.floor(cv.clientWidth  || VW || 1280));
  const H = Math.max(240, Math.floor(cv.clientHeight || VH || 720));
  /* One period of the painting has to be exactly the frame width, or the -50%
     roll leaves a visible seam. Scaling by width does that for free, and the
     plan is a cropped texture anyway — nobody sees the top and the bottom. */
  const cell = W / MAP_W;
  const pw = Math.ceil(W * 2), ph = Math.ceil(H);
  for (const c of [cv, far]){
    if (!c) continue;
    c.width = pw; c.height = ph;
  }
  if (!ctx) return;
  ctx.clearRect(0, 0, pw, ph);

  const px = (v)=> Math.floor(v*cell);
  for (let pass=0; pass<2; pass++){
    const ox = pass*W;
    /* The corridors are drawn and the walls are left empty, not the other way
       round. A 76-wide BSP level is mostly wall, so filling the walls paints
       large slabs and the splash turns into a checkerboard; lighting the walkable
       tiles instead gives the thin lattice that reads as a plan. */
    for (let y=0; y<MAP_W; y++) for (let x=0; x<MAP_W; x++){
      if (G.grid[y*MAP_W+x] === FLOOR){
        ctx.fillStyle = 'rgba(228,230,168,0.55)';
        ctx.fillRect(ox+px(x), px(y), Math.ceil(cell), Math.ceil(cell));
      }
    }
    /* the survey grid, one hairline every four tiles */
    ctx.strokeStyle = 'rgba(228,230,168,0.16)';
    ctx.lineWidth = 1;
    for (let x=0; x<=MAP_W; x+=4){
      ctx.beginPath(); ctx.moveTo(ox+px(x)+0.5, 0); ctx.lineTo(ox+px(x)+0.5, ph); ctx.stroke();
    }
    for (let y=0; y<=MAP_W; y+=4){
      ctx.beginPath(); ctx.moveTo(ox, px(y)+0.5); ctx.lineTo(ox+W, px(y)+0.5); ctx.stroke();
    }
    /* the marks that are the run: the door you came in by, and every pipe.
       Water-blue, because water is the only hue in this place and these two
       things are both water problems. */
    ctx.fillStyle = 'rgba(143,196,204,1)';
    const dz = Math.max(3, cell*0.34);
    for (const L of (G.leaks || [])){
      ctx.fillRect(ox+px(L.x+0.5)-dz/2, px(L.y+0.5)-dz/2, dz, dz);
    }
    const p = G.player;
    if (p){
      ctx.strokeStyle = 'rgba(143,196,204,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ox+px(p.x), px(p.y), Math.max(4, cell*1.1), 0, 6.284); ctx.stroke();
    }
  }
  /* the far layer is the same painting, not a second generation of it */
  if (far && far.getContext){
    const f = far.getContext('2d');
    if (f){ f.clearRect(0,0,pw,ph); f.drawImage(cv, 0, 0); }
  }
}
