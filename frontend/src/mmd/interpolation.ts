/**
 * VMD bezier interpolation. Control points are (x1/127, y1/127), (x2/127, y2/127)
 * on a curve from (0,0) to (1,1). Given progress x in [0,1], returns eased y.
 */
export function bezierEase(x: number, x1: number, y1: number, x2: number, y2: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const ax1 = x1 / 127, ay1 = y1 / 127, ax2 = x2 / 127, ay2 = y2 / 127;
  if (ax1 === ay1 && ax2 === ay2) return x; // linear

  // Solve bx(t) = x by bisection (bx is monotonic for control x in [0,1]).
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 32; i++) {
    t = (lo + hi) / 2;
    const bx = cubic(t, ax1, ax2);
    if (Math.abs(bx - x) < 1e-6) break;
    if (bx < x) lo = t;
    else hi = t;
  }
  return cubic(t, ay1, ay2);
}

function cubic(t: number, p1: number, p2: number): number {
  const s = 1 - t;
  return 3 * s * s * t * p1 + 3 * s * t * t * p2 + t * t * t;
}
