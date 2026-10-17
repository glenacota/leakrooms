import { drawRigger } from '../cast/rigger.js';
import { drawStalker } from '../cast/stalker.js';
import { TAU } from '../cast/primitives.js';
import { CATCH_R, DOOR_HOLD, FLOOR, HAND_OFF, MAP_H, MAP_W, TILE, WALL_FACE } from '../config/constants.js';
import { G } from '../sim/state.js';
import { ctx } from './canvas.js';

/* THE DOOR.
   Drawn before the lighting multiply, like everything else on this pass, so it
   is there exactly when the wall it is in is — which is the right amount of help
   for the one object whose position you already know to the tile. It needs no
   reveal because you start the level standing in front of it and you finish the
   level walking back into the room it is in.

   LOCAL SPACE. The origin is the centre of the door's own tile and +y points
   INTO the room, so everything below is written once, in the one orientation
   where the wall is above and the opening faces the viewer. `facing` rotates
   that into whichever wall the placement actually landed in, which is why the
   hinge, the swing and the frame are correct in all four of them.

   The lamp is the whole state read. It was text once — LOCKED above, LATCH
   CLEAR below — and text on a door is a label stuck to a rectangle: it says
   what the door is, not what it is doing, and it is only legible when the
   multiply has already let enough light through to read small type. A lamp in
   the frame corner survives the lighting, survives the distance across a dark
   room on the way back, and is what a building with a functioning door system
   would actually have fitted. */
const DOOR_ROT = { S:0, N:Math.PI, E:-Math.PI/2, W:Math.PI/2 };
/* How far south of its own tile the door is PAINTED, and where in that tile.
   This is not a nudge, it is the difference between a frame lying on the floor
   and a door in a wall. The door tile is masonry: the renderer paints its
   ceiling top dark, and the lit face — the wallpaper band with the hard ceiling
   line above it — lives in the carpet tile BELOW, filling WALL_FACE of that
   tile's height (bakeTiles). So the door is painted there, centred on the band
   itself rather than on the tile, because the band is the wall and the rest of
   that tile is floor.

   Drawn in section 4, which is after both the flood and the wall bake, so
   landing here paints straight over the lit face. The Rigger draws later still
   (section 5), so standing in the doorway puts them in front of the frame,
   which is where a person in a doorway is. */
export function drawDoor(e, t){
  const armed = G.leaksOpen === 0;
  const open  = Math.max(0, Math.min(1, e.open));     // the swing, written by tickDoor
  /* Sized to the face it is painted on. A door wider or taller than the band
     stops being a door in the wall and becomes a free-standing frame standing
     on the carpet in front of it — which is what the first version looked like
     at 0.74 of a tile against a face of 0.46.

     0.60 rather than something rounder because the opening is not the whole
     object: the casing strokes sit 3px outside it on every side, and the door
     only fits the face if the opening plus its own frame does. At 0.60 the
     assembly spans exactly the band's height, which is the constraint. */
  const OW = TILE*0.40, OH = WALL_FACE*0.60;
  const hw = OW/2, hh = OH/2;
  const cycling = G.descend>0.02 && G.descend<DOOR_HOLD;

  const rot = DOOR_ROT[e.facing] !== undefined ? DOOR_ROT[e.facing] : 0;

  ctx.save();
  ctx.translate((e.x+0.5)*TILE, (e.y+1)*TILE + WALL_FACE/2);
  ctx.save();
  ctx.rotate(rot);

  /* The lamp's own light, thrown onto the wall before anything is drawn over
     it — the glow is how the state reads from the next room, which is the only
     time you are far enough away for it to matter. */
  const gr = ctx.createRadialGradient(0, 0, 2, 0, 0, TILE*2.4);
  if (armed){
    const p = 0.5 + 0.5*Math.sin(t*0.010);            // READY breathes
    gr.addColorStop(0, `rgba(143,208,122,${0.16+0.14*p})`);
  } else {
    gr.addColorStop(0, 'rgba(143,208,122,0.10)');     // LOCKED barely registers
  }
  gr.addColorStop(1,'rgba(143,208,122,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(-TILE*2.4, -TILE*2.4, TILE*4.8, TILE*4.8);

  /* the opening — somewhere darker than the wall it is cut into */
  ctx.fillStyle = 'rgba(16,20,12,0.88)';
  ctx.fillRect(-hw, -hh, OW, OH);

  /* THE FRAME, as an outline rather than a fill.
     This used to paint its own wall colour into the lintel and the jambs, which
     was right when the door sat on the wall tile and had to bring its masonry
     with it. Painted on the lit face there is nothing to bring: the wallpaper
     band is already there, under us, and filling over it erased the one lit
     surface the door was placed to be on. So the frame is now the casing — two
     jambs and a head, stroked — and the wall face reads straight through the
     gaps the way a real door frame sits in a real wall. */
  ctx.strokeStyle = '#9c9a68'; ctx.lineWidth = 2.5;
  ctx.strokeRect(-hw-1.5, -hh-1.5, OW+3, OH+3);
  ctx.strokeStyle = 'rgba(40,38,24,0.5)'; ctx.lineWidth = 1;
  ctx.strokeRect(-hw-3, -hh-3, OW+6, OH+6);
  ctx.fillStyle = 'rgba(120,118,70,0.55)';
  ctx.fillRect(-hw-1.5, hh+1.5, OW+3, 1.5);            // the sill, catching the room light

  /* THE LEAF. Hinged on the left jamb, so the free edge is the one that
     travels: toward the hinge, and down toward the viewer, because a door in a
     wall on a floor plan swings out into the room it opens onto. The far edge
     cannot rise — it would leave its own frame — so the trapezoid is built from
     the hinge edge, which never moves. */
  const hx = -hw;
  const fx = hx + OW*(1 - 0.52*open);
  const top = -hh + OH*0.26*open;
  ctx.beginPath();
  ctx.moveTo(hx, -hh); ctx.lineTo(fx, top);
  ctx.lineTo(fx, top+OH); ctx.lineTo(hx, hh);
  ctx.closePath();
  const lg = ctx.createLinearGradient(hx, 0, fx, 0);
  lg.addColorStop(0,'#cdc98f'); lg.addColorStop(1,'#a8a473');
  ctx.fillStyle = lg; ctx.fill();
  ctx.strokeStyle = 'rgba(28,26,20,0.55)'; ctx.lineWidth = 1; ctx.stroke();
  if (fx-hx > 6){                                     // the recessed panel
    ctx.strokeStyle = 'rgba(28,26,20,0.22)';
    ctx.beginPath();
    ctx.moveTo(hx+2.5, -hh+2.5); ctx.lineTo(fx-2.5, top+2.5);
    ctx.lineTo(fx-2.5, top+OH-2.5); ctx.lineTo(hx+2.5, hh-2.5);
    ctx.stroke();
  }
  if (armed){
    ctx.fillStyle = '#7d8288';                         // the handle, on the swinging edge
    ctx.fillRect(fx-3.5, top+OH/2-4.5, 2.5, 9);
  }
  /* hinges — on the JAMB, not the leaf, so there is something fixed for the
     crank to swing around */
  ctx.fillStyle = '#6f6c47';
  ctx.fillRect(-hw-3.5, -hh+3, 2.5, 4.5); ctx.fillRect(-hw-3.5, hh-7.5, 2.5, 4.5);

  /* THE CRANK. Drawn only while the door is actually cycling, which is the
     one piece of feedback the 1.5s hold did not have at all: before this, the
     whole descent existed as the prompt string and nothing in the world. */
  if (cycling){
    const cx = -hw-2, cy = 0, r = 8, p = G.descend/DOOR_HOLD;
    ctx.strokeStyle = 'rgba(28,26,20,0.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI*0.5, Math.PI*1.5); ctx.stroke();
    ctx.strokeStyle = '#8fd07a';
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI*0.5, Math.PI*0.5+Math.PI*p); ctx.stroke();
    ctx.strokeStyle = '#7d8288'; ctx.lineWidth = 1.6;   // the handle, turning
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx+Math.cos(2.2+t*0.006)*r, cy+Math.sin(2.2+t*0.006)*r);
    ctx.stroke();
  }

  /* THE LAMP. Green means the level can end; red means it cannot. No word on
     the door anywhere — the word is on the HUD, where the other four readings
     are, and one label in one place is a label a player learns to read. */
  const lx = hw + 5, ly = -hh + 1;
  const lit = armed ? (0.6 + 0.4*Math.sin(t*0.010)) : 0.5;
  const col = armed ? '#cdf3bd' : '#d8503c';
  const lg2 = ctx.createRadialGradient(lx, ly, 0.5, lx, ly, 7);
  lg2.addColorStop(0, col); lg2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.45*lit; ctx.fillStyle = lg2;
  ctx.beginPath(); ctx.arc(lx, ly, 7, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(lx, ly, 2.4, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(28,26,20,0.65)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(lx, ly, 2.4, 0, TAU); ctx.stroke();

  ctx.restore();          // pops the rotation, keeps the translate to the door

  ctx.restore();
}

/* The avatar. Every part drawn INSIDE the collision disc (R = 0.33 tiles).
   The body itself is the Rigger, drawn by drawRigger below; this function owns
   the shadow, the facing, the gait clock and the radar in hand. */
export function drawPlayer(p, t, wx, wy){
  /* wx/wy are the interpolated world position (see the y-sort in render).
     They default to the entity's own, so any caller that has not got an
     interpolation to offer still draws it exactly where it is. */
  const x=(wx===undefined?p.x:wx)*TILE, y=(wy===undefined?p.y:wy)*TILE;

  // contact shadow, kept tight so it never spills onto a wall
  ctx.fillStyle='rgba(8,6,3,0.34)';
  ctx.beginPath(); ctx.ellipse(x+1.5, y+3, TILE*0.19, TILE*0.11, 0,0,6.283); ctx.fill();

  /* The gait phase is the step timer — the same one that paces the footstep
     audio — so a rig's feet are on the floor on the frame the sound lands.
     Standing still, phase keeps its last value but gait drops to zero and
     every stride in the table collapses with it. */
  const phase = p.stepDur ? 1 - p.stepT/p.stepDur : 0;

  ctx.save();
  ctx.translate(x,y);
  ctx.rotate(p.face + Math.PI/2);

  drawRigger(ctx, { T:TILE, phase, gait: p.moving ? 1 : 0, t });

  /* The radar, held out in front — same forward offset as vision cone. */
  const rg = G.radar ? 1 : 0.35;
  ctx.fillStyle=`rgba(255,250,222,${0.5*rg})`;
  ctx.beginPath(); ctx.arc(0, -HAND_OFF*TILE, TILE*0.044, 0, 6.283); ctx.fill();
  ctx.fillStyle=`rgba(255,244,196,${0.20*rg})`;
  ctx.beginPath(); ctx.arc(0, -HAND_OFF*TILE, TILE*0.082, 0, 6.283); ctx.fill();

  ctx.restore();
}

/* The Lifeform. Dormant = static burst on carpet. Rising = the body
   coalesces out of its own footprint. Hunting = fully up, one of six
   the Stalker, drawn by drawStalker below. The shadow and the red rim are the
   game's; the thing itself is the sprite's. */
/* The dormant burst's twenty fill styles, built once at module load. See the
   DORMANT branch in drawAgent: the brightness of speck `i` is a function of `i`
   alone, so these strings never change and never needed to be rebuilt. */
const DORMANT_FILL = Array.from({length:20}, (_,i)=>{
  const br = Math.round(100 + Math.sin(i)*50);
  return `rgba(${br},${br},${br},0.3)`;
});

export function drawAgent(a, t, wx, wy){
  const x=(wx===undefined?a.x:wx)*TILE, y=(wy===undefined?a.y:wy)*TILE;
  const h = a.rise;

  // shadow, sized to the body rather than to the rise
  ctx.fillStyle='rgba(6,5,3,0.5)';
  ctx.beginPath();
  ctx.ellipse(x, y+4, TILE*0.36, TILE*0.20, 0,0,6.283);
  ctx.fill();

  if (h < 0.02){
    /* DORMANT — a burst of static on the carpet.
       The twenty fill styles are built ONCE, not per frame: `br` comes from
       `Math.sin(i)` and `i` does not change, so every one of those template
       literals was allocating a string sixty times a second to hold a value
       that is the same string it held on the previous frame. Only the
       POSITIONS animate — they drift on t — and those are two sines either
       way, so the burst still crawls exactly as before. */
    for (let i=0;i<20;i++){
      const sx = x + Math.sin(i*3.7 + t*0.01)*TILE*0.25;
      const sy = y + Math.cos(i*2.3 + t*0.008)*TILE*0.10;
      ctx.fillStyle = DORMANT_FILL[i];
      ctx.fillRect(sx, sy, 2, 2);
    }
    return;
  }

  /* Gait. The Lifeforms have no step timer of their own — they are not
     walking anything, they are coming — so the phase runs off the frame
     clock and the stride amount comes from the state: a HUNT strides,
     a SEARCH drifts, a WALK is halfway between the two. */
  const gait = a.state==='HUNT' ? 1 : a.state==='WALK' ? 0.55 : 0.3;

  /* CLIP TO THE FLOOR. The Stalker's legs reach further than its collision
     disc, so drawn unclipped it strides straight over the partition into the
     next room — which reads as walking through walls, and a wall it can cross
     is a wall that cannot save you. The clip is the walkable tiles within
     reach of it, so the legs stop at the wall line exactly like the body
     does. Built per frame from the grid: 25 rects, and the alternative is a
     sprite that lies about where it is. */
  const CR = 2;
  const cx0 = Math.max(0, Math.floor(a.x - CR)), cx1 = Math.min(MAP_W-1, Math.ceil(a.x + CR));
  const cy0 = Math.max(0, Math.floor(a.y - CR)), cy1 = Math.min(MAP_H-1, Math.ceil(a.y + CR));
  ctx.save();
  ctx.beginPath();
  for (let ty=cy0; ty<=cy1; ty++)
    for (let tx=cx0; tx<=cx1; tx++)
      if (G.grid[ty*MAP_W+tx]===FLOOR) ctx.rect(tx*TILE, ty*TILE, TILE, TILE);
  ctx.clip();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-a.face + Math.PI/2 + Math.sin(t*0.0018)*0.05);

  /* `danger` is how close it is to hunting you: 0 when it is wandering,
     1 when it is coming. It drives the rim on the hit zone below. */
  drawStalker(ctx, { T:TILE, h, phase: (t*0.0009) % 1, gait, t,
                     danger: a.state==='HUNT' ? 1 : 0.25 });

  ctx.restore();   // the transform
  ctx.restore();   // the floor clip

  // when it has you, a thin red rim on the hit zone itself
  if (G.seenBy>0.35){
    ctx.strokeStyle=`rgba(216,80,60,${0.30*G.seenBy})`;
    ctx.lineWidth=2;
    ctx.beginPath(); ctx.ellipse(x,y,TILE*CATCH_R,TILE*CATCH_R,0,0,6.283); ctx.stroke();
  }
}

/* Entity-draw seam. The render loop draws the cast through ENT.player /
   ENT.agent so a test can wrap one member without touching the loop. Extra
   args are forwarded verbatim: the loop passes the interpolated wx/wy, and
   dropping them would draw the figure at its un-interpolated position. */
export const ENT = { player:(p,t,...r)=>drawPlayer(p,t,...r), agent:(a,t,...r)=>drawAgent(a,t,...r) };
