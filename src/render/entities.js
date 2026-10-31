import { drawPlumber as drawPlumberSprite } from '../cast/plumber.js';
import { drawLifeform as drawLifeformSprite } from '../cast/lifeform.js';
import { TAU } from '../cast/primitives.js';
import { DOOR_HOLD, FLOOR, MAP_H, MAP_W, TILE, WALL_FACE } from '../config/constants.js';
import { G } from '../sim/state.js';
import { leakAt } from '../sim/leaks.js';
import { ctx } from './canvas.js';
import { radialSprite as buildRadialSprite } from './sprites.js';

/* ============================================================
   THE DOOR
   It is drawn before the lighting multiply, like everything else in the world
   pass, so it is visible exactly when its wall is. That is the right amount of
   help for the one object whose position you already know: you start the level
   standing in front of it and finish by walking back to it.

   LOCAL SPACE. The origin is the centre of the door's tile and +y points INTO the
   room. Everything is written once, for the case where the wall is above and the
   opening faces the viewer, and DOOR_ROT then turns it to match whichever wall
   the door was really placed in. That keeps the hinge, the swing and the frame
   correct in all four directions.

   THE LAMP shows the state: green means the level can end, red means it cannot.
   A lamp survives the lighting and the distance across a dark room on the way
   back, which small text on the door would not. (The word for the same state is
   on the HUD.)
   ============================================================ */

/* The lamp and its glow on the wall are radial gradients, drawn every frame for
   every door. They never change shape — only how bright they are, which the
   pulse scales — so each is baked once into a small canvas and drawn back with
   globalAlpha set to the brightness for this frame. */
const GLOW_R = TILE*2.4, LAMP_R = 7;

function radialSprite(r, innerR, inner, outer){
  const size = Math.ceil(r*2);
  return buildRadialSprite(size,size,{
    cx:r, cy:r, r0:innerR, r1:r, stops:[[0,inner],[1,outer]]
  });
}

let glowSprite = null, lampReady = null, lampLocked = null;

function doorSprites(){
  if (glowSprite) return;
  glowSprite = radialSprite(GLOW_R, 2, 'rgba(143,208,122,1)', 'rgba(143,208,122,0)');
  lampReady  = radialSprite(LAMP_R, 0.5, '#cdf3bd', 'rgba(0,0,0,0)');
  lampLocked = radialSprite(LAMP_R, 0.5, '#d8503c', 'rgba(0,0,0,0)');
}

/**
 * Draws the exit door.
 *
 * The door tile is masonry, and its lit face (the wallpaper band, with the hard
 * ceiling line above it) is in the carpet tile BELOW it (see bakeTiles). So the
 * door is painted there, centred on the band, because the band is the wall and
 * the rest of that tile is floor. It is drawn after the flood and the wall
 * layers, so it lands on top of the face, and the plumber (drawn later) stands in
 * front of the frame.
 *
 * @param {object} e - the door: x, y, facing, and `open` (the swing, 0 to 1, written by tickDoor).
 * @param {number} t - the frame timestamp, for the animations.
 */
export function drawDoor(e, t){
  const armed = G.openLeaks === 0;
  const open  = Math.max(0, Math.min(1, e.open));
  /* The size is chosen to fit the wall face it is painted on. A door bigger than
     the band stops being a door in the wall and becomes a frame standing on the
     carpet in front of it. 0.60 is used because the casing strokes sit 3 px
     outside the opening on every side, so the opening plus its frame just fits
     the band's height. */
  const OW = TILE*0.40, OH = WALL_FACE*0.60;
  const hw = OW/2, hh = OH/2;
  const cycling = G.descend>0.02 && G.descend<DOOR_HOLD;

  const rot = 0;

  ctx.save();
  ctx.translate((e.x+0.5)*TILE, (e.y+1)*TILE + WALL_FACE/2);
  ctx.save();
  ctx.rotate(rot);

  /* The lamp's glow on the wall, drawn before the door itself. It is how the
     state reads from the next room, which is the only time you are far enough
     away for it to matter. */
  doorSprites();
  if (armed){
    const p = 0.5 + 0.5*Math.sin(t*0.010);            // READY pulses
    ctx.globalAlpha = 0.16+0.14*p;
  } else {
    ctx.globalAlpha = 0.10;                           // LOCKED barely shows
  }
  ctx.drawImage(glowSprite, -GLOW_R, -GLOW_R);
  ctx.globalAlpha = 1;      // the glow carries its own brightness; the door does not

  // The opening, darker than the wall it is cut into
  ctx.fillStyle = 'rgba(16,20,12,0.88)';
  ctx.fillRect(-hw, -hh, OW, OH);

  /* The frame is an outline (two jambs and a head) and not a filled shape.
     Painted on the lit face, a fill would erase the wallpaper the door was
     placed on, so now the wall shows through the gaps. */
  ctx.strokeStyle = '#9c9a68'; ctx.lineWidth = 2.5;
  ctx.strokeRect(-hw-1.5, -hh-1.5, OW+3, OH+3);
  ctx.strokeStyle = 'rgba(40,38,24,0.5)'; ctx.lineWidth = 1;
  ctx.strokeRect(-hw-3, -hh-3, OW+6, OH+6);
  ctx.fillStyle = 'rgba(120,118,70,0.55)';
  ctx.fillRect(-hw-1.5, hh+1.5, OW+3, 1.5);            // the sill, catching the room light

  /* The door leaf. It is hinged on the left jamb, so the free edge is the one
     that moves: toward the hinge, and down toward the viewer, because a door in
     a wall on a floor plan swings out into the room. The far edge cannot rise
     (it would leave its own frame), so the shape is built from the hinge edge,
     which never moves. */
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
  // Hinges sit on the jamb, not the leaf, so there is something fixed for the crank to turn around
  ctx.fillStyle = '#6f6c47';
  ctx.fillRect(-hw-3.5, -hh+3, 2.5, 4.5); ctx.fillRect(-hw-3.5, hh-7.5, 2.5, 4.5);

  // The lamp: green when the level can end, red when it cannot
  const lx = hw + 5, ly = -hh + 1;
  const lit = armed ? (0.6 + 0.4*Math.sin(t*0.010)) : 0.5;
  const col = armed ? '#cdf3bd' : '#d8503c';
  ctx.globalAlpha = 0.45*lit;
  ctx.drawImage(armed ? lampReady : lampLocked, lx-LAMP_R, ly-LAMP_R);
  ctx.globalAlpha = 1;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(lx, ly, 2.4, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(28,26,20,0.65)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(lx, ly, 2.4, 0, TAU); ctx.stroke();

  ctx.restore();          // undo the rotation, keep the translation to the door

  ctx.restore();
}

/* The crank feedback for the door hold: the outer track plus the green fill
   that grows with the hold, and a turning handle. Drawn after post() so the
   radar's green wash and the VHS pass cannot touch it. The caller owns the
   world transform (scale + camera translate); this only translates to the door
   and strokes the arcs, so it lands on the same pixel it did inside drawDoor. */
export function doorCrank(e, t){
  const cycling = G.descend>0.02 && G.descend<DOOR_HOLD;
  if (!cycling) return;
  const OW = TILE*0.40, OH = WALL_FACE*0.60;
  const hw = OW/2;
  const cx = -hw-2, cy = 0, r = 8, p = G.descend/DOOR_HOLD;
  ctx.save();
  ctx.translate((e.x+0.5)*TILE, (e.y+1)*TILE + WALL_FACE/2);
  ctx.strokeStyle = 'rgba(28,26,20,0.4)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI*0.5, Math.PI*1.5); ctx.stroke();
  ctx.strokeStyle = '#8fd07a';
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI*0.5, Math.PI*0.5+Math.PI*p); ctx.stroke();
  ctx.strokeStyle = '#7d8288'; ctx.lineWidth = 1.6;   // the handle, turning
  ctx.beginPath(); ctx.moveTo(cx, cy);
  ctx.lineTo(cx+Math.cos(2.2+t*0.006)*r, cy+Math.sin(2.2+t*0.006)*r);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws the plumber. The Plumber sprite is drawn by drawPlumber. This function owns
 * the shadow, the facing, the walking cycle and the radar in the hand. Every part
 * stays inside the collision circle (PLUMBER.RADIUS = 0.33 tiles).
 *
 * @param {object} p - the plumber.
 * @param {number} t - the frame timestamp.
 * @param {number} [wx] - smoothed world position (see the y-sort in the actors
 *   pass). They default to the plumber's own position, so a caller with no
 *   smoothing still draws it in the right place.
 * @param {number} [wy]
 */
let waveK = 0;                                        // eased 0..1, so the wrench rises and falls rather than snapping

export function drawPlumber(p, t, wx, wy){
  const x=(wx===undefined?p.x:wx)*TILE, y=(wy===undefined?p.y:wy)*TILE;

  // Waving the wrench while the repair bar is filling: standing still at an open leak
  const working = !p.moving && !!leakAt(G.leaks, p.x, p.y)?.repair;
  waveK += ((working ? 1 : 0) - waveK) * 0.2;

  // A tight contact shadow, kept small so it never spills onto a wall
  ctx.fillStyle='rgba(8,6,3,0.34)';
  ctx.beginPath(); ctx.ellipse(x+1.5, y+3, TILE*0.19, TILE*0.11, 0,0,6.283); ctx.fill();

  /* The walk phase is the footstep timer, the same one that paces the footstep
     sound, so a foot is on the floor on the frame its sound plays. While standing
     still the phase keeps its last value but `gait` drops to zero, and every
     stride collapses with it. */
  const phase = p.stepDur ? 1 - p.stepT/p.stepDur : 0;

  ctx.save();
  ctx.translate(x,y);
  ctx.rotate(p.face + Math.PI/2);

  drawPlumberSprite(ctx, { T:TILE, phase, gait: p.moving ? 1 : 0, t, wave: waveK });

  ctx.restore();
}

/* The twenty fill styles of the dormant "static" speck pattern, built once when
   the module loads. The brightness of speck number i depends only on i, so
   these strings never change and need not be rebuilt every frame. */
const DORMANT_FILL = Array.from({length:20}, (_,i)=>{
  const br = Math.round(100 + Math.sin(i)*50);
  return `rgba(${br},${br},${br},0.3)`;
});

/**
 * Draws a lifeform (the Lifeform, drawn by drawLifeform). Its look depends on
 * `lf.rise`, how far up it is:
 *   dormant   a patch of static on the carpet
 *   rising    the body gathers out of its own footprint
 *   hunting   fully up
 * The shadow is drawn here and the body by the sprite.
 *
 * @param {object} lf - the lifeform.
 * @param {number} t - the frame timestamp.
 * @param {number} [wx] - smoothed world position (defaults to its own).
 * @param {number} [wy]
 */
export function drawLifeform(lf, t, wx, wy){
  const x=(wx===undefined?lf.x:wx)*TILE, y=(wy===undefined?lf.y:wy)*TILE;
  const h = lf.rise;

  // The shadow is sized to the body and not to the rise
  ctx.fillStyle='rgba(6,5,3,0.5)';
  ctx.beginPath();
  ctx.ellipse(x, y+4, TILE*0.36, TILE*0.20, 0,0,6.283);
  ctx.fill();

  if (h < 0.02){
    /* DORMANT: only the positions of the specks move (two sines each), so the
       static crawls. Their fill styles are fixed (see DORMANT_FILL). */
    for (let i=0;i<20;i++){
      const sx = x + Math.sin(i*3.7 + t*0.01)*TILE*0.25;
      const sy = y + Math.cos(i*2.3 + t*0.008)*TILE*0.10;
      ctx.fillStyle = DORMANT_FILL[i];
      ctx.fillRect(sx, sy, 2, 2);
    }
    return;
  }

  /* Walk cycle. Lifeforms have no step timer, because they are not walking,
     they are coming. The phase runs off the frame clock and the amount of stride
     comes from the state: hunting strides fully, searching drifts, walking is in
     between. */
  const gait = lf.state==='HUNT' ? 1 : lf.state==='WALK' ? 0.55 : 0.3;

  /* CLIP TO THE FLOOR. The Lifeform's legs reach further than its collision
     circle, so drawn without a clip it would stride over a partition into the
     next room, which looks like walking through walls (and a wall it can cross is
     a wall that cannot save you). The clip is the walkable tiles within 2 tiles of
     it, so its legs stop at the wall line like its body does. It is built every
     frame from the grid, at most 25 rectangles. */
  const CR = 2;
  const cx0 = Math.max(0, Math.floor(lf.x - CR)), cx1 = Math.min(MAP_W-1, Math.ceil(lf.x + CR));
  const cy0 = Math.max(0, Math.floor(lf.y - CR)), cy1 = Math.min(MAP_H-1, Math.ceil(lf.y + CR));
  ctx.save();
  ctx.beginPath();
  for (let ty=cy0; ty<=cy1; ty++)
    for (let tx=cx0; tx<=cx1; tx++)
      if (G.grid[ty*MAP_W+tx]===FLOOR) ctx.rect(tx*TILE, ty*TILE, TILE, TILE);
  ctx.clip();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-lf.face + Math.PI/2 + Math.sin(t*0.0018)*0.05);

  /* `danger` is how close it is to hunting you: 0.25 while wandering, 1 while
     chasing. It drives the rim on the hit zone. */
  drawLifeformSprite(ctx, { T:TILE, h, phase: (t*0.0009) % 1, gait, t,
                      danger: lf.state==='HUNT' ? 1 : 0.25 });

  ctx.restore();   // the rotation and translation
  ctx.restore();   // the floor clip
}

/* The drawing seam. The actors pass draws the cast through ENT.plumber and
   ENT.lifeform, so a test can replace one of them without touching the render
   loop. Extra arguments are passed straight through: the loop gives the smoothed
   wx and wy, and dropping them would draw the figure at its unsmoothed position. */
export const ENT = { plumber:(p,t,...r)=>drawPlumber(p,t,...r), lifeform:(lf,t,...r)=>drawLifeform(lf,t,...r) };