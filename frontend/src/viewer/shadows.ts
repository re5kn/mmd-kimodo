import * as THREE from 'three';

/**
 * Shadows (Issue #11 A5): the model shadows itself (self shadow) and the
 * floor (ground shadow), from the scene's directional light.
 *
 * The shadow camera is an orthographic box around the model that is fitted
 * again before every render, so the shadow stays sharp and the model never
 * walks out of it while a motion plays.
 */

/** Shadow map resolution (texels per side). */
export const SHADOW_MAP_SIZE = 2048;
/** Darkness of the ground shadow (0: invisible, 1: black). */
export const GROUND_SHADOW_OPACITY = 0.3;

/** Box around a set of points, padded so limbs and hair at the edge still cast. */
export function shadowBounds(points: ArrayLike<THREE.Vector3>, out = new THREE.Sphere()): THREE.Sphere {
  const box = new THREE.Box3();
  for (let i = 0; i < points.length; i++) box.expandByPoint(points[i]);
  if (box.isEmpty()) return out.set(new THREE.Vector3(0, 10, 0), 12);
  box.getBoundingSphere(out);
  // Bones sit inside the skin; hair and skirts reach well past them.
  out.radius = out.radius * 1.3 + 2;
  return out;
}

export class ShadowRig {
  readonly ground: THREE.Mesh;
  private readonly bounds = new THREE.Sphere(new THREE.Vector3(0, 10, 0), 12);
  private readonly lightDir = new THREE.Vector3();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly light: THREE.DirectionalLight,
    scene: THREE.Scene,
  ) {
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const s = light.shadow;
    s.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    // Toon shading turns tiny depth errors into hard stripes; push the
    // lookup off the surface along the normal instead of a big depth bias.
    s.bias = -0.0002;
    s.normalBias = 0.04;
    s.radius = 2;
    scene.add(light.target);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.ShadowMaterial({ opacity: GROUND_SHADOW_OPACITY, depthWrite: false }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.renderOrder = -1;
    scene.add(this.ground);
    this.setEnabled(true);
  }

  setEnabled(on: boolean): void {
    this.renderer.shadowMap.enabled = on;
    this.light.castShadow = on;
    this.ground.visible = on;
  }

  /** Fits the shadow camera around `bounds`, keeping the light's direction. */
  fit(bounds: THREE.Sphere): void {
    this.bounds.copy(bounds);
    const r = bounds.radius;
    this.lightDir.copy(this.light.position).sub(this.light.target.position);
    if (this.lightDir.lengthSq() === 0) this.lightDir.set(0, 1, 0);
    this.lightDir.normalize();
    this.light.target.position.copy(bounds.center);
    this.light.position.copy(bounds.center).addScaledVector(this.lightDir, r * 2);
    this.light.target.updateMatrixWorld();
    this.light.updateMatrixWorld();
    const cam = this.light.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.1;
    cam.far = r * 4;
    cam.updateProjectionMatrix();
  }

  /** Points the light from `from` (relative to the model) without losing the fit. */
  setDirection(from: THREE.Vector3Like): void {
    this.light.position.set(from.x, from.y, from.z).add(this.light.target.position);
    this.fit(this.bounds);
  }

  dispose(): void {
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
    this.ground.removeFromParent();
  }
}
