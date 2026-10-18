import { FLOOR, LS, MAP_H, MAP_W, TILE, WALL, WALL_FACE } from '../config/constants.js';
import { hash2 } from '../util/hash.js';
import { G } from '../sim/state.js';
import { carpetPat, ceilPat, wallPat } from './textures.js';

/**
 * Turns the light bake (G.lightArr) into a canvas, and paints the static tile
 * layers. Runs once per floor, from buildFloor.
 *
 * Only the ambient light is packed here. Everything that depends on the viewer
 * (room scope, cone of vision, radar) is a separate mask on its own canvas, so
 * there is exactly one multiply, and the mask can only remove light that the
 * bake provides.
 */
export function attachFloorImages(){
  G.lightCv = document.createElement('canvas');
  G.lightCv.width = MAP_W*LS; G.lightCv.height = MAP_H*LS;
  G.lightCtx = G.lightCv.getContext('2d');
  G.lightImg = G.lightCtx.createImageData(G.lightCv.width, G.lightCv.height);
  // Canvas size and pixel buffer are looked up once here, because reading them in the loop is slow.
  const LW = G.lightCv.width, LH = G.lightCv.height, LD = G.lightImg.data;
  for (let y=0;y<LH;y++){
    const ty=(y/LS)|0, row=ty*MAP_W;
    for (let x=0;x<LW;x++){
      /* The bake is pure brightness (grey), with no tint. It used to be tinted
         yellow with a warm lift to stop unlit floor going black. Now darkness
         is the mask's job, and tinting the bake would apply the yellow twice: a
         lit room would come out green-yellow on top of a palette that is already
         the right colour. The hue comes from the surfaces themselves. */
      const b = Math.min(1, G.lightArr[row + ((x/LS)|0)]);
      const v = Math.round(255*b);
      const k=(y*LW+x)*4;
      LD[k]=v; LD[k+1]=v; LD[k+2]=v;
      LD[k+3] = 255;
    }
  }
  G.lightCtx.putImageData(G.lightImg, 0, 0);

  bakeTiles();
}

/**
 * Paints the static tile layers once per floor: the carpet and the wall faces
 * and tops. They depend only on the grid, which never changes while a floor is
 * played, so drawing them again every frame would be about 980 fillRect calls
 * of pixels that never change. Instead they are drawn into two canvases the
 * size of the whole map, and the renderer copies the visible part out with one
 * drawImage each.
 *
 * There are TWO canvases because the flood has to be drawn between the carpet
 * and the wall faces: a partition standing in a flooded room stays dry.
 *
 * The patterns are anchored to the world grid. When they were drawn live, their
 * position followed the camera and the speckles swam as the view moved. Baked,
 * they are part of the building.
 */
export function bakeTiles(){
  G.tilesCv = document.createElement('canvas');
  G.tilesCv.width = MAP_W*TILE; G.tilesCv.height = MAP_H*TILE;
  G.tilesCtx = G.tilesCv.getContext('2d');
  {
    const g = G.tilesCtx;
    g.setTransform(1,0,0,1,0,0);
    // ---------- Carpet ----------
    g.fillStyle = carpetPat;
    g.fillRect(0, 0, MAP_W*TILE, MAP_H*TILE);
    // A little random tonal variation on some tiles
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
    /* ---------- Wall faces and contact shadow ----------
       The face is the vertical side of a partition, drawn into the floor tile
       below the wall. A soft shadow on the carpet under it sells the height, and
       is what makes a top-down maze look like a photographed room and not a
       colour-coded grid. */
    const FACE = WALL_FACE;
    for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
      if (G.grid[y*MAP_W+x]!==WALL) continue;
      if (y+1>=MAP_H || G.grid[(y+1)*MAP_W+x]!==FLOOR) continue;
      const fx=x*TILE, fy=(y+1)*TILE;

      // Shadow cast onto the carpet
      const sh=g.createLinearGradient(0, fy, 0, fy+TILE*0.5);
      sh.addColorStop(0,'rgba(12,10,4,0.30)');
      sh.addColorStop(1,'rgba(12,10,4,0)');
      g.fillStyle=sh;
      g.fillRect(fx, fy, TILE, TILE*0.5);

      // The wallpapered face
      g.fillStyle = wallPat;
      g.fillRect(fx, fy, TILE, FACE);
      // A hard line where the face meets the ceiling
      g.fillStyle='rgba(40,38,24,0.55)';
      g.fillRect(fx, fy, TILE, 2);
      // A skirting shadow at the base
      g.fillStyle='rgba(48,46,30,0.42)';
      g.fillRect(fx, fy+FACE-2, TILE, 2);
    }

    /* ---------- Wall tops ----------
       Seen from directly above, so they are cooler and clearly darker than the
       carpet. There is no banding on each tile: a lip, edge and seam on every tile
       made a solid wall block look like decking. Edges are only drawn where the
       wall actually meets carpet. */
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