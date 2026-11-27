// Generates a tiny test model (PMX 2.0) with a texture and a short walk-like
// VMD motion, using only Node built-ins.
//   node scripts/make-sample.mjs <outDir>
// Output: <outDir>/sample-model/sample.pmx, <outDir>/sample-model/tex/checker.png,
//         <outDir>/sample-walk.vmd
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const outDir = process.argv[2] ?? 'samples';

// ---------------------------------------------------------------- binary writer
class Writer {
  constructor() { this.chunks = []; }
  bytes(b) { this.chunks.push(Buffer.from(b)); return this; }
  u8(v) { const b = Buffer.alloc(1); b.writeUInt8(v); return this.bytes(b); }
  i8(v) { const b = Buffer.alloc(1); b.writeInt8(v); return this.bytes(b); }
  i16(v) { const b = Buffer.alloc(2); b.writeInt16LE(v); return this.bytes(b); }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); return this.bytes(b); }
  i32(v) { const b = Buffer.alloc(4); b.writeInt32LE(v); return this.bytes(b); }
  u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v); return this.bytes(b); }
  f32(...vs) { for (const v of vs) { const b = Buffer.alloc(4); b.writeFloatLE(v); this.bytes(b); } return this; }
  text(s) { const b = Buffer.from(s, 'utf16le'); this.i32(b.length); return this.bytes(b); }
  fixed(buf, size) { const b = Buffer.alloc(size); buf.copy(b, 0, 0, Math.min(size, buf.length)); return this.bytes(b); }
  toBuffer() { return Buffer.concat(this.chunks); }
}

// Shift_JIS encoding for the handful of names used in the VMD.
// (Node has no built-in SJIS encoder, so a small table is enough here.)
const SJIS = {
  'セ': [0x83, 0x5a], 'ン': [0x83, 0x93], 'タ': [0x83, 0x5e], 'ー': [0x81, 0x5b],
  '左': [0x8d, 0xb6], '右': [0x89, 0x45], '足': [0x91, 0xab], 'Ｉ': [0x82, 0x68], 'Ｋ': [0x82, 0x6a],
  '腕': [0x98, 0x72], '頭': [0x93, 0xaa], '上': [0x8f, 0xe3], '半': [0x94, 0xbc], '身': [0x90, 0x67],
  'あ': [0x82, 0xa0], 'ひ': [0x82, 0xd0], 'じ': [0x82, 0xb6],
};
function sjis(s) {
  const out = [];
  for (const ch of s) {
    if (ch.charCodeAt(0) < 0x80) out.push(ch.charCodeAt(0));
    else if (SJIS[ch]) out.push(...SJIS[ch]);
    else throw new Error(`no SJIS mapping for ${ch}`);
  }
  return Buffer.from(out);
}

// ---------------------------------------------------------------- model
// Bones in PMX coordinates (left-handed, Y up, model faces -Z; character's left = +X).
const D = Math.PI / 180;
const bones = [];
function bone(name, nameEn, pos, parent, opts = {}) {
  bones.push({ name, nameEn, pos, parent: parent === null ? -1 : bones.findIndex((b) => b.name === parent), ...opts });
  return bones.length - 1;
}
bone('全ての親', 'master', [0, 0, 0], null, { movable: true });
bone('センター', 'center', [0, 8, 0], '全ての親', { movable: true });
bone('下半身', 'lower body', [0, 10, 0], 'センター');
bone('上半身', 'upper body', [0, 10.2, 0], 'センター');
bone('首', 'neck', [0, 15.2, 0], '上半身');
bone('頭', 'head', [0, 16, 0], '首');
for (const [side, sx, en] of [['左', 1, 'left'], ['右', -1, 'right']]) {
  bone(`${side}腕`, `arm_${en}`, [1.6 * sx, 14.6, 0], '上半身');
  bone(`${side}ひじ`, `elbow_${en}`, [4.2 * sx, 14.6, 0], `${side}腕`);
  bone(`${side}手首`, `wrist_${en}`, [6.6 * sx, 14.6, 0], `${side}ひじ`);
  bone(`${side}足`, `leg_${en}`, [1 * sx, 10, 0], '下半身');
  bone(`${side}ひざ`, `knee_${en}`, [1 * sx, 5.6, -0.05], `${side}足`);
  bone(`${side}足首`, `ankle_${en}`, [1 * sx, 1.1, 0], `${side}ひざ`);
}
for (const [side, sx, en] of [['左', 1, 'left'], ['右', -1, 'right']]) {
  const knee = bones.findIndex((b) => b.name === `${side}ひざ`);
  const leg = bones.findIndex((b) => b.name === `${side}足`);
  const ankle = bones.findIndex((b) => b.name === `${side}足首`);
  bone(`${side}足ＩＫ`, `leg IK_${en}`, [1 * sx, 1.1, 0], '全ての親', {
    movable: true,
    ik: { target: ankle, loop: 40, limit: 2.0, links: [
      { bone: knee, min: [-180 * D, 0, 0], max: [-0.5 * D, 0, 0] },
      { bone: leg },
    ] },
  });
}
// Ponytail (physics): three bones hanging from the back of the head (+Z is the back).
const HAIR = [[0, 18.2, 1.4], [0, 16.6, 1.6], [0, 15.0, 1.75], [0, 13.4, 1.85]];
bone('髪1', 'hair1', HAIR[0], '頭');
bone('髪2', 'hair2', HAIR[1], '髪1');
bone('髪3', 'hair3', HAIR[2], '髪2');
const B = (n) => bones.findIndex((b) => b.name === n);

// Boxes (three.js-style right-handed, CCW) built from PMX positions, then
// converted when written: z -> -z, triangle winding reversed.
const verts = []; // {p:[x,y,z] (PMX), n:[..] (PMX), uv, bone}
const faces = []; // triangles (PMX winding)
const materials = []; // {name, color, tex, count, edge}

function addBox(boneIdx, center, size, matIndex) {
  // center/size in PMX coords. Generate in RH coords (flip z), then flip back.
  const [cx, cy, czP] = center;
  const cz = -czP;
  const [sx, sy, sz] = size.map((v) => v / 2);
  const facesDef = [
    // normal, corners (CCW seen from outside, RH)
    [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
    [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  ];
  const start = faces.length;
  for (const [n, corners] of facesDef) {
    const base = verts.length;
    const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
    corners.forEach((c, k) => {
      const rh = [cx + c[0] * sx, cy + c[1] * sy, cz + c[2] * sz];
      verts.push({ p: [rh[0], rh[1], -rh[2]], n: [n[0], n[1], -n[2]], uv: uvs[k], bone: boneIdx });
    });
    // RH CCW triangles (0,1,2),(0,2,3) -> PMX winding reversed
    faces.push([base, base + 2, base + 1], [base, base + 3, base + 2]);
  }
  materials[matIndex].count += (faces.length - start) * 3;
}

materials.push({ name: '肌', nameEn: 'skin', color: [1, 0.86, 0.78, 1], tex: -1, count: 0 });
materials.push({ name: '服', nameEn: 'cloth', color: [1, 1, 1, 1], tex: 0, count: 0 });
materials.push({ name: '靴', nameEn: 'shoes', color: [0.25, 0.25, 0.3, 1], tex: -1, count: 0 });
materials.push({ name: '髪', nameEn: 'hair', color: [0.35, 0.22, 0.15, 1], tex: -1, count: 0 });

// Material 0: skin (head, hands); 1: cloth (torso, arms, legs); 2: shoes.
// Faces must be grouped by material, so add per material.
addBox(B('頭'), [0, 17.4, 0], [2.4, 2.6, 2.4], 0);
const headVertexEnd = verts.length;
addBox(B('左手首'), [7.2, 14.6, 0], [1.2, 0.8, 0.9], 0);
addBox(B('右手首'), [-7.2, 14.6, 0], [1.2, 0.8, 0.9], 0);
addBox(B('首'), [0, 15.6, 0], [0.8, 0.8, 0.8], 0);
addBox(B('上半身'), [0, 12.7, 0], [3.2, 5, 1.8], 1);
addBox(B('下半身'), [0, 9.6, 0], [3.0, 1.6, 1.8], 1);
for (const [side, sx] of [['左', 1], ['右', -1]]) {
  addBox(B(`${side}腕`), [2.9 * sx, 14.6, 0], [2.6, 0.9, 0.9], 1);
  addBox(B(`${side}ひじ`), [5.4 * sx, 14.6, 0], [2.4, 0.8, 0.8], 1);
  addBox(B(`${side}足`), [1 * sx, 7.8, 0], [1.2, 4.4, 1.2], 1);
  addBox(B(`${side}ひざ`), [1 * sx, 3.35, 0], [1.0, 4.5, 1.0], 1);
}
for (const [side, sx] of [['左', 1], ['右', -1]]) {
  addBox(B(`${side}足首`), [1 * sx, 0.5, -0.4], [1.1, 1.0, 2.0], 2);
}
for (let k = 0; k < 3; k++) {
  const [a, b] = [HAIR[k], HAIR[k + 1]];
  addBox(B(`髪${k + 1}`), [0, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [0.7, a[1] - b[1], 0.7], 3);
}

// Rigid bodies (PMX coordinates). Head and upper body follow their bones;
// the hair segments are simulated and collide only with group 0.
const rigidBodies = [
  { name: '頭', nameEn: 'head', bone: B('頭'), group: 0, mask: 0xffff, shape: 0, size: [1.4, 0, 0], pos: [0, 17.4, 0], rot: [0, 0, 0], mass: 1, mode: 0 },
  { name: '上半身', nameEn: 'upper body', bone: B('上半身'), group: 0, mask: 0xffff, shape: 1, size: [1.6, 2.5, 0.9], pos: [0, 12.7, 0], rot: [0, 0, 0], mass: 1, mode: 0 },
];
for (let k = 0; k < 3; k++) {
  const [a, b] = [HAIR[k], HAIR[k + 1]];
  const dy = a[1] - b[1], dz = a[2] - b[2];
  rigidBodies.push({
    name: `髪${k + 1}`, nameEn: `hair${k + 1}`, bone: B(`髪${k + 1}`), group: 1, mask: 0x0001, shape: 2,
    size: [0.35, Math.hypot(dy, dz) - 0.7, 0], pos: [0, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    // Tilt the capsule's Y axis along the segment (rotation about X).
    rot: [Math.atan2(-dz, dy), 0, 0], mass: 1, mode: 1,
  });
}
const joints = [0, 1, 2].map((k) => ({
  name: `髪${k + 1}`, nameEn: `hair${k + 1}`, a: k === 0 ? 0 : k + 1, b: k + 2, pos: HAIR[k], rot: [0, 0, 0],
  angLo: [-40 * D, -20 * D, -20 * D], angHi: [40 * D, 20 * D, 20 * D], springAng: [20, 20, 20],
}));

// Vertex morph "あ": stretch the lower half of the head down (mouth open).
const morphOffsets = [];
for (let i = 0; i < headVertexEnd; i++) if (verts[i].p[1] < 17) morphOffsets.push([i, [0, -0.6, 0]]);

function writePmx() {
  const w = new Writer();
  w.bytes(Buffer.from('PMX ', 'ascii')).f32(2.0);
  w.u8(8).bytes([0 /*utf16*/, 0 /*add uv*/, 2 /*vertex idx*/, 1 /*tex*/, 1 /*mat*/, 1 /*bone*/, 1 /*morph*/, 1 /*rigid*/]);
  w.text('サンプル').text('sample').text('mmd-kimodo test model').text('mmd-kimodo test model');
  w.i32(verts.length);
  for (const v of verts) {
    w.f32(...v.p, ...v.n, ...v.uv);
    w.u8(0).i8(v.bone); // BDEF1
    w.f32(1.0); // edge scale
  }
  w.i32(faces.length * 3);
  for (const f of faces) for (const i of f) w.u16(i);
  w.i32(1).text('tex\\checker.png');
  w.i32(materials.length);
  for (const m of materials) {
    w.text(m.name).text(m.nameEn);
    w.f32(...m.color).f32(0.1, 0.1, 0.1).f32(5).f32(0.5, 0.5, 0.5);
    w.u8(0x10 | 0x02 | 0x04 | 0x08); // edge + shadows
    w.f32(0, 0, 0, 1).f32(1.0);
    w.i8(m.tex).i8(-1).u8(0);
    w.u8(1).u8(0); // shared toon01
    w.text('');
    w.i32(m.count);
  }
  w.i32(bones.length);
  for (const b of bones) {
    w.text(b.name).text(b.nameEn).f32(...b.pos).i8(b.parent).i32(b.ik ? 1 : 0);
    let flags = 0x0002 | 0x0008 | 0x0010; // rotatable, visible, operable
    if (b.movable) flags |= 0x0004;
    if (b.ik) flags |= 0x0020;
    w.u16(flags);
    w.f32(0, 1, 0); // tail offset
    if (b.ik) {
      w.i8(b.ik.target).i32(b.ik.loop).f32(b.ik.limit).i32(b.ik.links.length);
      for (const l of b.ik.links) {
        w.i8(l.bone);
        if (l.min) w.u8(1).f32(...l.min).f32(...l.max);
        else w.u8(0);
      }
    }
  }
  w.i32(3);
  w.text('あ').text('a').u8(3).u8(1).i32(morphOffsets.length);
  for (const [i, o] of morphOffsets) w.u16(i).f32(...o);
  w.text('あ半分').text('a half').u8(3).u8(0).i32(1).i8(0).f32(0.5);
  // Material morph "照れ": multiply the skin toward red (other factors neutral).
  w.text('照れ').text('blush').u8(4).u8(8).i32(1).i8(0).u8(0);
  w.f32(1, 0.75, 0.75, 1).f32(1, 1, 1).f32(1).f32(1, 1, 1).f32(1, 1, 1, 1).f32(1);
  w.f32(1, 1, 1, 1).f32(1, 1, 1, 1).f32(1, 1, 1, 1);
  w.i32(0); // display frames
  w.i32(rigidBodies.length);
  for (const r of rigidBodies) {
    w.text(r.name).text(r.nameEn).i8(r.bone).u8(r.group).u16(r.mask).u8(r.shape);
    w.f32(...r.size, ...r.pos, ...r.rot).f32(r.mass, 0.5, 0.5, 0, 0.5).u8(r.mode);
  }
  w.i32(joints.length);
  for (const j of joints) {
    w.text(j.name).text(j.nameEn).u8(0).i8(j.a).i8(j.b).f32(...j.pos, ...j.rot);
    w.f32(0, 0, 0, 0, 0, 0).f32(...j.angLo, ...j.angHi).f32(0, 0, 0, ...j.springAng);
  }
  return w.toBuffer();
}

// ---------------------------------------------------------------- texture
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (width * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- motion
function quat(axis, deg) {
  const h = (deg * D) / 2, s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}
function qmul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
const LINEAR = (() => {
  const row = [20, 20, 20, 20, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 107];
  const b = Buffer.alloc(64);
  for (let r = 0; r < 4; r++) for (let i = 0; i < 16; i++) b[r * 16 + i] = i + r < 16 ? row[i + r] : 0;
  return b;
})();
const EASE = (() => {
  const row = [64, 64, 64, 64, 0, 0, 0, 0, 64, 64, 64, 64, 127, 127, 127, 127];
  const b = Buffer.alloc(64);
  for (let r = 0; r < 4; r++) for (let i = 0; i < 16; i++) b[r * 16 + i] = i + r < 16 ? row[i + r] : 0;
  return b;
})();

function writeVmd() {
  const keys = [];
  const key = (name, frame, pos = [0, 0, 0], rot = [0, 0, 0, 1], interp = EASE) => keys.push({ name, frame, pos, rot, interp });
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const cycle = [0, 15, 30, 45, 60];
  cycle.forEach((f, i) => {
    const phase = i % 4; // 0: neutral, 1: left up, 2: neutral, 3: right up
    key('センター', f, [0, phase % 2 === 0 ? -0.3 : 0, -f * 0.12], [0, 0, 0, 1], LINEAR);
    key('左足ＩＫ', f, [0, phase === 1 ? 1.4 : 0, -f * 0.12 + (phase === 1 ? -1.2 : 0)]);
    key('右足ＩＫ', f, [0, phase === 3 ? 1.4 : 0, -f * 0.12 + (phase === 3 ? -1.2 : 0)]);
    const swing = phase === 1 ? 25 : phase === 3 ? -25 : 0;
    key('左腕', f, [0, 0, 0], qmul(quat(Z, -45), quat(Y, swing)));
    key('右腕', f, [0, 0, 0], qmul(quat(Z, 45), quat(Y, swing)));
    key('左ひじ', f, [0, 0, 0], quat(Y, -15));
    key('右ひじ', f, [0, 0, 0], quat(Y, 15));
    key('頭', f, [0, 0, 0], quat(X, phase % 2 === 0 ? 0 : 8));
    key('上半身', f, [0, 0, 0], quat(Y, -swing / 3));
  });
  const morphs = [[0, 0], [10, 1], [20, 0], [40, 1], [50, 0]];

  const w = new Writer();
  w.fixed(Buffer.from('Vocaloid Motion Data 0002', 'ascii'), 30);
  w.fixed(sjis('セン'), 20); // model name (arbitrary)
  w.u32(keys.length);
  for (const k of keys) {
    w.fixed(sjis(k.name), 15).u32(k.frame).f32(...k.pos).f32(...k.rot).bytes(k.interp);
  }
  w.u32(morphs.length);
  for (const [f, v] of morphs) w.fixed(sjis('あ'), 15).u32(f).f32(v);
  w.u32(0).u32(0).u32(0); // camera, light, self shadow
  w.u32(1).u32(0).u8(1).u32(2);
  w.fixed(sjis('左足ＩＫ'), 20).u8(1);
  w.fixed(sjis('右足ＩＫ'), 20).u8(1);
  return w.toBuffer();
}

mkdirSync(join(outDir, 'sample-model', 'tex'), { recursive: true });
writeFileSync(join(outDir, 'sample-model', 'sample.pmx'), writePmx());
writeFileSync(join(outDir, 'sample-model', 'tex', 'checker.png'), png(64, 64, (x, y) => {
  const on = ((x >> 3) + (y >> 3)) % 2 === 0;
  return on ? [70, 120, 200, 255] : [235, 240, 248, 255];
}));
writeFileSync(join(outDir, 'sample-walk.vmd'), writeVmd());
console.log(`wrote ${outDir}/sample-model/sample.pmx (${verts.length} vertices, ${bones.length} bones), ${outDir}/sample-walk.vmd`);
