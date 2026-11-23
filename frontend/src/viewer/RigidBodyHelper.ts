import * as THREE from 'three';
import { RigidBodyMode, RigidBodyShape, type RigidBodyDto } from '../api/types';
import type { PhysicsEngine } from '../physics';
import type { PhysicsRig } from '../physics/rig';

/** Colors by mode: follows bone / simulated / simulated with bone position. */
const MODE_COLORS = [0x2e9d5b, 0xe0702a, 0xc9a400];

/** PMX -> three.js: mirror Z on both sides of a transform (M' = S M S). */
const MIRROR_Z = new THREE.Matrix4().makeScale(1, 1, -1);

/** Wireframe view of a model's rigid bodies, for checking physics setups. */
export class RigidBodyHelper extends THREE.Group {
  private readonly meshes: THREE.Mesh[];
  private readonly materials: THREE.MeshBasicMaterial[];
  private readonly scratch: THREE.Matrix4[];

  constructor(bodies: readonly RigidBodyDto[]) {
    super();
    this.name = 'RigidBodyHelper';
    this.renderOrder = 15;
    this.materials = MODE_COLORS.map(
      (color) => new THREE.MeshBasicMaterial({ color, wireframe: true, depthTest: false, transparent: true, opacity: 0.7 }),
    );
    this.meshes = bodies.map((b) => {
      const mesh = new THREE.Mesh(geometryFor(b), this.materials[b.mode] ?? this.materials[RigidBodyMode.Physics]);
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 15;
      mesh.name = b.name;
      this.add(mesh);
      return mesh;
    });
    this.scratch = bodies.map(() => new THREE.Matrix4());
  }

  updateFromEngine(engine: PhysicsEngine): void {
    engine.getRigidBodyTransforms(this.scratch);
    this.apply();
  }

  /** Bodies placed on the current bone pose (used while physics is off). */
  updateFromBones(rig: PhysicsRig, boneWorld: readonly THREE.Matrix4[]): void {
    for (let i = 0; i < this.scratch.length; i++) rig.bodyTarget(i, boneWorld, this.scratch[i]);
    this.apply();
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }

  private apply(): void {
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i].matrix;
      m.multiplyMatrices(MIRROR_Z, this.scratch[i]).multiply(MIRROR_Z);
      this.meshes[i].matrixWorldNeedsUpdate = true;
    }
  }
}

function geometryFor(b: RigidBodyDto): THREE.BufferGeometry {
  const [x, y, z] = b.size.map((v) => Math.max(v, 1e-3));
  switch (b.shape) {
    case RigidBodyShape.Box:
      return new THREE.BoxGeometry(x * 2, y * 2, z * 2);
    case RigidBodyShape.Capsule:
      return new THREE.CapsuleGeometry(x, Math.max(b.size[1], 0), 4, 12);
    default:
      return new THREE.SphereGeometry(x, 12, 8);
  }
}
