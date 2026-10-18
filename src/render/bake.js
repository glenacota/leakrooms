import { FLOOR, LS, MAP_H, MAP_W, TILE, WALL, WALL_FACE } from '../config/constants.js';
import { hash2 } from '../util/hash.js';
import { G } from '../sim/state.js';
import { carpetPat, ceilPat, wallPat } from './textures.js';

/* Packs the light bake into G.lightCv/G.lightCtx/G.lightImg and bakes the
   static tile layer. These are the floor's pixels: everything the renderer
   reads, off the G.lightArr that computeLightArr filled. */
export function attachFloorImages(){
  /* Pack the BAKE — pure, unchanged. Every viewer-side term (room scope, cone of
     vision, radar) is folded into a single mask on a separate canvas, so there
     is exactly one multiply and the mask can only ever remove light the bake
     put there. */
  G.lightCv = document.createElement('canvas');
  G.lightCv.width = MAP_W*LS; G.lightCv.height = MAP_H*LS;
  G.lightCtx = G.lightCv.getContext('2d');
  G.lightImg = G.lightCtx.createImageData(G.lightCv.width, G.lightCv.height);
  /* The canvas dimensions and the pixel buffer are DOM-backed reads: they are
     resolved once here instead of per iteration, and every write below goes
     through the local buffer reference. Same pixels, same order. */
  const LW = G.lightCv.width, LH = G.lightCv.height, LD = G.lightImg.data;
  for (let y=0;y<LH;y++){
    const ty=(y/LS)|0, row=ty*MAP_W;
    for (let x=0;x<LW;x++){
      /* NEUTRAL, not mono-yellow. This used to be tinted (255,246,186) plus a
         warm +18 lift, which existed to stop unlit floor going black. Now that
         darkness is the mask's job, tinting the bake would double-count it:
         a lit room would come out green-yellow a second time on top of a
         palette that is already the right colour. The bake is now a pure
         brightness, and the hue comes from the surfaces themselves. */
      const b = Math.min(1, G.lightArr[row + ((x/LS)|0)]);
      const v = Math.round(255*b);
      const k=(y*LW+x)*4;
      LD[k]=v; LD[k+1]=v; LD[k+2]=v;
      LD[k+3] = 255;
    }
  }
  G.lightCtx.putImageData(G.lightImg, 0, 0);

  /* The static tile layer, baked in the same stage: sections 1-3 of the
     renderer are entirely static. The carpet, the hash2 tonal variation, the
     wall faces, the wall tops and their edge highlights depend on nothing but
     the grid, which never changes while a floor is played. Painting them per
     viewport per frame was ~980 fillRect calls of unchanged pixels, so they
     are drawn into two world-sized canvases here and the renderer samples the
     viewport out of them with one drawImage each.

     TWO canvases, not one: the flood has to land BETWEEN the carpet and the
     wall faces — a partition standing in a flooded room stays dry — so the
     carpet and the walls cannot share a single layer.

     The patterns are anchored to the world grid here. The live code filled
     them under the camera transform, which tied their phase to the camera
     position, so the speckles swam as the view panned; baked, they are part
     of the building, which is what they always looked like they were. */
  bakeTiles();
}

/* Paint the static tile layer: carpet + tonal variation into G.tilesCv, wall
   faces + tops into G.wallsCv. Runs once per floor, from bakeLighting, with G
   and its grid already in place. Every pixel below is byte-for-byte the same
   drawing the renderer used to do per frame — same patterns, same coordinates,
   same order — over the whole map instead of the viewport. */
export function bakeTiles(){
  G.tilesCv = document.createElement('canvas');
  G.tilesCv.width = MAP_W*TILE; G.tilesCv.height = MAP_H*TILE;
  G.tilesCtx = G.tilesCv.getContext('2d');
  {
    const g = G.tilesCtx;
    g.setTransform(1,0,0,1,0,0);
    /* ---------- carpet ---------- */
    g.fillStyle = carpetPat;
    g.fillRect(0, 0, MAP_W*TILE, MAP_H*TILE);
    // per-tile tonal variation
    for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
      const h=hash2(x,y);
      if (h<0.14){
        g.fillStyle = h<0.05 ? 'rgba(163,163,112,0.16)' : 'rgba(228,230,168,0.10)';
        g.fillRect(x*TILE, y*TILE, TILE, TILE);
      }
    }
  }

  G.wallsCv = document.createElement('canvas');
  G.wallsCv.width = MAP_W*TILE; G.wallsCv.height = MAP_H*TILE;
  G.wallsCtx = G.wallsCv.getContext('2d');
  {
    const g = G.wallsCtx;
    g.setTransform(1,0,0,1,0,0);
    /* ---------- wall faces + contact shadow ---------- */
    // The face is the vertical side of a partition, drawn into the floor tile
    // below it. A soft shadow on the carpet under it sells the height, which is
    // what makes a top-down maze read as a photographed room instead of a
    // colour-coded grid.
    const FACE = WALL_FACE;
    for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
      if (G.grid[y*MAP_W+x]!==WALL) continue;
      if (y+1>=MAP_H || G.grid[(y+1)*MAP_W+x]!==FLOOR) continue;
      const fx=x*TILE, fy=(y+1)*TILE;

      // shadow cast onto the carpet
      const sh=g.createLinearGradient(0, fy, 0, fy+TILE*0.5);
      sh.addColorStop(0,'rgba(12,10,4,0.30)');
      sh.addColorStop(1,'rgba(12,10,4,0)');
      g.fillStyle=sh;
      g.fillRect(fx, fy, TILE, TILE*0.5);

      // wallpapered face
      g.fillStyle = wallPat;
      g.fillRect(fx, fy, TILE, FACE);
      // hard line where the face meets the ceiling
      g.fillStyle='rgba(40,38,24,0.55)';
      g.fillRect(fx, fy, TILE, 2);
      // skirting shadow at the base
      g.fillStyle='rgba(48,46,30,0.42)';
      g.fillRect(fx, fy+FACE-2, TILE, 2);
    }

    /* ---------- wall tops ---------- */
    // Seen from directly above, so they read as the top of a partition: cooler
    // and clearly darker than the carpet. Deliberately NO per-tile banding —
    // a lip/edge/seam on every tile made a solid wall block look like decking.
    // Edges are drawn only where wall actually meets carpet.
    for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
      if (G.grid[y*MAP_W+x]!==WALL) continue;
      g.fillStyle = ceilPat;
      g.fillRect(x*TILE, y*TILE, TILE, TILE);
    }
    g.fillStyle='rgba(28,26,16,0.55)';
    for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
      if (G.grid[y*MAP_W+x]!==WALL) continue;
      const below = (y+1<MAP_H && G.grid[(y+1)*MAP_W+x]===FLOOR);
      if (below){ g.fillRect(x*TILE, y*TILE+TILE-2, TILE, 2); }
      if (x>0      && G.grid[y*MAP_W+x-1]===FLOOR) g.fillRect(x*TILE, y*TILE, 2, TILE);
      if (x<MAP_W-1 && G.grid[y*MAP_W+x+1]===FLOOR) g.fillRect(x*TILE+TILE-2, y*TILE, 2, TILE);
      if (y>0      && G.grid[(y-1)*MAP_W+x]===FLOOR) g.fillRect(x*TILE, y*TILE, TILE, 2);
      if (y<MAP_H-1 && G.grid[(y+1)*MAP_W+x]===FLOOR) g.fillRect(x*TILE, y*TILE+TILE-2, TILE, 2);
    }
  }
}
