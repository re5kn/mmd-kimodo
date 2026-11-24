import * as THREE from 'three';

/**
 * Procedural, tileable detail normal maps (weave for cloth, strands for
 * hair). Models do not ship such maps, so they are generated once here and
 * tiled over each material at a fixed size on the model.
 */

/** Periodic value noise on a `cells`×`cells` lattice that wraps at 1. */
function makeNoise(seed: number, cellsX: number, cellsY = cellsX) {
  const rnd = new Float32Array(cellsX * cellsY);
  let s = seed >>> 0;
  for (let i = 0; i < rnd.length; i++) {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    rnd[i] = (s >>> 0) / 0xffffffff;
  }
  const at = (ix: number, iy: number) => rnd[(((iy % cellsY) + cellsY) % cellsY) * cellsX + (((ix % cellsX) + cellsX) % cellsX)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (u: number, v: number) => {
    const x = u * cellsX;
    const y = v * cellsY;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/** Builds a tangent-space normal map (RGBA8, repeat wrapping) from a height field. */
export function heightToNormalMap(size: number, height: (u: number, v: number) => number, strength: number): THREE.DataTexture {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = height(x / size, y / size);
  const data = new Uint8Array(size * size * 4);
  const H = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const SIZE = 256;

/** Twill weave with fuzzy fibers: one tile = one `CLOTH_TILE` square on the model. */
export function createClothDetailMap(): THREE.DataTexture {
  const fuzz = makeNoise(1, 64);
  const fiber = makeNoise(2, 128);
  const blotch = makeNoise(3, 8);
  const ribs = 24;
  return heightToNormalMap(
    SIZE,
    (u, v) => {
      const twill = 0.5 + 0.5 * Math.sin(2 * Math.PI * ribs * (u + v));
      return twill * 0.5 + fuzz(u, v) * 0.35 + fiber(u, v) * 0.25 + blotch(u, v) * 0.3;
    },
    6,
  );
}

/** Fine strands running along V (the usual direction of hair texture layouts). */
export function createHairDetailMap(): THREE.DataTexture {
  const strands = makeNoise(4, 96, 3);
  const thin = makeNoise(5, 192, 2);
  return heightToNormalMap(SIZE, (u, v) => strands(u, v) * 0.7 + thin(u, v) * 0.5, 8);
}

/** Model units (MMD: 1 ≈ 8 cm) covered by one tile of each detail map. */
export const CLOTH_TILE = 0.6;
export const HAIR_TILE = { across: 1.2, along: 8 };

/**
 * Model units per UV unit over a range of triangles, i.e. how large the
 * texture is on the model (0 when the range has no UV area).
 */
export function uvDensity(positions: ArrayLike<number>, uvs: ArrayLike<number>, indices: ArrayLike<number>, start: number, count: number): number {
  let world = 0;
  let uv = 0;
  for (let t = start; t + 2 < start + count; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    const e1x = positions[b * 3] - positions[a * 3];
    const e1y = positions[b * 3 + 1] - positions[a * 3 + 1];
    const e1z = positions[b * 3 + 2] - positions[a * 3 + 2];
    const e2x = positions[c * 3] - positions[a * 3];
    const e2y = positions[c * 3 + 1] - positions[a * 3 + 1];
    const e2z = positions[c * 3 + 2] - positions[a * 3 + 2];
    world += Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x);
    const u1 = uvs[b * 2] - uvs[a * 2];
    const v1 = uvs[b * 2 + 1] - uvs[a * 2 + 1];
    const u2 = uvs[c * 2] - uvs[a * 2];
    const v2 = uvs[c * 2 + 1] - uvs[a * 2 + 1];
    uv += Math.abs(u1 * v2 - v1 * u2);
  }
  return uv > 1e-12 ? Math.sqrt(world / uv) : 0;
}
