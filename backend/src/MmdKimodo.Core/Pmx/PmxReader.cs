using System.Numerics;
using System.Text;
using MmdKimodo.Core.IO;

namespace MmdKimodo.Core.Pmx;

/// <summary>
/// Reader for PMX 2.0 / 2.1 models. Parses header, vertices, faces, textures,
/// materials, bones and morphs. Display frames, rigid bodies and joints are not
/// needed by the viewer and are skipped.
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
        var morphs = ReadMorphs(r, enc, vIdx, boneIdx, matIdx, morphIdx, globals.Length > 7 ? globals[7] : 4);

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
            for (int k = 0; k < addUv; k++) r.ReadVector4();
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
                    // index + op(1) + diffuse4 + spec3 + specularity1 + ambient3 + edge4 + edgeSize1 + tex4 + sphere4 + toon4 = 28 floats
                    for (int k = 0; k < n; k++)
                    {
                        r.ReadIndex(matIdx);
                        r.ReadBytes(1 + 28 * 4);
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
            };
        }
        return morphs;
    }
}
