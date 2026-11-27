using System.Numerics;
using System.Text;
using MmdKimodo.Core.IO;

namespace MmdKimodo.Core.Pmx;

/// <summary>
/// Reader for PMX 2.0 / 2.1 models. Parses header, vertices, faces, textures,
/// materials, bones, morphs, rigid bodies and joints. Display frames are skipped,
/// and PMX 2.1 soft bodies are not read. Files that end right after the morphs
/// (or the display frames) are accepted and have no physics.
/// </summary>
public static class PmxReader
{
    public static PmxModel Read(string path)
    {
        using var fs = File.OpenRead(path);
        return Read(fs);
    }

    public static PmxModel Read(Stream stream)
    {
        var r = new MmdBinaryReader(stream);

        var magic = r.ReadBytes(4);
        if (magic[0] != 'P' || magic[1] != 'M' || magic[2] != 'X' || magic[3] != ' ')
        {
            if (magic[0] == 'P' && magic[1] == 'm' && magic[2] == 'd')
            {
                throw new InvalidDataException("PMD files are not supported. Please convert to PMX (e.g. with PMX Editor).");
            }
            throw new InvalidDataException("Not a PMX file.");
        }

        float version = r.ReadSingle();
        int globalsCount = r.ReadByte();
        if (globalsCount < 8)
        {
            throw new InvalidDataException($"Invalid PMX header (globals = {globalsCount}).");
        }
        var globals = r.ReadBytes(globalsCount);
        Encoding enc = globals[0] == 0 ? Encoding.Unicode : Encoding.UTF8;
        int addUv = globals[1];
        int vIdx = globals[2], texIdx = globals[3], matIdx = globals[4];
        int boneIdx = globals[5], morphIdx = globals[6];
        if (addUv > 4)
        {
            throw new InvalidDataException($"Invalid additional UV count {addUv}.");
        }

        string name = r.ReadPmxText(enc);
        string nameEn = r.ReadPmxText(enc);
        string comment = r.ReadPmxText(enc);
        string commentEn = r.ReadPmxText(enc);

        var vertices = ReadVertices(r, addUv, boneIdx);
        var indices = ReadFaces(r, vIdx, vertices.Length);

        int texCount = ReadCount(r);
        var textures = new string[texCount];
        for (int i = 0; i < texCount; i++) textures[i] = r.ReadPmxText(enc);

        var materials = ReadMaterials(r, enc, texIdx);
        var bones = ReadBones(r, enc, boneIdx);
        int rigidIdx = globals[7];
        var morphs = ReadMorphs(r, enc, vIdx, boneIdx, matIdx, morphIdx, rigidIdx);

        PmxRigidBody[] rigidBodies = [];
        PmxJoint[] joints = [];
        if (!r.AtEnd)
        {
            SkipDisplayFrames(r, enc, boneIdx, morphIdx);
            if (!r.AtEnd) rigidBodies = ReadRigidBodies(r, enc, boneIdx);
            if (!r.AtEnd) joints = ReadJoints(r, enc, rigidIdx);
        }

        return new PmxModel
        {
            Version = version,
            Name = name,
            NameEn = nameEn,
            Comment = comment,
            CommentEn = commentEn,
            AdditionalUvCount = addUv,
            Vertices = vertices,
            Indices = indices,
            Textures = textures,
            Materials = materials,
            Bones = bones,
            Morphs = morphs,
            RigidBodies = rigidBodies,
            Joints = joints,
        };
    }

    private static int ReadCount(MmdBinaryReader r)
    {
        int n = r.ReadInt32();
        if (n < 0 || n > r.BaseStream.Length - r.BaseStream.Position)
        {
            throw new InvalidDataException($"Invalid element count {n}.");
        }
        return n;
    }

    private static PmxVertex[] ReadVertices(MmdBinaryReader r, int addUv, int boneIdx)
    {
        int count = ReadCount(r);
        var vs = new PmxVertex[count];
        for (int i = 0; i < count; i++)
        {
            ref var v = ref vs[i];
            v.Position = r.ReadVector3();
            v.Normal = r.ReadVector3();
            v.Uv = r.ReadVector2();
            for (int k = 0; k < addUv; k++)
            {
                var extra = r.ReadVector4();
                if (k == 0) v.AdditionalUv1 = extra;
            }
            v.WeightType = (PmxWeightType)r.ReadByte();
            v.Bone1 = v.Bone2 = v.Bone3 = -1;
            switch (v.WeightType)
            {
                case PmxWeightType.Bdef1:
                    v.Bone0 = r.ReadIndex(boneIdx);
                    v.Weight0 = 1f;
                    break;
                case PmxWeightType.Bdef2:
                    v.Bone0 = r.ReadIndex(boneIdx);
                    v.Bone1 = r.ReadIndex(boneIdx);
                    v.Weight0 = r.ReadSingle();
                    v.Weight1 = 1f - v.Weight0;
                    break;
                case PmxWeightType.Bdef4:
                case PmxWeightType.Qdef:
                    v.Bone0 = r.ReadIndex(boneIdx);
                    v.Bone1 = r.ReadIndex(boneIdx);
                    v.Bone2 = r.ReadIndex(boneIdx);
                    v.Bone3 = r.ReadIndex(boneIdx);
                    v.Weight0 = r.ReadSingle();
                    v.Weight1 = r.ReadSingle();
                    v.Weight2 = r.ReadSingle();
                    v.Weight3 = r.ReadSingle();
                    break;
                case PmxWeightType.Sdef:
                    // Treated as BDEF2 by the viewer; SDEF parameters are skipped.
                    v.Bone0 = r.ReadIndex(boneIdx);
                    v.Bone1 = r.ReadIndex(boneIdx);
                    v.Weight0 = r.ReadSingle();
                    v.Weight1 = 1f - v.Weight0;
                    r.ReadVector3();
                    r.ReadVector3();
                    r.ReadVector3();
                    break;
                default:
                    throw new InvalidDataException($"Unknown weight type {(int)v.WeightType} at vertex {i}.");
            }
            v.EdgeScale = r.ReadSingle();
        }
        return vs;
    }

    private static int[] ReadFaces(MmdBinaryReader r, int vIdx, int vertexCount)
    {
        int count = ReadCount(r);
        if (count % 3 != 0)
        {
            throw new InvalidDataException($"Face index count {count} is not a multiple of 3.");
        }
        var idx = new int[count];
        for (int i = 0; i < count; i++)
        {
            int v = r.ReadVertexIndex(vIdx);
            if ((uint)v >= (uint)vertexCount)
            {
                throw new InvalidDataException($"Face index {v} out of range.");
            }
            idx[i] = v;
        }
        return idx;
    }

    private static PmxMaterial[] ReadMaterials(MmdBinaryReader r, Encoding enc, int texIdx)
    {
        int count = ReadCount(r);
        var ms = new PmxMaterial[count];
        for (int i = 0; i < count; i++)
        {
            string name = r.ReadPmxText(enc);
            string nameEn = r.ReadPmxText(enc);
            var diffuse = r.ReadVector4();
            var specular = r.ReadVector3();
            float specularity = r.ReadSingle();
            var ambient = r.ReadVector3();
            var flags = (PmxMaterialFlags)r.ReadByte();
            var edgeColor = r.ReadVector4();
            float edgeSize = r.ReadSingle();
            int tex = r.ReadIndex(texIdx);
            int sphere = r.ReadIndex(texIdx);
            byte sphereMode = r.ReadByte();
            bool sharedToon = r.ReadByte() == 1;
            int toon = sharedToon ? r.ReadByte() : r.ReadIndex(texIdx);
            string memo = r.ReadPmxText(enc);
            int indexCount = r.ReadInt32();
            ms[i] = new PmxMaterial
            {
                Name = name,
                NameEn = nameEn,
                Diffuse = diffuse,
                Specular = specular,
                Specularity = specularity,
                Ambient = ambient,
                Flags = flags,
                EdgeColor = edgeColor,
                EdgeSize = edgeSize,
                TextureIndex = tex,
                SphereTextureIndex = sphere,
                SphereMode = sphereMode,
                SharedToon = sharedToon,
                ToonIndex = toon,
                Memo = memo,
                IndexCount = indexCount,
            };
        }
        return ms;
    }

    private static PmxBone[] ReadBones(MmdBinaryReader r, Encoding enc, int boneIdx)
    {
        int count = ReadCount(r);
        var bones = new PmxBone[count];
        for (int i = 0; i < count; i++)
        {
            string name = r.ReadPmxText(enc);
            string nameEn = r.ReadPmxText(enc);
            var pos = r.ReadVector3();
            int parent = r.ReadIndex(boneIdx);
            int layer = r.ReadInt32();
            var flags = (PmxBoneFlags)r.ReadUInt16();

            int tailBone = -1;
            Vector3 tailOffset = default;
            if (flags.HasFlag(PmxBoneFlags.TailIsBone)) tailBone = r.ReadIndex(boneIdx);
            else tailOffset = r.ReadVector3();

            int appendParent = -1;
            float appendRatio = 0f;
            if ((flags & (PmxBoneFlags.AppendRotate | PmxBoneFlags.AppendTranslate)) != 0)
            {
                appendParent = r.ReadIndex(boneIdx);
                appendRatio = r.ReadSingle();
            }

            Vector3? fixedAxis = flags.HasFlag(PmxBoneFlags.FixedAxis) ? r.ReadVector3() : null;
            Vector3? localX = null, localZ = null;
            if (flags.HasFlag(PmxBoneFlags.LocalAxis))
            {
                localX = r.ReadVector3();
                localZ = r.ReadVector3();
            }
            int externalKey = flags.HasFlag(PmxBoneFlags.ExternalParent) ? r.ReadInt32() : 0;

            PmxIk? ik = null;
            if (flags.HasFlag(PmxBoneFlags.Ik))
            {
                int target = r.ReadIndex(boneIdx);
                int loop = r.ReadInt32();
                float limit = r.ReadSingle();
                int linkCount = ReadCount(r);
                var links = new PmxIkLink[linkCount];
                for (int k = 0; k < linkCount; k++)
                {
                    int lb = r.ReadIndex(boneIdx);
                    bool hasLimit = r.ReadByte() == 1;
                    Vector3 min = default, max = default;
                    if (hasLimit)
                    {
                        min = r.ReadVector3();
                        max = r.ReadVector3();
                    }
                    links[k] = new PmxIkLink { Bone = lb, HasLimit = hasLimit, Min = min, Max = max };
                }
                ik = new PmxIk { Target = target, LoopCount = loop, LimitAngle = limit, Links = links };
            }

            bones[i] = new PmxBone
            {
                Name = name,
                NameEn = nameEn,
                Position = pos,
                Parent = parent,
                Layer = layer,
                Flags = flags,
                TailBone = tailBone,
                TailOffset = tailOffset,
                AppendParent = appendParent,
                AppendRatio = appendRatio,
                FixedAxis = fixedAxis,
                LocalAxisX = localX,
                LocalAxisZ = localZ,
                ExternalParentKey = externalKey,
                Ik = ik,
            };
        }
        return bones;
    }

    private static PmxMorph[] ReadMorphs(MmdBinaryReader r, Encoding enc, int vIdx, int boneIdx, int matIdx, int morphIdx, int rigidIdx)
    {
        int count = ReadCount(r);
        var morphs = new PmxMorph[count];
        for (int i = 0; i < count; i++)
        {
            string name = r.ReadPmxText(enc);
            string nameEn = r.ReadPmxText(enc);
            byte panel = r.ReadByte();
            var type = (PmxMorphType)r.ReadByte();
            int n = ReadCount(r);

            PmxVertexMorphOffset[] vertexOffsets = [];
            PmxGroupMorphOffset[] groupOffsets = [];
            PmxBoneMorphOffset[] boneOffsets = [];
            PmxMaterialMorphOffset[] materialOffsets = [];

            switch (type)
            {
                case PmxMorphType.Group:
                case PmxMorphType.Flip:
                    groupOffsets = new PmxGroupMorphOffset[n];
                    for (int k = 0; k < n; k++) groupOffsets[k] = new(r.ReadIndex(morphIdx), r.ReadSingle());
                    break;
                case PmxMorphType.Vertex:
                    vertexOffsets = new PmxVertexMorphOffset[n];
                    for (int k = 0; k < n; k++) vertexOffsets[k] = new(r.ReadVertexIndex(vIdx), r.ReadVector3());
                    break;
                case PmxMorphType.Bone:
                    boneOffsets = new PmxBoneMorphOffset[n];
                    for (int k = 0; k < n; k++)
                    {
                        int b = r.ReadIndex(boneIdx);
                        var t = r.ReadVector3();
                        var q = r.ReadVector4();
                        boneOffsets[k] = new(b, t, new Quaternion(q.X, q.Y, q.Z, q.W));
                    }
                    break;
                case PmxMorphType.Uv:
                case PmxMorphType.AdditionalUv1:
                case PmxMorphType.AdditionalUv2:
                case PmxMorphType.AdditionalUv3:
                case PmxMorphType.AdditionalUv4:
                    for (int k = 0; k < n; k++)
                    {
                        r.ReadVertexIndex(vIdx);
                        r.ReadVector4();
                    }
                    break;
                case PmxMorphType.Material:
                    materialOffsets = new PmxMaterialMorphOffset[n];
                    for (int k = 0; k < n; k++)
                    {
                        materialOffsets[k] = new PmxMaterialMorphOffset
                        {
                            Material = r.ReadIndex(matIdx),
                            Op = (PmxMaterialMorphOp)r.ReadByte(),
                            Diffuse = r.ReadVector4(),
                            Specular = r.ReadVector3(),
                            Specularity = r.ReadSingle(),
                            Ambient = r.ReadVector3(),
                            EdgeColor = r.ReadVector4(),
                            EdgeSize = r.ReadSingle(),
                            TextureFactor = r.ReadVector4(),
                            SphereFactor = r.ReadVector4(),
                            ToonFactor = r.ReadVector4(),
                        };
                    }
                    break;
                case PmxMorphType.Impulse:
                    for (int k = 0; k < n; k++)
                    {
                        r.ReadIndex(rigidIdx);
                        r.ReadBytes(1 + 6 * 4);
                    }
                    break;
                default:
                    throw new InvalidDataException($"Unknown morph type {(int)type} in morph '{name}'.");
            }

            morphs[i] = new PmxMorph
            {
                Name = name,
                NameEn = nameEn,
                Panel = panel,
                Type = type,
                VertexOffsets = vertexOffsets,
                GroupOffsets = groupOffsets,
                BoneOffsets = boneOffsets,
                MaterialOffsets = materialOffsets,
            };
        }
        return morphs;
    }

    private static void SkipDisplayFrames(MmdBinaryReader r, Encoding enc, int boneIdx, int morphIdx)
    {
        int count = ReadCount(r);
        for (int i = 0; i < count; i++)
        {
            r.ReadPmxText(enc);
            r.ReadPmxText(enc);
            r.ReadByte(); // special frame flag
            int n = ReadCount(r);
            for (int k = 0; k < n; k++)
            {
                byte target = r.ReadByte();
                r.ReadIndex(target == 0 ? boneIdx : morphIdx);
            }
        }
    }

    private static PmxRigidBody[] ReadRigidBodies(MmdBinaryReader r, Encoding enc, int boneIdx)
    {
        int count = ReadCount(r);
        var bodies = new PmxRigidBody[count];
        for (int i = 0; i < count; i++)
        {
            bodies[i] = new PmxRigidBody
            {
                Name = r.ReadPmxText(enc),
                NameEn = r.ReadPmxText(enc),
                Bone = r.ReadIndex(boneIdx),
                Group = r.ReadByte(),
                CollisionMask = r.ReadUInt16(),
                Shape = (PmxRigidBodyShape)r.ReadByte(),
                Size = r.ReadVector3(),
                Position = r.ReadVector3(),
                Rotation = r.ReadVector3(),
                Mass = r.ReadSingle(),
                LinearDamping = r.ReadSingle(),
                AngularDamping = r.ReadSingle(),
                Restitution = r.ReadSingle(),
                Friction = r.ReadSingle(),
                Mode = (PmxRigidBodyMode)r.ReadByte(),
            };
        }
        return bodies;
    }

    private static PmxJoint[] ReadJoints(MmdBinaryReader r, Encoding enc, int rigidIdx)
    {
        int count = ReadCount(r);
        var joints = new PmxJoint[count];
        for (int i = 0; i < count; i++)
        {
            // PMX 2.1 adds more joint types, all with the same parameter block.
            joints[i] = new PmxJoint
            {
                Name = r.ReadPmxText(enc),
                NameEn = r.ReadPmxText(enc),
                Type = r.ReadByte(),
                RigidBodyA = r.ReadIndex(rigidIdx),
                RigidBodyB = r.ReadIndex(rigidIdx),
                Position = r.ReadVector3(),
                Rotation = r.ReadVector3(),
                LinearLowerLimit = r.ReadVector3(),
                LinearUpperLimit = r.ReadVector3(),
                AngularLowerLimit = r.ReadVector3(),
                AngularUpperLimit = r.ReadVector3(),
                SpringLinear = r.ReadVector3(),
                SpringAngular = r.ReadVector3(),
            };
        }
        return joints;
    }
}
