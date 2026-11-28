import { Matrix4, Quaternion, Vector3 } from 'three';
import { RigidBodyMode, RigidBodyShape, type BoneDto, type RigidBodyDto } from '../api/types';
import type { PoseSolver } from '../mmd/pose';
import { composeEuler } from './rig';

/**
 * Sway chains (Issue #31): "point chain" physics like Kawaii Physics or VRM
 * SpringBone, added on any row of bones independently of the PMX rigid
 * bodies. Hair or accessories without bodies can swing too.
 *
 * Each bone of a chain has a tail point (the next bone, or for the last bone
 * its PMX tail). The tail is a particle that is pulled back towards where the
 * animation puts it (stiffness), falls (gravity), loses speed (drag), keeps
 * its distance from the bone's head, and is pushed out of the model's
 * bone-following rigid bodies (colliders). The bone is then turned so that it
 * points at its tail. Everything is in PMX space (1 unit = 10 cm).
 *
 * Per frame, after the bones are solved (and PMX physics applied):
 *   update(solver, dt)  or  reset(solver) after a seek / change.
 */

/** How a chain relates to PMX rigid bodies on the same bones. */
export type SwayBlend =
  /** PMX bodies keep running; the chain swings on top of their result. */
  | 'with'
  /** PMX simulated bodies on the chain's bones are removed (see removeReplacedBodies). */
  | 'replace';

export interface SwayChainSettings {
  id: string;
  enabled: boolean;
  /** Bone names; the chain is the parent path from startBone down to endBone. */
  startBone: string;
  endBone: string;
  blend: SwayBlend;
  /** 0-1: how strongly bones return to the animated direction. */
  stiffness: number;
  /** 0-2: multiple of MMD's gravity (9.8 m/s²). */
  gravity: number;
  /** 0-1: share of the speed lost per 1/60 s. */
  drag: number;
  /** Radius of the tail points against colliders, in PMX units. */
  radius: number;
  /** Collide with the model's bone-following rigid bodies. */
  collide: boolean;
  /**
   * Chains with the same non-empty group are tied side by side (a skirt, a
   * fringe): each tail point keeps its rest distance to the same point of the
   * neighbouring chains. Neighbours = order around the group's centre.
   */
  linkGroup: string;
  /** 0-1: how firmly neighbours keep their distance (the weaker chain of a pair counts). */
  linkStiffness: number;
  /** Also tie the last chain of the group to the first (a full skirt). */
  linkLoop: boolean;
}

export const DEFAULT_SWAY_PARAMS = {
  stiffness: 0.5,
  gravity: 0.2,
  drag: 0.2,
  radius: 0.2,
  collide: true,
  linkGroup: '',
  linkStiffness: 0.5,
  linkLoop: true,
} as const satisfies Partial<SwayChainSettings>;

/** MMD's gravity in PMX units per s² (as in the rigid body engines). */
export const SWAY_GRAVITY = 9.8 * 10;
/** Spring constant (1/s²) at stiffness 1; stiffness 0.5 gives ~1.6 Hz. */
const MAX_SPRING = 400;
/** Longest simulated sub-step. */
const MAX_SUBSTEP = 1 / 120;
const MAX_SUBSTEPS = 12;

/** Bone indices of a chain, start first, or null if the names do not form a parent path. */
export function resolveSwayChain(bones: readonly BoneDto[], startBone: string, endBone: string): number[] | null {
  const start = bones.findIndex((b) => b.name === startBone);
  const end = bones.findIndex((b) => b.name === endBone);
  if (start < 0 || end < 0) return null;
  const path: number[] = [];
  for (let b = end, guard = 0; b >= 0 && b < bones.length && guard <= bones.length; guard++) {
    path.push(b);
    if (b === start) return path.reverse();
    const p = bones[b].parent;
    if (p === b) break;
    b = p;
  }
  return null;
}

/** Bones that can end a chain starting at `start`: itself and its descendants, depth first. */
export function swayEndCandidates(bones: readonly BoneDto[], start: number): number[] {
  if (start < 0 || start >= bones.length) return [];
  const children = childLists(bones);
  const out: number[] = [];
  const visit = (i: number) => {
    if (out.length > bones.length) return;
    out.push(i);
    for (const c of children[i]) visit(c);
  };
  visit(start);
  return out;
}

/** Default end: follows single children from `start` (a typical hair strand). */
export function defaultSwayEnd(bones: readonly BoneDto[], start: number): number {
  const children = childLists(bones);
  let b = start;
  for (let guard = 0; guard < bones.length && children[b].length === 1; guard++) b = children[b][0];
  return b;
}

function childLists(bones: readonly BoneDto[]): number[][] {
  const children: number[][] = bones.map(() => []);
  bones.forEach((b, i) => {
    if (b.parent >= 0 && b.parent < bones.length && b.parent !== i) children[b.parent].push(i);
  });
  return children;
}

/** A bone-following rigid body used as an obstacle. */
interface Collider {
  /** Index in SwaySystem.colliders. */
  index: number;
  body: number;
  bone: number;
  shape: number;
  size: readonly number[];
  /** body world = boneWorld * offset */
  offset: Matrix4;
  /** Body world matrix in the rest pose. */
  rest: Matrix4;
}

interface Joint {
  bone: number;
  parent: number;
  /** Tail position relative to the bone, in the bone's local frame (rest). */
  tailLocal: Vector3;
  length: number;
  tail: Vector3;
  velocity: Vector3;
  /** Local rotation from animation (and PMX physics) at the start of the frame. */
  animR: Quaternion;
}

interface Chain {
  settings: SwayChainSettings;
  joints: Joint[];
  colliders: Collider[];
  /** Tied to a neighbour (see SwayChainSettings.linkGroup). */
  linked: boolean;
}

/** Distance kept between the k-th tails of two neighbouring chains. */
interface Link {
  a: Joint;
  b: Joint;
  /** Where a and b are in points(): [chain, point] (point 0 is the chain's root). */
  at: [number, number, number, number];
  rest: number;
  stiffness: number;
}

/** Passes over the side links per sub-step. */
const LINK_ITERATIONS = 2;

export interface SwayChainInfo {
  id: string;
  bones: number[];
  /** Colliders the chain checks (bodies that hold the chain at rest are left out). */
  colliderCount: number;
  /** Chain ids this one is tied to (its neighbours in its link group). */
  neighbours: string[];
}

export class SwaySystem {
  private readonly chains: Chain[] = [];
  private readonly links: Link[] = [];
  private readonly neighbours = new Map<string, string[]>();
  /** Tail positions before the side links moved them (per linked joint). */
  private readonly beforeLinks = new Map<Joint, Vector3>();
  private readonly colliderWorld: Matrix4[];
  private readonly colliderInverse: Matrix4[];
  private readonly colliders: Collider[];

  constructor(
    private readonly bones: readonly BoneDto[],
    rigidBodies: readonly RigidBodyDto[],
    settings: readonly SwayChainSettings[],
  ) {
    const nb = bones.length;
    this.colliders = [];
    rigidBodies.forEach((rb, i) => {
      if (rb.mode !== RigidBodyMode.FollowBone || rb.bone < 0 || rb.bone >= nb) return;
      const rest = composeEuler(rb.position, rb.rotation);
      const p = bones[rb.bone].position;
      const offset = rest.clone().premultiply(new Matrix4().makeTranslation(-p[0], -p[1], -p[2]));
      this.colliders.push({ index: this.colliders.length, body: i, bone: rb.bone, shape: rb.shape, size: rb.size, offset, rest });
    });
    this.colliderWorld = this.colliders.map(() => new Matrix4());
    this.colliderInverse = this.colliders.map(() => new Matrix4());

    for (const s of settings) {
      if (!s.enabled) continue;
      const path = resolveSwayChain(bones, s.startBone, s.endBone);
      if (!path) continue;
      const joints = this.buildJoints(path);
      if (joints.length === 0) continue;
      this.chains.push({ settings: s, joints, colliders: s.collide ? this.collidersFor(joints, s.radius) : [], linked: false });
    }
    this.buildLinks();
  }

  get active(): boolean {
    return this.chains.length > 0;
  }

  /** Bones moved by the chains. */
  get boneSet(): Set<number> {
    return new Set(this.chains.flatMap((c) => c.joints.map((j) => j.bone)));
  }

  info(): SwayChainInfo[] {
    return this.chains.map((c) => ({
      id: c.settings.id,
      bones: c.joints.map((j) => j.bone),
      colliderCount: c.colliders.length,
      neighbours: this.neighbours.get(c.settings.id) ?? [],
    }));
  }

  /** Current tail points, for the debug view: per chain, head of the first bone then every tail. */
  points(solver: PoseSolver): Vector3[][] {
    return this.chains.map((c) => [solver.worldPosition(c.joints[0].bone), ...c.joints.map((j) => j.tail.clone())]);
  }

  /** Side links as [chain, point, chain, point] indices into {@link points}, for the debug view. */
  linkSegments(): [number, number, number, number][] {
    return this.links.map((l) => l.at);
  }

  /** Puts every tail where the animation has it, at rest. Bones keep their animated rotation. */
  reset(solver: PoseSolver): void {
    for (const chain of this.chains) {
      for (const j of chain.joints) {
        j.animR.copy(solver.localR[j.bone]);
        solver.refreshWorld(j.bone);
        j.tail.copy(j.tailLocal).applyMatrix4(solver.world[j.bone]);
        j.velocity.set(0, 0, 0);
      }
      solver.refreshWorld(chain.joints[0].bone, true);
    }
  }

  /** Advances the chains by `dt` seconds and turns their bones. */
  update(solver: PoseSolver, dt: number): void {
    if (dt <= 0) {
      // No time passed (e.g. a redraw): just show the current tails on the new pose.
      for (const chain of this.chains) {
        for (const j of chain.joints) j.animR.copy(solver.localR[j.bone]);
        this.pose(chain, solver);
      }
      return;
    }
    const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / MAX_SUBSTEP)));
    const h = dt / n;
    this.updateColliders(solver.world);
    for (const chain of this.chains) for (const j of chain.joints) j.animR.copy(solver.localR[j.bone]);
    for (let k = 0; k < n; k++) {
      for (const chain of this.chains) this.stepChain(chain, solver, h);
      if (this.links.length > 0) this.applyLinks(solver, h);
    }
    for (const chain of this.chains) this.pose(chain, solver);
  }

  /**
   * Groups chains by linkGroup, orders each group around its centre (seen
   * from above, by the rest position of each chain's root) and ties
   * neighbours tail by tail, as deep as the shorter chain goes.
   */
  private buildLinks(): void {
    const groups = new Map<string, Chain[]>();
    for (const c of this.chains) {
      const g = c.settings.linkGroup.trim();
      if (!g) continue;
      groups.set(g, [...(groups.get(g) ?? []), c]);
    }
    const restTail = (j: Joint) => new Vector3(...this.bones[j.bone].position).add(j.tailLocal);
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const root = (c: Chain) => new Vector3(...this.bones[c.joints[0].bone].position);
      const centre = members.reduce((sum, c) => sum.add(root(c)), new Vector3()).divideScalar(members.length);
      const angle = (c: Chain) => {
        const p = root(c);
        return Math.atan2(p.z - centre.z, p.x - centre.x);
      };
      const ordered = members.slice().sort((a, b) => angle(a) - angle(b));
      const pairs: [Chain, Chain][] = [];
      for (let i = 0; i + 1 < ordered.length; i++) pairs.push([ordered[i], ordered[i + 1]]);
      // A loop needs three chains; with two the closing pair would repeat the first.
      if (ordered.length >= 3 && ordered.every((c) => c.settings.linkLoop)) pairs.push([ordered[ordered.length - 1], ordered[0]]);
      for (const [a, b] of pairs) {
        const stiffness = Math.min(clamp01(a.settings.linkStiffness), clamp01(b.settings.linkStiffness));
        if (stiffness <= 0) continue;
        const depth = Math.min(a.joints.length, b.joints.length);
        for (let k = 0; k < depth; k++) {
          const ja = a.joints[k], jb = b.joints[k];
          const at: [number, number, number, number] = [this.chains.indexOf(a), k + 1, this.chains.indexOf(b), k + 1];
          this.links.push({ a: ja, b: jb, at, rest: restTail(ja).distanceTo(restTail(jb)), stiffness });
        }
        a.linked = b.linked = true;
        for (const [x, y] of [[a, b], [b, a]]) {
          const list = this.neighbours.get(x.settings.id) ?? [];
          if (!list.includes(y.settings.id)) list.push(y.settings.id);
          this.neighbours.set(x.settings.id, list);
        }
      }
    }
    for (const c of this.chains) if (c.linked) for (const j of c.joints) this.beforeLinks.set(j, new Vector3());
  }

  /**
   * Moves tied tails towards their rest distance (position based, both sides
   * half each), then puts every linked chain back on its bone lengths and out
   * of the colliders, root to tip. The total move is added to the velocities.
   */
  private applyLinks(solver: PoseSolver, h: number): void {
    for (const [j, before] of this.beforeLinks) before.copy(j.tail);
    for (let it = 0; it < LINK_ITERATIONS; it++) {
      for (const l of this.links) {
        _d.subVectors(l.b.tail, l.a.tail);
        const len = _d.length();
        if (len < 1e-8) continue;
        const move = ((len - l.rest) / len) * l.stiffness * 0.5;
        l.a.tail.addScaledVector(_d, move);
        l.b.tail.addScaledVector(_d, -move);
      }
    }
    for (const chain of this.chains) {
      if (!chain.linked) continue;
      for (const j of chain.joints) {
        solver.localR[j.bone].copy(j.animR);
        solver.refreshWorld(j.bone);
        const world = solver.world[j.bone];
        _head.setFromMatrixPosition(world);
        _target.copy(j.tailLocal).applyMatrix4(world);
        this.keepLength(j.tail, _head, j.length, _target);
        for (const c of chain.colliders) this.collide(c, j.tail, chain.settings.radius);
        this.keepLength(j.tail, _head, j.length, _target);
        j.velocity.addScaledVector(_d.subVectors(j.tail, this.beforeLinks.get(j)!), 1 / h);
        this.aim(j, solver, _target);
      }
    }
  }

  private buildJoints(path: number[]): Joint[] {
    const { bones } = this;
    const pos = (i: number) => new Vector3(...bones[i].position);
    const joints: Joint[] = [];
    path.forEach((b, k) => {
      let tail: Vector3 | null = null;
      if (k + 1 < path.length) tail = pos(path[k + 1]);
      else {
        const t = bones[b].tailBone;
        if (t >= 0 && t < bones.length && t !== b) tail = pos(t);
        else if (t < 0 && new Vector3(...bones[b].tailOffset).lengthSq() > 1e-8) tail = pos(b).add(new Vector3(...bones[b].tailOffset));
        else if (k > 0) tail = pos(b).sub(pos(path[k - 1])).add(pos(b)); // continue the last segment
      }
      if (!tail) return;
      const tailLocal = tail.sub(pos(b));
      const length = tailLocal.length();
      if (length < 1e-5) return;
      joints.push({ bone: b, parent: bones[b].parent, tailLocal, length, tail: new Vector3(), velocity: new Vector3(), animR: new Quaternion() });
    });
    return joints;
  }

  /**
   * Colliders for a chain. Bodies that already contain the chain's head or a
   * tail in the rest pose (the head the hair grows from, the body under a
   * ribbon) are left out, or they would push the chain away for good.
   */
  private collidersFor(joints: Joint[], radius: number): Collider[] {
    const head = new Vector3(...this.bones[joints[0].bone].position);
    const points = [head, ...joints.map((j) => new Vector3(...this.bones[j.bone].position).add(j.tailLocal))];
    const inv = new Matrix4();
    const p = new Vector3();
    return this.colliders.filter((c) => {
      inv.copy(c.rest).invert();
      return !points.some((q) => penetration(c.shape, c.size, p.copy(q).applyMatrix4(inv), radius) > 0);
    });
  }

  private updateColliders(boneWorld: readonly Matrix4[]): void {
    this.colliders.forEach((c, i) => {
      this.colliderWorld[i].multiplyMatrices(boneWorld[c.bone], c.offset);
      this.colliderInverse[i].copy(this.colliderWorld[i]).invert();
    });
  }

  private stepChain(chain: Chain, solver: PoseSolver, h: number): void {
    const s = chain.settings;
    const k = MAX_SPRING * clamp01(s.stiffness) ** 2;
    const keep = (1 - Math.min(Math.max(s.drag, 0), 0.99)) ** (h * 60);
    const g = SWAY_GRAVITY * Math.max(s.gravity, 0);
    for (const j of chain.joints) {
      // Bone at its animated rotation under the (already moved) parent.
      solver.localR[j.bone].copy(j.animR);
      solver.refreshWorld(j.bone);
      const world = solver.world[j.bone];
      _head.setFromMatrixPosition(world);
      _target.copy(j.tailLocal).applyMatrix4(world);

      j.velocity.multiplyScalar(keep);
      _f.subVectors(_target, j.tail).multiplyScalar(k);
      _f.y -= g;
      j.velocity.addScaledVector(_f, h);
      _next.copy(j.tail).addScaledVector(j.velocity, h);
      this.keepLength(_next, _head, j.length, _target);
      for (const c of chain.colliders) this.collide(c, _next, s.radius);
      this.keepLength(_next, _head, j.length, _target);

      j.velocity.subVectors(_next, j.tail).divideScalar(h);
      j.tail.copy(_next);
      this.aim(j, solver, _target);
    }
  }

  /** Turns every joint to its tail without stepping. */
  private pose(chain: Chain, solver: PoseSolver): void {
    for (const j of chain.joints) {
      solver.localR[j.bone].copy(j.animR);
      solver.refreshWorld(j.bone);
      _target.copy(j.tailLocal).applyMatrix4(solver.world[j.bone]);
      this.aim(j, solver, _target);
    }
    solver.refreshWorld(chain.joints[0].bone, true);
  }

  /** Rotates bone j (now at its animated rotation, tail at `target`) so that it points at j.tail. */
  private aim(j: Joint, solver: PoseSolver, target: Vector3): void {
    const world = solver.world[j.bone];
    _head.setFromMatrixPosition(world);
    _from.subVectors(target, _head).normalize();
    _to.subVectors(j.tail, _head).normalize();
    if (_to.lengthSq() < 0.5) return;
    _turn.setFromUnitVectors(_from, _to);
    // world rotation = parentR * localR  ->  localR' = parentR⁻¹ * turn * parentR * localR
    const p = j.parent;
    if (p >= 0 && p < solver.count && p !== j.bone) {
      solver.world[p].decompose(_v, _parentR, _scale);
      _turn.premultiply(_inv.copy(_parentR).invert()).multiply(_parentR);
    }
    solver.localR[j.bone].premultiply(_turn).normalize();
    solver.refreshWorld(j.bone);
  }

  private keepLength(p: Vector3, head: Vector3, length: number, fallback: Vector3): void {
    _d.subVectors(p, head);
    const len = _d.length();
    if (len < 1e-8) p.copy(fallback);
    else p.copy(head).addScaledVector(_d, length / len);
  }

  private collide(c: Collider, p: Vector3, radius: number): void {
    const i = c.index;
    _local.copy(p).applyMatrix4(this.colliderInverse[i]);
    if (pushOut(c.shape, c.size, _local, radius)) p.copy(_local).applyMatrix4(this.colliderWorld[i]);
  }
}

/** How far a point (in the body's local frame) with `radius` sinks into a PMX shape; ≤ 0 when outside. */
export function penetration(shape: number, size: readonly number[], p: Vector3, radius: number): number {
  switch (shape) {
    case RigidBodyShape.Box: {
      const q = _q3.set(clampAbs(p.x, size[0]), clampAbs(p.y, size[1]), clampAbs(p.z, size[2]));
      const out = q.distanceTo(p);
      if (out > 0) return radius - out;
      return radius + Math.min(size[0] - Math.abs(p.x), size[1] - Math.abs(p.y), size[2] - Math.abs(p.z));
    }
    case RigidBodyShape.Capsule: {
      const half = Math.max(size[1], 0) / 2;
      _q3.set(0, Math.min(half, Math.max(-half, p.y)), 0);
      return size[0] + radius - p.distanceTo(_q3);
    }
    default:
      return size[0] + radius - p.length();
  }
}

/** Moves a point (body-local) out of a PMX shape grown by `radius`. Returns false when it was outside. */
export function pushOut(shape: number, size: readonly number[], p: Vector3, radius: number): boolean {
  switch (shape) {
    case RigidBodyShape.Box: {
      const q = _q3.set(clampAbs(p.x, size[0]), clampAbs(p.y, size[1]), clampAbs(p.z, size[2]));
      const out = q.distanceTo(p);
      if (out >= radius) return false;
      if (out > 1e-8) {
        p.sub(q).multiplyScalar(radius / out).add(q);
        return true;
      }
      // Inside: leave through the nearest face.
      const dx = size[0] - Math.abs(p.x), dy = size[1] - Math.abs(p.y), dz = size[2] - Math.abs(p.z);
      if (dx <= dy && dx <= dz) p.x = Math.sign(p.x || 1) * (size[0] + radius);
      else if (dy <= dz) p.y = Math.sign(p.y || 1) * (size[1] + radius);
      else p.z = Math.sign(p.z || 1) * (size[2] + radius);
      return true;
    }
    case RigidBodyShape.Capsule: {
      const half = Math.max(size[1], 0) / 2;
      _q3.set(0, Math.min(half, Math.max(-half, p.y)), 0);
      return pushFromPoint(p, _q3, size[0] + radius);
    }
    default:
      return pushFromPoint(p, _q3.set(0, 0, 0), size[0] + radius);
  }
}

function pushFromPoint(p: Vector3, c: Vector3, min: number): boolean {
  _d.subVectors(p, c);
  const d = _d.length();
  if (d >= min) return false;
  if (d < 1e-8) _d.set(0, 1, 0);
  else _d.divideScalar(d);
  p.copy(c).addScaledVector(_d, min);
  return true;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const clampAbs = (v: number, e: number) => Math.min(e, Math.max(-e, v));

const _head = new Vector3();
const _target = new Vector3();
const _next = new Vector3();
const _f = new Vector3();
const _d = new Vector3();
const _from = new Vector3();
const _to = new Vector3();
const _v = new Vector3();
const _scale = new Vector3();
const _local = new Vector3();
const _q3 = new Vector3();
const _turn = new Quaternion();
const _parentR = new Quaternion();
const _inv = new Quaternion();
