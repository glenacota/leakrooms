export const TAU = Math.PI * 2;

export function limb(g, x1, y1, x2, y2, w, col) {
  g.strokeStyle = col;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.lineCap = 'butt';
}

export function blob(g, cx, cy, rx, ry, col, rot) {
  g.fillStyle = col;
  g.beginPath(); g.ellipse(cx, cy, rx, ry, rot || 0, 0, TAU); g.fill();
}