import * as THREE from 'three';

/**
 * Stand-ins for MMD's shared toon textures (Issue #11 A2).
 *
 * PMX materials can point at toon01.bmp..toon10.bmp from MMD's Data folder
 * instead of shipping their own toon image. Those files belong to MMD and
 * cannot be redistributed, so this module draws look-alike ramps from a few
 * numbers each (shadow color, where the shadow starts, how soft the edge is).
 *
 * A toon texture is read top to bottom: the top row is the fully lit color,
 * the bottom row the color in shadow (MMD samples v = 0.5 - 0.5 * N·L).
 * The colors below were picked to match the originals by eye and by
 * sampling them locally; no pixel data of the originals is included.
 */
export interface ToonRampSpec {
  /** Color in light (sRGB hex). */
  lit: number;
  /** Color in shadow (sRGB hex). */
  shade: number;
  /** Where the shadow starts, 0 (top) .. 1 (bottom). 0.5 is N·L = 0. */
  edge: number;
  /** Width of the lit-to-shadow blend, in the same units (0: hard step). */
  softness: number;
  /** Optional bright band inside the lit part (metallic toons). */
  highlight?: { at: number; width: number; color: number };
}

/** toon01..toon10, indexed like PMX's shared toon index (0 = toon01). */
export const SHARED_TOON_SPECS: readonly ToonRampSpec[] = [
  // toon01: neutral light gray, the most common choice.
  { lit: 0xffffff, shade: 0xcdcdcd, edge: 0.5, softness: 0 },
  // toon02: pale pink, often used for skin.
  { lit: 0xffffff, shade: 0xf5e1e1, edge: 0.5, softness: 0 },
  // toon03: dark gray.
  { lit: 0xffffff, shade: 0x9a9a9a, edge: 0.5, softness: 0 },
  // toon04: very light warm beige.
  { lit: 0xffffff, shade: 0xf8efeb, edge: 0.5, softness: 0 },
  // toon05: soft gradient into a peach skin shadow.
  { lit: 0xffffff, shade: 0xffe7dd, edge: 0.56, softness: 0.22 },
  // toon06: gold. Yellow even in light, with a sparkle band and an olive-gold shadow.
  { lit: 0xffed61, shade: 0xc3ac03, edge: 0.69, softness: 0.12, highlight: { at: 0.3, width: 0.07, color: 0xfffbe0 } },
  // toon07..toon10: blank (white) in the distributed set, left for users to replace.
  { lit: 0xffffff, shade: 0xffffff, edge: 0.5, softness: 0 },
  { lit: 0xffffff, shade: 0xffffff, edge: 0.5, softness: 0 },
  { lit: 0xffffff, shade: 0xffffff, edge: 0.5, softness: 0 },
  { lit: 0xffffff, shade: 0xffffff, edge: 0.5, softness: 0 },
];

/** Rows in a generated ramp (the originals are 32×32). */
export const TOON_RAMP_ROWS = 32;

const rgb = (hex: number): [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const smooth = (t: number) => t * t * (3 - 2 * t);

/** sRGB color (0-255 each) of the ramp at `t` (0: top / lit, 1: bottom / shadow). */
export function toonRampColor(spec: ToonRampSpec, t: number): [number, number, number] {
  const lit = rgb(spec.lit);
  const shade = rgb(spec.shade);
  const k = spec.softness > 0 ? smooth(THREE.MathUtils.clamp((t - spec.edge) / spec.softness, 0, 1)) : t >= spec.edge ? 1 : 0;
  let c = lit.map((l, i) => l + (shade[i] - l) * k);
  if (spec.highlight) {
    const h = spec.highlight;
    const w = Math.max(1 - Math.abs(t - h.at) / (h.width / 2), 0);
    const hc = rgb(h.color);
    c = c.map((v, i) => v + (hc[i] - v) * smooth(w));
  }
  return c.map((v) => Math.round(THREE.MathUtils.clamp(v, 0, 255))) as [number, number, number];
}

/**
 * Builds a 1×N toon ramp texture. Row 0 is the top of the image (lit), as
 * with PMX textures loaded with `flipY = false`.
 */
export function createToonRampTexture(spec: ToonRampSpec, rows = TOON_RAMP_ROWS): THREE.DataTexture {
  const data = new Uint8Array(rows * 4);
  for (let y = 0; y < rows; y++) {
    // Sample at texel centers, like the GPU does.
    const [r, g, b] = toonRampColor(spec, (y + 0.5) / rows);
    data.set([r, g, b, 255], y * 4);
  }
  const tex = new THREE.DataTexture(data, 1, rows, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** All stand-ins, indexed like SHARED_TOON_SPECS (0 = toon01). */
export function createSharedToonTextures(): THREE.DataTexture[] {
  return SHARED_TOON_SPECS.map((s) => createToonRampTexture(s));
}

/**
 * Shared toon index (0 = toon01 .. 9 = toon10) that a texture path names,
 * e.g. "toon03.bmp" or "Data/toon10.bmp". Some PMX files reference MMD's
 * files by name instead of using the shared-toon flag.
 */
export function sharedToonIndexFromPath(path: string | undefined): number | null {
  const m = /(?:^|[\\/])toon(0[1-9]|10)\.bmp$/i.exec(path ?? '');
  return m ? Number(m[1]) - 1 : null;
}
