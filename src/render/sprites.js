/**
 * Builds a radial-gradient sprite on an offscreen canvas.
 * Stops are [offset, colour] pairs; geometry can override the center and radii
 * to preserve existing sprite shapes.
 *
 * @param {number} w
 * @param {number} h
 * @param {{stops:Array<[number,string]>,cx?:number,cy?:number,r0?:number,r1?:number}} stops
 * @returns {HTMLCanvasElement}
 */
export function radialSprite(w, h, stops){
  const cv=document.createElement('canvas');
  cv.width=w; cv.height=h;
  const c=cv.getContext('2d');
  const {cx=w/2,cy=h/2,r0=0,r1=Math.max(w,h)/2}=stops;
  const g=c.createRadialGradient(cx,cy,r0,cx,cy,r1);
  for (const [offset, colour] of stops.stops) g.addColorStop(offset,colour);
  c.fillStyle=g;
  c.fillRect(0,0,w,h);
  return cv;
}
