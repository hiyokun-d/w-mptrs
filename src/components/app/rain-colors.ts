// Rain colour ramp by BMKG hourly category (mm/h).

export function rainRGBA(r: number): [number, number, number, number] {
  if (r < 0.5) return [0, 0, 0, 0];
  if (r < 1) return [125, 211, 252, 70];
  if (r < 5) return [56, 189, 248, 120];
  if (r < 10) return [37, 99, 235, 150];
  if (r < 20) return [124, 58, 237, 170];
  return [219, 39, 119, 185];
}

export function rainCss(r: number): string {
  const [a, b, c] = rainRGBA(Math.max(r, 0.6));
  return `rgb(${a} ${b} ${c})`;
}
