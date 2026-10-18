import { MAP_H, MAP_W, TILE } from '../config/constants.js';
import { G } from '../sim/state.js';
import { cvs, ctx, SCALE } from './canvas.js';
import { actors } from './passes/actors.js';
import { ground } from './passes/ground.js';
import { leaks } from './passes/leaks.js';
import { lighting } from './passes/lighting.js';
import { markers } from './passes/markers.js';
import { post } from './passes/post.js';
import { syncImages } from './pack.js';

/* ============================================================
   RENDER
   The camera, the clear, and the order. Everything else is a
   pass in ./passes, each handed the same frame context `rc`:

     ground   carpet, the flood and its sheen, the walls
     markers  batteries and doors
     actors   the cast, y-sorted, at the interpolated position
     lighting the bake, the mask, the fluorescents
     leaks    the pipes, ungated by the cone
     post     the danger wash, the vignette and the tape

   The first three draw INSIDE the world transform that this
   function opens and closes; the last three draw in device
   space, after it has been restored. That boundary is the
   whole reason the pass list is in this order.
   ============================================================ */

/* ---- camera ----
     ONE mapping, used everywhere:
        device_px = SCALE * (world_tiles*TILE + tx)
     so the player's own tile always lands at the centre of the viewport, and
     the light bake (which shares that origin) lines up with the geometry.
     The previous version mixed a pre-scaled offset with a device-space one and
     carried SCALE twice, which panned the world the wrong way and threw the
     player off-screen. */
export const cam = {x:0, y:0, jx:0, jy:0};

export { setSimAlpha, simAlpha } from './passes/actors.js';
export { buildGlowSprite } from './passes/lighting.js';

export function render(t){
    if (!G) return;
    syncImages();
    const p=G.player;

    // camera follow + breathing jitter.
    // Exponential smoothing with a TIME CONSTANT, not a fixed per-frame
    // fraction: 0.12/frame is twice as fast at 144fps as at 72fps, which
    // makes the camera lag inconsistently across machines.
    /* The camera eases toward the player on a wall-clock time constant, which
       is correct precisely because the world now advances on its own fixed
       clock: there is no longer a capped dt for the view to disagree with. */
    /* The smoothing constant is a TIME CONSTANT against the wall clock, which
       is correct now that the world advances on its own fixed clock: the camera
       is easing toward a position the simulation owns, and the ease takes 90ms
       regardless of how many steps got there. */
    const dt   = Math.max(0.001, Math.min(0.1, (t - (render.prevT || t-16))/1000));
    render.prevT = t;
    /* Elapsed seconds for the RATE clocks — the tube dropouts and the tape dropouts,
       which must fire at the same frequency per second on every machine.

       CLAMPED, and the clamp matters. Left unclamped, a tab that comes back from
       the background arrives with a delta of however long it was away — tens of
       seconds — and the dropout loops below run once per 50ms of it, so a single
       frame after a long pause issues thousands of draws. The clamp is generous
       enough that no real frame interval ever hits it (a quarter-second is a 4fps
       frame) and tight enough that the worst case is five iterations. Making up
       missed tape wear is not the point: nobody ever saw the frames they missed,
       so replaying them is work for no one. */
    render.dt = Math.min(0.25, Math.max(0, (t - (render.prevTRaw ?? (t-16)))/1000));
    render.prevTRaw = t;
    const k    = 1 - Math.exp(-dt/0.09);
    cam.x += (p.x - cam.x) * k;
    cam.y += (p.y - cam.y) * k;
    const breathe = Math.sin(t*0.0009)*0.06;
    /* Shake is a multiplier on the camera jitter, not a new system — the
       breathing motion and the VHS wobble were already here, and a settings
       slider that scales them turns both off at 0. */
    /* Camera jitter. Always on: the breathing sway and the handheld wobble were
       here before the slider existed, and a "camera shake" preference could
       only ever be OFF (0) or exactly what the game already did (1). Turning it
       down did not make the game calmer, it made the camera less honest.

       SCALED BY dt. This offset is a per-frame random draw, so at 30fps it
       delivers twice the displacement per second that it does at 60 — the
       handheld wobble was in fact half as lively on a slow machine, which is
       the opposite of what a struggling machine should look like. Scaling the
       amplitude by the square root of the frame ratio keeps the per-second
       character identical across refresh rates. */
    const jscale = Math.sqrt(dt/0.0167);
    cam.jx = (Math.random()-0.5)*0.10*jscale + breathe*0.35;
    cam.jy = (Math.random()-0.5)*0.10*jscale;

    // clamp to the maze so the viewport is never half off-map void
    const T = TILE*SCALE;
    const halfW = cvs.width /(2*T), halfH = cvs.height/(2*T);
    if (MAP_W > halfW*2) cam.x = Math.max(halfW, Math.min(MAP_W-halfW, cam.x));
    if (MAP_H > halfH*2) cam.y = Math.max(halfH, Math.min(MAP_H-halfH, cam.y));

    // translate applied inside the scaled context, in world pixels
    const tx = -cam.x*TILE + cvs.width /(2*SCALE) + cam.jx;
    const ty = -cam.y*TILE + cvs.height/(2*SCALE) + cam.jy;
    // same mapping, expressed in device pixels
    const dx = tx*SCALE, dy = ty*SCALE;
    const w2sx = wx => SCALE*(wx*TILE + tx);
    const w2sy = wy => SCALE*(wy*TILE + ty);

    // clean slate. Without this, anything the scene does not paint (the
    // off-map margin at the maze edges) keeps last frame's pixels and the
    // post-processors compound on top of it.
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalAlpha=1;
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='#000';
    ctx.fillRect(0,0,cvs.width,cvs.height);

    ctx.setTransform(SCALE,0,0,SCALE,0,0);
    ctx.save();
    ctx.translate(tx, ty);

    const tlx = Math.floor(cam.x - cvs.width /(2*T)) - 1;
    const tly = Math.floor(cam.y - cvs.height/(2*T)) - 1;
    const tw  = Math.ceil(cvs.width /T) + 3;
    const th  = Math.ceil(cvs.height/T) + 3;

    const x0=Math.max(0,tlx), y0=Math.max(0,tly);
  const x1=Math.min(MAP_W-1,tlx+tw), y1=Math.min(MAP_H-1,tly+th);
  const vw = x1-x0+1, vh = y1-y0+1;

  const rc = { t, dt:render.dt, tx, ty, dx, dy, x0, y0, x1, y1, vw, vh, T, w2sx, w2sy, p };

  ground(rc);
  markers(rc);
  actors(rc);
  ctx.restore();

  lighting(rc);
  leaks(rc);
  post(rc);
}
