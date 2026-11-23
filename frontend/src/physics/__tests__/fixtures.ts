import { BoneFlags, type BoneDto, type JointDto, type RigidBodyDto } from '../../api/types';

export function bone(name: string, position: [number, number, number], parent: number): BoneDto {
  return {
    name, nameEn: name, position, parent, layer: 0, flags: BoneFlags.Rotatable | BoneFlags.Visible,
    tailBone: -1, tailOffset: [0, 1, 0], appendParent: -1, appendRatio: 0, ik: null,
  };
}

export function body(name: string, boneIndex: number, position: [number, number, number], mode: number, extra: Partial<RigidBodyDto> = {}): RigidBodyDto {
  return {
    name, nameEn: name, bone: boneIndex, group: 0, collisionMask: 0xffff, shape: 0, size: [0.3, 0, 0],
    position, rotation: [0, 0, 0], mass: 1, linearDamping: 0.5, angularDamping: 0.5, restitution: 0, friction: 0.5,
    mode, ...extra,
  };
}

export function joint(a: number, b: number, position: [number, number, number], extra: Partial<JointDto> = {}): JointDto {
  return {
    name: `j${a}-${b}`, nameEn: '', type: 0, rigidBodyA: a, rigidBodyB: b, position, rotation: [0, 0, 0],
    linearLowerLimit: [0, 0, 0], linearUpperLimit: [0, 0, 0],
    angularLowerLimit: [-1, -1, -1], angularUpperLimit: [1, 1, 1],
    springLinear: [0, 0, 0], springAngular: [0, 0, 0], ...extra,
  };
}
