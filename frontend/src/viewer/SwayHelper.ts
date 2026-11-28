import * as THREE from 'three';
import type { PoseSolver } from '../mmd/pose';
import type { SwaySystem } from '../physics/sway';

const COLOR = 0x3b82f6;

/** Debug view of the sway chains (Issue #31): a line through each chain's tail points, plus the side links. */
export class SwayHelper extends THREE.Group {
  private readonly lines: THREE.LineSegments;
  private readonly dots: THREE.Points;
  private readonly positions: Float32Array;

  constructor(private readonly sway: SwaySystem) {
    super();
    this.name = 'SwayHelper';
    const points = sway.info().reduce((n, c) => n + c.bones.length + 1, 0);
    this.positions = new Float32Array(points * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const index: number[] = [];
    const starts: number[] = [];
    let base = 0;
    for (const c of sway.info()) {
      starts.push(base);
      for (let k = 0; k < c.bones.length; k++) index.push(base + k, base + k + 1);
      base += c.bones.length + 1;
    }
    // Side links between neighbouring chains.
    for (const [ca, pa, cb, pb] of sway.linkSegments()) index.push(starts[ca] + pa, starts[cb] + pb);
    geometry.setIndex(index);
    const common = { color: COLOR, depthTest: false, transparent: true };
    this.lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial(common));
    this.dots = new THREE.Points(geometry, new THREE.PointsMaterial({ ...common, size: 6, sizeAttenuation: false }));
    for (const o of [this.lines, this.dots]) {
      o.renderOrder = 16;
      o.frustumCulled = false;
      this.add(o);
    }
  }

  update(solver: PoseSolver): void {
    let k = 0;
    for (const chain of this.sway.points(solver)) {
      for (const p of chain) {
        // PMX -> three.js: mirror Z.
        this.positions[k++] = p.x;
        this.positions[k++] = p.y;
        this.positions[k++] = -p.z;
      }
    }
    this.lines.geometry.getAttribute('position').needsUpdate = true;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
    (this.dots.material as THREE.Material).dispose();
  }
}
