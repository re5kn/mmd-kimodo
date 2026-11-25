import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MaterialFlags, type ModelDto } from '../api/types';
import { decodeFloat32, decodeUint16, decodeUint32 } from '../mmd/decode';
import { MorphApplier } from '../mmd/morph';
import { PoseSolver } from '../mmd/pose';
import { sampleBoneTrack, sampleIkEnabled, sampleMorphTrack, type BoundMotion } from '../mmd/motion';
import { createPhysicsEngine, type PhysicsEngine, type PhysicsEngineKind } from '../physics';
import { PhysicsRig } from '../physics/rig';
import { RigidBodyHelper } from './RigidBodyHelper';
import { physicsStatusStore } from './physicsStatus';
import {
  createPresetMaterial,
  type DisplayPreset,
  type PresetMaterialSource,
} from './displayPresets';
import { lightingTunerStore, tunedPresetLighting } from './lightingTuner';
import { createClothDetailMap, createHairDetailMap, uvDensity } from './detailMaps';
import { classifySurfaces } from './surfaceKind';
import { createSharedToonTextures, sharedToonIndexFromPath } from './sharedToons';
import { SUB_UV_ATTRIBUTE, SphereMode, createMmdLightUniform } from './mmdShading';
import { DEFAULT_LIGHTING, resolveLighting, type LightingSettings } from './lighting';
import { DEFAULT_EFFECTS, PostEffects, effectsActive, resolveToneMapping, type EffectSettings } from './postEffects';
import { ShadowRig, shadowBounds } from './shadows';

/**
 * PMX space is left-handed (model faces -Z). three.js is right-handed.
 * Mirroring Z converts between them: positions (x, y, -z), quaternions
 * (-x, -y, z, w), and triangle winding is reversed.
 */
const toThreePos = (v: THREE.Vector3, out: THREE.Vector3) => out.set(v.x, v.y, -v.z);
const toThreeQuat = (q: THREE.Quaternion, out: THREE.Quaternion) => out.set(-q.x, -q.y, q.z, q.w);

export interface ViewerOptions {
  showGrid: boolean;
  showBones: boolean;
  showOutline: boolean;
  enableIk: boolean;
  enablePhysics: boolean;
  physicsEngine: PhysicsEngineKind;
  showRigidBodies: boolean;
  displayPreset: DisplayPreset;
  showShadows: boolean;
  lighting: LightingSettings;
  effects: EffectSettings;
}

export const DEFAULT_VIEWER_OPTIONS: ViewerOptions = {
  showGrid: true,
  showBones: false,
  showOutline: true,
  enableIk: true,
  enablePhysics: true,
  physicsEngine: 'ammo',
  showRigidBodies: false,
  displayPreset: 'mmd',
  showShadows: true,
  lighting: DEFAULT_LIGHTING,
  effects: DEFAULT_EFFECTS,
};

/** Frame jumps larger than this (or backwards) restart the simulation. */
const PHYSICS_RESET_FRAME_JUMP = 2;

export interface LoadedModelInfo {
  missingTextures: string[];
}

export class MmdViewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly outline: OutlineEffect;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly grid: THREE.Group;
  private readonly resizeObserver: ResizeObserver;
  /** Stand-ins for MMD's toon01..toon10 (index 0 = toon01). */
  private readonly sharedToons: THREE.DataTexture[];
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly shadows: ShadowRig;
  private readonly post: PostEffects;
  /** Fill and rim lights of the three-point setup. */
  private readonly extraLights: THREE.DirectionalLight[];
  private readonly mmdLightColor = createMmdLightUniform();
  private readonly shadowSphere = new THREE.Sphere();
  private bonePoints: THREE.Vector3[] = [];
  private environment: THREE.Texture | null = null;
  private detailMaps: { cloth: THREE.Texture; hair: THREE.Texture } | null = null;

  private model: ModelDto | null = null;
  private mesh: THREE.SkinnedMesh | null = null;
  private materialSources: PresetMaterialSource[] = [];
  /** Materials built so far for each display preset (built on first use). */
  private presetMaterials = new Map<DisplayPreset, THREE.Material[]>();
  private textures: THREE.Texture[] = [];
  private bones: THREE.Bone[] = [];
  private skeletonHelper: THREE.SkeletonHelper | null = null;
  private solver: PoseSolver | null = null;
  private morphs: MorphApplier | null = null;
  private morphWeights = new Float32Array(0);
  private motion: BoundMotion | null = null;
  private frame = 0;
  private disposed = false;
  private needsRender = true;

  private physics: PhysicsEngine | null = null;
  private physicsRequest = 0;
  private physicsNeedsReset = true;
  private physicsTarget: THREE.Matrix4[] = [];
  private rig: PhysicsRig | null = null;
  private rigidBodyHelper: RigidBodyHelper | null = null;
  private lastTick = 0;
  private readonly unsubscribeReset: () => void;
  /** Temporary lighting tuner (see lightingTuner.ts). */
  private readonly unsubscribeTuner: () => void;

  options: ViewerOptions = { ...DEFAULT_VIEWER_OPTIONS };

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.outline = new OutlineEffect(this.renderer);

    this.scene.background = new THREE.Color(0xf4f5f7);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => (this.needsRender = true));
    this.resetCamera();

    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6);
    this.scene.add(this.hemiLight);
    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    this.scene.add(this.dirLight);
    this.shadows = new ShadowRig(this.renderer, this.dirLight, this.scene);
    this.post = new PostEffects(this.renderer, this.scene, this.camera, this.outline);
    this.extraLights = [new THREE.DirectionalLight(), new THREE.DirectionalLight()];
    for (const light of this.extraLights) {
      light.visible = false;
      this.scene.add(light);
    }

    this.grid = new THREE.Group();
    const grid = new THREE.GridHelper(100, 20, 0x9aa3ad, 0xd0d5db);
    this.grid.add(grid);
    const axes = new THREE.AxesHelper(6);
    (axes.material as THREE.Material).depthTest = false;
    axes.renderOrder = 10;
    this.grid.add(axes);
    this.scene.add(this.grid);

    this.sharedToons = createSharedToonTextures();

    this.applyPresetLighting();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
    this.unsubscribeReset = physicsStatusStore.onResetRequest(() => this.resetPhysics());
    this.unsubscribeTuner = lightingTunerStore.subscribe(() => this.applyPresetLighting());
    void this.syncPhysicsEngine();
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.unsubscribeReset();
    this.unsubscribeTuner();
    this.clearModel();
    this.physicsRequest++;
    this.physics?.dispose();
    this.physics = null;
    this.environment?.dispose();
    for (const t of this.sharedToons) t.dispose();
    this.detailMaps?.cloth.dispose();
    this.detailMaps?.hair.dispose();
    this.shadows.dispose();
    this.post.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  resetCamera(): void {
    let center = new THREE.Vector3(0, 10, 0);
    let height = 20;
    if (this.mesh) {
      const box = new THREE.Box3().setFromBufferAttribute(this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute);
      if (!box.isEmpty()) {
        center = box.getCenter(new THREE.Vector3());
        height = Math.max(box.max.y - box.min.y, 1);
      }
    }
    const dist = height / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.25;
    this.camera.position.set(center.x, center.y, center.z + dist);
    this.camera.near = Math.max(dist / 100, 0.05);
    this.camera.far = dist * 50;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    this.needsRender = true;
  }

  setOptions(opts: Partial<ViewerOptions>): void {
    const prev = this.options;
    this.options = { ...this.options, ...opts };
    const o = this.options;
    this.grid.visible = o.showGrid;
    this.shadows.setEnabled(o.showShadows);
    if (this.skeletonHelper) this.skeletonHelper.visible = o.showBones;
    if (this.rigidBodyHelper) this.rigidBodyHelper.visible = o.showRigidBodies;
    if ((o.lighting !== prev.lighting || o.effects !== prev.effects) && o.displayPreset === prev.displayPreset) this.applyPresetLighting();
    if (o.displayPreset !== prev.displayPreset) {
      this.applyPresetLighting();
      if (this.mesh) this.mesh.material = this.materialsFor(o.displayPreset);
    }
    if (o.enablePhysics !== prev.enablePhysics || o.physicsEngine !== prev.physicsEngine) {
      void this.syncPhysicsEngine();
    } else if (o.enableIk !== prev.enableIk || o.showRigidBodies !== prev.showRigidBodies) {
      this.physicsNeedsReset = true;
      this.applyFrame();
    }
    this.needsRender = true;
  }

  setModel(model: ModelDto): LoadedModelInfo {
    this.clearModel();
    this.model = model;

    const geometry = new THREE.BufferGeometry();
    const positions = decodeFloat32(model.geometry.positions);
    const normals = decodeFloat32(model.geometry.normals);
    for (let i = 2; i < positions.length; i += 3) {
      positions[i] = -positions[i];
      normals[i] = -normals[i];
    }
    const indices = decodeUint32(model.geometry.indices);
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', posAttr);
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(decodeFloat32(model.geometry.uvs), 2));
    const hasSubUv = !!model.geometry.uv1;
    if (model.geometry.uv1) geometry.setAttribute(SUB_UV_ATTRIBUTE, new THREE.BufferAttribute(decodeFloat32(model.geometry.uv1), 2));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(decodeUint16(model.geometry.skinIndices), 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(decodeFloat32(model.geometry.skinWeights), 4));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    const missingTextures: string[] = [];
    const textures = model.textures.map((t) => {
      if (!t.url) {
        // MMD's toon01..toon10 are expected to be missing; stand-ins are used.
        if (sharedToonIndexFromPath(t.path) === null) missingTextures.push(t.path);
        return null;
      }
      return this.loadTexture(t.url, t.path);
    });
    this.textures = textures.filter((t): t is THREE.Texture => !!t);

    // Toon images of the model itself are read with clamping (a separate
    // texture object, since the same file may also be used as a color map).
    const toonTextures = new Map<number, THREE.Texture>();
    const toonFor = (shared: boolean, index: number): THREE.Texture | null => {
      if (shared) return this.sharedToons[index] ?? null;
      const entry = index >= 0 ? model.textures[index] : undefined;
      if (!entry) return null;
      if (!entry.url) {
        // A missing "toon03.bmp" means MMD's own file: use its stand-in.
        const sharedIndex = sharedToonIndexFromPath(entry.path);
        return sharedIndex === null ? null : this.sharedToons[sharedIndex];
      }
      let tex = toonTextures.get(index);
      if (!tex) {
        tex = this.loadTexture(entry.url, entry.path, THREE.ClampToEdgeWrapping);
        toonTextures.set(index, tex);
        this.textures.push(tex);
      }
      return tex;
    };

    const sphereFor = (index: number, mode: number) => {
      const map = index >= 0 ? textures[index] : null;
      if (!map || mode === SphereMode.None || mode > SphereMode.SubTexture) return null;
      // Sub-texture spheres need additional UV1; without it MMD shows nothing either.
      if (mode === SphereMode.SubTexture && !hasSubUv) return null;
      return { map, mode };
    };

    const uvs = geometry.getAttribute('uv').array;
    const texturePath = (index: number) => (index >= 0 ? model.textures[index]?.path : undefined);
    const kinds = classifySurfaces(
      model.materials.map((m) => ({ name: m.name, texturePaths: [texturePath(m.textureIndex), texturePath(m.sphereTextureIndex)] })),
    );
    this.materialSources = model.materials.map((m, i) => {
      geometry.addGroup(m.indexStart, m.indexCount, i);
      return {
        kind: kinds[i],
        uvDensity: uvDensity(positions, uvs, indices, m.indexStart, m.indexCount),
        name: m.name,
        diffuse: [m.diffuse[0], m.diffuse[1], m.diffuse[2], m.diffuse[3]],
        ambient: [m.ambient[0], m.ambient[1], m.ambient[2]],
        specularity: m.specularity,
        specular: [m.specular[0], m.specular[1], m.specular[2]],
        doubleSided: (m.flags & MaterialFlags.DoubleSided) !== 0,
        map: m.textureIndex >= 0 ? textures[m.textureIndex] ?? null : null,
        toon: toonFor(m.sharedToon, m.toonIndex),
        sphere: sphereFor(m.sphereTextureIndex, m.sphereMode),
        outline: {
          thickness: m.edgeSize / 300,
          color: [m.edgeColor[0], m.edgeColor[1], m.edgeColor[2]],
          alpha: m.edgeColor[3],
          visible: (m.flags & MaterialFlags.Edge) !== 0 && m.edgeSize > 0 && m.diffuse[3] > 0,
        },
      };
    });
    const materials = this.materialsFor(this.options.displayPreset);

    // Bones: identity rest orientation, positions relative to parent.
    const solver = new PoseSolver(model.bones);
    this.bones = model.bones.map((b, i) => {
      const bone = new THREE.Bone();
      bone.name = b.name;
      toThreePos(solver.restOffset[i], bone.position);
      return bone;
    });
    const roots: THREE.Bone[] = [];
    model.bones.forEach((b, i) => {
      if (b.parent >= 0 && b.parent < this.bones.length && b.parent !== i) this.bones[b.parent].add(this.bones[i]);
      else roots.push(this.bones[i]);
    });

    const mesh = new THREE.SkinnedMesh(geometry, materials.length > 0 ? materials : new THREE.MeshToonMaterial());
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    roots.forEach((r) => mesh.add(r));
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(this.bones));
    this.scene.add(mesh);
    this.mesh = mesh;
    this.bonePoints = this.bones.map(() => new THREE.Vector3());
    this.solver = solver;

    this.skeletonHelper = new THREE.SkeletonHelper(mesh);
    this.skeletonHelper.visible = this.options.showBones;
    (this.skeletonHelper.material as THREE.LineBasicMaterial).depthTest = false;
    this.skeletonHelper.renderOrder = 20;
    this.scene.add(this.skeletonHelper);

    this.morphs = new MorphApplier(model, positions.slice(), positions);
    this.morphWeights = new Float32Array(model.morphs.length);

    const physicsModel = { bones: model.bones, rigidBodies: model.rigidBodies ?? [], joints: model.joints ?? [] };
    this.rig = new PhysicsRig(physicsModel);
    this.physicsTarget = model.bones.map(() => new THREE.Matrix4());
    this.rigidBodyHelper = new RigidBodyHelper(physicsModel.rigidBodies);
    this.rigidBodyHelper.visible = this.options.showRigidBodies;
    this.scene.add(this.rigidBodyHelper);
    this.setupPhysicsModel();

    this.applyFrame();
    this.resetCamera();
    return { missingTextures };
  }

  setMotion(motion: BoundMotion | null): void {
    // The app passes the playing clip's motion on every frame change; only a
    // different motion restarts the simulation (otherwise physics would be
    // reset on every frame during playback and never swing).
    if (motion === this.motion) return;
    this.motion = motion;
    this.physicsNeedsReset = true;
    this.applyFrame();
  }

  setFrame(frame: number): void {
    if (frame === this.frame) return;
    if (frame < this.frame || frame - this.frame > PHYSICS_RESET_FRAME_JUMP) this.physicsNeedsReset = true;
    this.frame = frame;
    // While physics runs, the render loop evaluates the pose every tick.
    if (!this.physicsActive()) this.applyFrame();
  }

  /** Restarts the simulation from the current pose. */
  resetPhysics(): void {
    this.physicsNeedsReset = true;
    this.applyFrame();
  }

  private physicsActive(): boolean {
    return !!this.physics && !!this.model && this.model.rigidBodies?.length > 0;
  }

  /** Creates, swaps or drops the physics engine to match the options. */
  private async syncPhysicsEngine(): Promise<void> {
    const request = ++this.physicsRequest;
    const want = this.options.enablePhysics ? this.options.physicsEngine : null;
    if (this.physics && this.physics.kind !== want) {
      this.physics.dispose();
      this.physics = null;
    }
    if (!want) {
      this.publishPhysicsStatus('off');
      this.applyFrame();
      return;
    }
    if (!this.physics) {
      this.publishPhysicsStatus('loading');
      try {
        const engine = await createPhysicsEngine(want);
        if (request !== this.physicsRequest || this.disposed) {
          engine.dispose();
          return;
        }
        this.physics = engine;
      } catch (e) {
        if (request !== this.physicsRequest) return;
        console.error(e);
        this.publishPhysicsStatus('error', e instanceof Error ? e.message : String(e));
        this.applyFrame();
        return;
      }
    }
    this.setupPhysicsModel();
    this.applyFrame();
  }

  /** Registers the current model's rigid bodies and joints with the engine. */
  private setupPhysicsModel(): void {
    const { physics, rig } = this;
    if (!physics) return;
    physics.setup(rig ? rig.model : { bones: [], rigidBodies: [], joints: [] });
    this.physicsNeedsReset = true;
    this.publishPhysicsStatus('ready');
  }

  private publishPhysicsStatus(state: 'off' | 'loading' | 'ready' | 'error', message?: string): void {
    physicsStatusStore.set({
      state,
      engine: state === 'off' ? null : this.options.physicsEngine,
      bodyCount: this.model?.rigidBodies?.length ?? 0,
      jointCount: this.model?.joints?.length ?? 0,
      message,
    });
  }

  /**
   * Evaluates the pose at the current frame. With physics, `dt` seconds of
   * simulation are run between the "before" and "after physics" bone phases.
   */
  private applyFrame(dt = 0): void {
    const { solver, model, mesh } = this;
    if (!solver || !model || !mesh) return;
    solver.resetInputs();
    this.morphWeights.fill(0);
    const motion = this.motion;
    if (motion) {
      for (let i = 0; i < solver.count; i++) {
        const track = motion.boneTracks[i];
        if (track) sampleBoneTrack(track.frames, this.frame, solver.motionT[i], solver.motionR[i]);
        if (model.bones[i].ik) solver.ikEnabled[i] = sampleIkEnabled(motion.motion, model.bones[i].name, this.frame);
      }
      for (let i = 0; i < this.morphWeights.length; i++) {
        const track = motion.morphTracks[i];
        if (track) this.morphWeights[i] = sampleMorphTrack(track, this.frame);
      }
    }
    const physics = this.physicsActive() ? this.physics! : null;
    if (!physics) {
      solver.solve(this.options.enableIk);
    } else {
      solver.solve(this.options.enableIk, 'beforePhysics');
      if (this.physicsNeedsReset) {
        physics.reset(solver.world);
        this.physicsNeedsReset = false;
      } else {
        physics.setBoneTransforms(solver.world);
        physics.step(dt);
      }
      physics.getBoneTransforms(this.physicsTarget);
      solver.applyPhysics(physics.boneModes, this.physicsTarget);
      solver.solve(this.options.enableIk, 'afterPhysics');
    }
    if (this.rigidBodyHelper?.visible && this.rig) {
      if (physics) this.rigidBodyHelper.updateFromEngine(physics);
      else this.rigidBodyHelper.updateFromBones(this.rig, solver.world);
    }
    for (let i = 0; i < solver.count; i++) {
      toThreePos(solver.localT[i], this.bones[i].position);
      toThreeQuat(solver.localR[i], this.bones[i].quaternion);
    }
    if (this.morphs?.apply(this.morphWeights)) {
      mesh.geometry.getAttribute('position').needsUpdate = true;
    }
    this.needsRender = true;
  }

  /** The model's materials for a display preset, built once and reused. */
  private materialsFor(preset: DisplayPreset): THREE.Material[] {
    let mats = this.presetMaterials.get(preset);
    if (!mats) {
      if (preset === 'real' && !this.detailMaps) {
        this.detailMaps = { cloth: createClothDetailMap(), hair: createHairDetailMap() };
      }
      const shared = { detailMaps: this.detailMaps ?? undefined, mmdLightColor: this.mmdLightColor };
      mats = this.materialSources.map((src) => createPresetMaterial(preset, src, shared));
      this.presetMaterials.set(preset, mats);
    }
    return mats;
  }

  private applyPresetLighting(): void {
    const l = tunedPresetLighting(this.options.displayPreset);
    this.hemiLight.intensity = l.hemisphere;
    this.hemiLight.color.setHex(l.skyColor);
    this.hemiLight.groundColor.setHex(l.groundColor);
    const lit = resolveLighting(this.options.lighting, new THREE.Vector3(...l.lightFrom));
    const { scale, mmdColor } = lit.key;
    this.dirLight.intensity = l.directional;
    this.dirLight.color.setRGB(scale.r, scale.g, scale.b, THREE.SRGBColorSpace);
    this.shadows.setDirection(lit.key.from.clone().multiplyScalar(20));
    this.mmdLightColor.value.set(mmdColor.r, mmdColor.g, mmdColor.b);
    this.extraLights.forEach((light, i) => {
      const extra = lit.extras[i];
      light.visible = !!extra;
      if (!extra) return;
      light.color.copy(this.dirLight.color);
      light.intensity = l.directional * extra.strength;
      light.position.copy(extra.from).multiplyScalar(20);
    });
    if (l.environment > 0 && !this.environment) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    this.scene.environment = l.environment > 0 ? this.environment : null;
    this.scene.environmentIntensity = l.environment;
    this.renderer.toneMapping = resolveToneMapping(this.options.effects.toneMapping, l.toneMapping);
    this.renderer.toneMappingExposure = l.exposure;
    this.needsRender = true;
  }

  private loadTexture(url: string, path: string, wrap: THREE.Wrapping = THREE.RepeatWrapping): THREE.Texture {
    const ext = path.toLowerCase().split('.').pop() ?? '';
    const setup = (t: THREE.Texture) => {
      t.flipY = false; // PMX UVs use a top-left origin
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = wrap;
    };
    const onLoad = (t: THREE.Texture) => {
      setup(t);
      t.needsUpdate = true;
      this.needsRender = true;
    };
    const onError = () => console.warn(`texture failed: ${path}`);
    let tex: THREE.Texture;
    if (ext === 'tga') tex = new TGALoader().load(url, onLoad, undefined, onError);
    else if (ext === 'dds') tex = new DDSLoader().load(url, onLoad, undefined, onError);
    else tex = new THREE.TextureLoader().load(url, onLoad, undefined, onError);
    setup(tex);
    return tex;
  }

  private clearModel(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.skeleton.dispose();
    }
    for (const mats of this.presetMaterials.values()) for (const m of mats) m.dispose();
    this.presetMaterials.clear();
    this.materialSources = [];
    for (const t of this.textures) t.dispose();
    this.textures = [];
    if (this.skeletonHelper) {
      this.scene.remove(this.skeletonHelper);
      this.skeletonHelper.dispose();
    }
    if (this.rigidBodyHelper) {
      this.scene.remove(this.rigidBodyHelper);
      this.rigidBodyHelper.dispose();
    }
    this.rigidBodyHelper = null;
    this.rig = null;
    this.mesh = null;
    this.skeletonHelper = null;
    this.model = null;
    this.solver = null;
    this.morphs = null;
    this.bones = [];
    this.bonePoints = [];
    this.needsRender = true;
  }

  private resize(): void {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  /** Keeps the shadow camera around the posed model. */
  private fitShadows(): void {
    if (!this.mesh) return;
    this.mesh.updateMatrixWorld();
    this.bones.forEach((b, i) => b.getWorldPosition(this.bonePoints[i]));
    this.shadows.fit(shadowBounds(this.bonePoints, this.shadowSphere));
  }

  private loop = () => {
    if (this.disposed) return;
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = this.lastTick > 0 ? Math.min((now - this.lastTick) / 1000, 0.1) : 0;
    this.lastTick = now;
    if (this.physicsActive()) this.applyFrame(dt);
    if (!this.needsRender) return;
    this.needsRender = false;
    if (this.options.showShadows) this.fitShadows();
    if (effectsActive(this.options.effects)) {
      const focus = this.camera.position.distanceTo(this.controls.target);
      this.post.render(this.options.effects, { outline: this.options.showOutline, focus });
    } else if (this.options.showOutline) this.outline.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  };
}
