// DTOs returned by the C# backend (see backend/src/MmdKimodo.Api/Dtos).
// Coordinates are native PMX space (left-handed, Y up, model faces -Z).

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export interface ModelDto {
  uploadId: string;
  pmxPath: string;
  pmxCandidates: string[];
  name: string;
  nameEn: string;
  comment: string;
  version: number;
  vertexCount: number;
  faceCount: number;
  geometry: GeometryDto;
  materials: MaterialDto[];
  textures: TextureDto[];
  bones: BoneDto[];
  morphs: MorphDto[];
  rigidBodies: RigidBodyDto[];
  joints: JointDto[];
}

export interface GeometryDto {
  positions: string;
  normals: string;
  uvs: string;
  skinIndices: string;
  skinWeights: string;
  indices: string;
}

export interface MaterialDto {
  name: string;
  nameEn: string;
  diffuse: Vec4;
  specular: Vec3;
  specularity: number;
  ambient: Vec3;
  flags: number;
  edgeColor: Vec4;
  edgeSize: number;
  textureIndex: number;
  sphereTextureIndex: number;
  sphereMode: number;
  sharedToon: boolean;
  toonIndex: number;
  indexStart: number;
  indexCount: number;
}

export interface TextureDto {
  path: string;
  url: string | null;
}

export interface BoneDto {
  name: string;
  nameEn: string;
  position: Vec3;
  parent: number;
  layer: number;
  flags: number;
  tailBone: number;
  tailOffset: Vec3;
  appendParent: number;
  appendRatio: number;
  ik: IkDto | null;
}

export interface IkDto {
  target: number;
  loopCount: number;
  limitAngle: number;
  links: IkLinkDto[];
}

export interface IkLinkDto {
  bone: number;
  hasLimit: boolean;
  min: Vec3 | null;
  max: Vec3 | null;
}

export interface MorphDto {
  name: string;
  nameEn: string;
  panel: number;
  type: number;
  vertexIndices: string | null;
  vertexOffsets: string | null;
  group: { morph: number; ratio: number }[] | null;
}

/** Rigid body shape: 0 sphere, 1 box, 2 capsule. */
export const RigidBodyShape = { Sphere: 0, Box: 1, Capsule: 2 } as const;
/** 0: follows its bone, 1: simulated (drives the bone), 2: simulated rotation, bone keeps its position. */
export const RigidBodyMode = { FollowBone: 0, Physics: 1, PhysicsWithBone: 2 } as const;

export interface RigidBodyDto {
  name: string;
  nameEn: string;
  /** Related bone, or -1. */
  bone: number;
  /** Collision group 0-15. */
  group: number;
  /** Bit n set = collides with group n. */
  collisionMask: number;
  shape: number;
  /** Sphere: [radius], box: half extents, capsule: [radius, height]. */
  size: Vec3;
  position: Vec3;
  /** Euler angles (radians), applied in Y, X, Z order. */
  rotation: Vec3;
  mass: number;
  linearDamping: number;
  angularDamping: number;
  restitution: number;
  friction: number;
  mode: number;
}

/** Joint between two rigid bodies (type 0 = 6DOF spring). */
export interface JointDto {
  name: string;
  nameEn: string;
  type: number;
  rigidBodyA: number;
  rigidBodyB: number;
  position: Vec3;
  rotation: Vec3;
  linearLowerLimit: Vec3;
  linearUpperLimit: Vec3;
  angularLowerLimit: Vec3;
  angularUpperLimit: Vec3;
  springLinear: Vec3;
  springAngular: Vec3;
}

export interface MotionDto {
  fileName: string;
  modelName: string;
  maxFrame: number;
  boneFrameCount: number;
  morphFrameCount: number;
  bones: BoneTrackDto[];
  morphs: MorphTrackDto[];
  ik: IkFrameDto[];
}

export interface BoneTrackDto {
  name: string;
  frames: BoneKeyDto[];
}

/** f: frame, p: translation, r: quaternion xyzw, i: 16 bezier values [X,Y,Z,R] x [x1,y1,x2,y2]. */
export interface BoneKeyDto {
  f: number;
  p: Vec3;
  r: Vec4;
  i: number[];
}

export interface MorphTrackDto {
  name: string;
  frames: { f: number; w: number }[];
}

export interface IkFrameDto {
  f: number;
  visible: boolean;
  states: { name: string; enabled: boolean }[];
}

export const BoneFlags = {
  TailIsBone: 0x0001,
  Rotatable: 0x0002,
  Movable: 0x0004,
  Visible: 0x0008,
  Operable: 0x0010,
  Ik: 0x0020,
  LocalAppend: 0x0080,
  AppendRotate: 0x0100,
  AppendTranslate: 0x0200,
  PhysicsAfterDeform: 0x1000,
} as const;

export const MaterialFlags = {
  DoubleSided: 0x01,
  Edge: 0x10,
} as const;
