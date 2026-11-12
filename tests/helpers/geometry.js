/* Measures what a drawing paints, not what its source says.

   paintedReach() runs a draw function against a recording context that tracks
   the full affine transform (translate, rotate, scale, setTransform, save and
   restore), so each limb lands where a real canvas would put it. Every painted
   point is mapped into the drawing's own origin frame. A stroke grows the reach
   by half its line width, because that is how far the ink extends past its
   path. The result is the distance of the farthest painted point from the
   origin: the number a collision disc has to contain.

   The context refuses any method it does not model. A silent no-op would make a
   new kind of mark invisible to the measurement, and the test would pass for the
   wrong reason. */

const ELLIPSE_STEPS = 64;

export function paintedReach(draw){
  let m = [1, 0, 0, 1, 0, 0];                 // a b c d e f, as in ctx.transform
  let stack = [];
  let path = [];                              // painted-path points, origin frame
  let lineWidth = 1;
  let reach = 0;

  const mul = (n) => {
    const [a, b, c, d, e, f] = m, [A, B, C, D, E, F] = n;
    m = [a*A + c*B, b*A + d*B, a*C + c*D, b*C + d*D, a*E + c*F + e, b*E + d*F + f];
  };
  const map = (x, y) => [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]];
  const addPoint = (x, y) => { path.push(map(x, y)); };
  const addEllipse = (cx, cy, rx, ry, rot, a0, a1) => {
    const cr = Math.cos(rot || 0), sr = Math.sin(rot || 0);
    for (let i = 0; i <= ELLIPSE_STEPS; i++){
      const th = a0 + (a1 - a0) * i / ELLIPSE_STEPS;
      const ex = rx * Math.cos(th), ey = ry * Math.sin(th);
      addPoint(cx + ex*cr - ey*sr, cy + ex*sr + ey*cr);
    }
  };
  const take = (pad) => {
    for (const [x, y] of path) reach = Math.max(reach, Math.hypot(x, y) + pad);
  };

  const ctx = {
    get lineWidth(){ return lineWidth; },
    set lineWidth(v){ lineWidth = v; },
    save(){ stack.push([m.slice(), lineWidth]); },
    restore(){ const s = stack.pop(); if (s){ m = s[0]; lineWidth = s[1]; } },
    translate(x, y){ mul([1, 0, 0, 1, x, y]); },
    rotate(a){ const c = Math.cos(a), s = Math.sin(a); mul([c, s, -s, c, 0, 0]); },
    scale(x, y){ mul([x, 0, 0, y, 0, 0]); },
    setTransform(a, b, c, d, e, f){ m = [a, b, c, d, e, f]; },
    beginPath(){ path = []; },
    closePath(){},
    moveTo(x, y){ addPoint(x, y); },
    lineTo(x, y){ addPoint(x, y); },
    rect(x, y, w, h){ addPoint(x, y); addPoint(x+w, y); addPoint(x+w, y+h); addPoint(x, y+h); },
    ellipse(cx, cy, rx, ry, rot, a0, a1){ addEllipse(cx, cy, rx, ry, rot, a0, a1); },
    arc(x, y, r, a0, a1){ addEllipse(x, y, r, r, 0, a0, a1); },
    /* fill and stroke paint the current path; clip only restricts later paint */
    fill(){ take(0); },
    stroke(){ take(lineWidth / 2); },
    fillRect(x, y, w, h){
      const saved = path; path = [];
      ctx.rect(x, y, w, h); take(0);
      path = saved;
    },
    clip(){},
    /* plain properties the drawing code writes and never reads back */
    fillStyle: '', strokeStyle: '', globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
  };

  const guarded = new Proxy(ctx, {
    get(t, k){
      if (k in t) return t[k];
      if (typeof k === 'symbol') return undefined;
      return () => { throw new Error(`paintedReach: canvas method "${k}" is not modelled, so its marks would be unmeasured`); };
    },
    set(t, k, v){ t[k] = v; return true; },
  });

  draw(guarded);
  return reach;
}
