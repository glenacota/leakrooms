/**
 * Walks a Bresenham line from start through end, calling visit for each tile.
 * Return false from visit to stop early. The return value says whether the end
 * was reached. inclusive selects the historical tie rule used by wallSteps.
 *
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {(x:number,y:number,end:boolean)=>boolean|void} visit
 * @param {{limit?:number,inclusive?:boolean}} [options]
 * @returns {boolean} true if the end was reached
 */
export function walkLine(x0, y0, x1, y1, visit, {limit=Infinity, inclusive=false}={}){
  const dx=Math.abs(x1-x0), dy=Math.abs(y1-y0);
  const sx=x0<x1?1:-1, sy=y0<y1?1:-1;
  let err=dx-dy, steps=0;
  while (true){
    const end=x0===x1 && y0===y1;
    if (visit(x0,y0,end)===false) return end;
    if (end) return true;
    if (steps++ >= limit) return false;
    const e2=2*err;
    if (inclusive ? e2 >= -dy : e2 > -dy){ err-=dy; x0+=sx; }
    if (inclusive ? e2 <= dx : e2 < dx){ err+=dx; y0+=sy; }
  }
}
