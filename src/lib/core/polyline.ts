// Google encoded polyline (precision 1e5) and Douglas–Peucker simplification.
// Points are [lat, lng].

export type LatLng = [number, number];

export function encodePolyline(points: LatLng[]): string {
  let out = "";
  let pLat = 0;
  let pLng = 0;
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    while (x >= 0x20) {
      out += String.fromCharCode((0x20 | (x & 0x1f)) + 63);
      x >>= 5;
    }
    out += String.fromCharCode(x + 63);
  };
  for (const [lat, lng] of points) {
    const a = Math.round(lat * 1e5);
    const b = Math.round(lng * 1e5);
    enc(a - pLat);
    enc(b - pLng);
    pLat = a;
    pLng = b;
  }
  return out;
}

export function decodePolyline(s: string): LatLng[] {
  const out: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const dec = () => {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += dec();
    lng += dec();
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

const M_PER_DEG = 111_320;

/** Simplify with tolerance in metres (local equirectangular projection). */
export function simplify(points: LatLng[], tolM: number): LatLng[] {
  if (points.length < 3) return points.slice();
  const k = Math.cos((points[0][0] * Math.PI) / 180);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const tol2 = tolM * tolM;
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const ax = points[a][1] * k * M_PER_DEG;
    const ay = points[a][0] * M_PER_DEG;
    const bx = points[b][1] * k * M_PER_DEG;
    const by = points[b][0] * M_PER_DEG;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let best = -1;
    let bestD = tol2;
    for (let i = a + 1; i < b; i++) {
      const px = points[i][1] * k * M_PER_DEG - ax;
      const py = points[i][0] * M_PER_DEG - ay;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const ex = px - t * dx;
      const ey = py - t * dy;
      const d = ex * ex + ey * ey;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
