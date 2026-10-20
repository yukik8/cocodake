// Takeout URLs name a place by its feature ID, e.g.
// https://www.google.com/maps/place/Munich/data=!4m2!3m1!1s0x479e7600b4a01453:0x316a8592ea327bab
// - The second half is the place's CID, the number in maps.google.com/?cid=…, so a search result
//   can be checked against it.
// - The first half is an S2 cell ID, a position on the globe. It is usually within a few hundred
//   metres of the place but sometimes kilometres off, so it only steers the search and is never
//   saved as the place's position.
// Google does not document either; when they don't hold, the import falls back to a name search.

export interface FeatureId {
  cid: string;
  near: { lat: number; lng: number };
}

export function parseFeatureId(url: string): FeatureId | null {
  const m = url.match(/!1s(0x[0-9a-f]{1,16}):(0x[0-9a-f]{1,16})/i);
  if (!m) return null;
  const cell = BigInt(m[1]);
  const cid = BigInt(m[2]);
  if (cell === BigInt(0) || cid === BigInt(0)) return null;
  return { cid: cid.toString(), near: s2CellToLatLng(cell) };
}

// S2 cell ID → latitude/longitude (the S2 geometry library's Hilbert-curve layout)
const POS_TO_IJ = [
  [0, 1, 3, 2],
  [0, 2, 3, 1],
  [3, 2, 0, 1],
  [3, 1, 0, 2],
];
const POS_TO_ORIENTATION = [1, 0, 0, 3];

function stToUv(s: number) {
  return s >= 0.5 ? (4 * s * s - 1) / 3 : (1 - 4 * (1 - s) * (1 - s)) / 3;
}

function faceUvToXyz(face: number, u: number, v: number): [number, number, number] {
  switch (face) {
    case 0: return [1, u, v];
    case 1: return [-u, 1, v];
    case 2: return [-u, -v, 1];
    case 3: return [-1, -v, -u];
    case 4: return [v, -1, -u];
    default: return [v, u, -1];
  }
}

function s2CellToLatLng(cell: bigint): { lat: number; lng: number } {
  const face = Number(cell >> BigInt(61));
  let orientation = face & 1;
  let i = 0;
  let j = 0;
  for (let level = 0; level < 30; level++) {
    const pos = Number((cell >> BigInt(59 - 2 * level)) & BigInt(3));
    const ij = POS_TO_IJ[orientation][pos];
    i = i * 2 + (ij >> 1);
    j = j * 2 + (ij & 1);
    orientation ^= POS_TO_ORIENTATION[pos];
  }
  const size = 2 ** 30;
  const [x, y, z] = faceUvToXyz(face, stToUv((i + 0.5) / size), stToUv((j + 0.5) / size));
  const deg = 180 / Math.PI;
  return { lat: Math.atan2(z, Math.hypot(x, y)) * deg, lng: Math.atan2(y, x) * deg };
}
