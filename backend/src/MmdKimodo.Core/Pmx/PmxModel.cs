using System.Numerics;

namespace MmdKimodo.Core.Pmx;

public sealed class PmxModel
{
    public float Version { get; init; }
    public string Name { get; init; } = "";
    public string NameEn { get; init; } = "";
    public string Comment { get; init; } = "";
    public string CommentEn { get; init; } = "";
    public int AdditionalUvCount { get; init; }
    public PmxVertex[] Vertices { get; init; } = [];
    /// <summary>Triangle list, 3 indices per face.</summary>
    public int[] Indices { get; init; } = [];
    public string[] Textures { get; init; } = [];
    public PmxMaterial[] Materials { get; init; } = [];
    public PmxBone[] Bones { get; init; } = [];
    public PmxMorph[] Morphs { get; init; } = [];
}

public enum PmxWeightType : byte
{
    Bdef1 = 0,
    Bdef2 = 1,
    Bdef4 = 2,
    Sdef = 3,
    Qdef = 4,
}

public struct PmxVertex
{
    public Vector3 Position;
    public Vector3 Normal;
    public Vector2 Uv;
    public PmxWeightType WeightType;
    public int Bone0, Bone1, Bone2, Bone3;
    public float Weight0, Weight1, Weight2, Weight3;
    public float EdgeScale;
}

[Flags]
public enum PmxMaterialFlags : byte
{
    None = 0,
    DoubleSided = 0x01,
    GroundShadow = 0x02,
    SelfShadowMap = 0x04,
    SelfShadow = 0x08,
    Edge = 0x10,
    VertexColor = 0x20,
    PointDraw = 0x40,
    LineDraw = 0x80,
}

public sealed class PmxMaterial
{
    public string Name { get; init; } = "";
    public string NameEn { get; init; } = "";
    public Vector4 Diffuse { get; init; }
    public Vector3 Specular { get; init; }
    public float Specularity { get; init; }
    public Vector3 Ambient { get; init; }
    public PmxMaterialFlags Flags { get; init; }
    public Vector4 EdgeColor { get; init; }
    public float EdgeSize { get; init; }
    public int TextureIndex { get; init; }
    public int SphereTextureIndex { get; init; }
    /// <summary>0 = off, 1 = multiply (sph), 2 = add (spa), 3 = sub texture.</summary>
    public byte SphereMode { get; init; }
    public bool SharedToon { get; init; }
    /// <summary>Texture index, or 0-9 for toon01..toon10 when <see cref="SharedToon"/>.</summary>
    public int ToonIndex { get; init; }
    public string Memo { get; init; } = "";
    /// <summary>Number of indices (3 per triangle) drawn by this material.</summary>
    public int IndexCount { get; init; }
}

[Flags]
public enum PmxBoneFlags : ushort
{
    None = 0,
    TailIsBone = 0x0001,
    Rotatable = 0x0002,
    Movable = 0x0004,
    Visible = 0x0008,
    Operable = 0x0010,
    Ik = 0x0020,
    LocalAppend = 0x0080,
    AppendRotate = 0x0100,
    AppendTranslate = 0x0200,
    FixedAxis = 0x0400,
    LocalAxis = 0x0800,
    PhysicsAfterDeform = 0x1000,
    ExternalParent = 0x2000,
}

public sealed class PmxBone
{
    public string Name { get; init; } = "";
    public string NameEn { get; init; } = "";
    public Vector3 Position { get; init; }
    public int Parent { get; init; } = -1;
    public int Layer { get; init; }
    public PmxBoneFlags Flags { get; init; }
    public int TailBone { get; init; } = -1;
    public Vector3 TailOffset { get; init; }
    public int AppendParent { get; init; } = -1;
    public float AppendRatio { get; init; }
    public Vector3? FixedAxis { get; init; }
    public Vector3? LocalAxisX { get; init; }
    public Vector3? LocalAxisZ { get; init; }
    public int ExternalParentKey { get; init; }
    public PmxIk? Ik { get; init; }
}

public sealed class PmxIk
{
    public int Target { get; init; } = -1;
    public int LoopCount { get; init; }
    /// <summary>Max rotation per iteration step, radians.</summary>
    public float LimitAngle { get; init; }
    public PmxIkLink[] Links { get; init; } = [];
}

public sealed class PmxIkLink
{
    public int Bone { get; init; } = -1;
    public bool HasLimit { get; init; }
    /// <summary>Euler lower limit (radians, PMX coordinates).</summary>
    public Vector3 Min { get; init; }
    public Vector3 Max { get; init; }
}

public enum PmxMorphType : byte
{
    Group = 0,
    Vertex = 1,
    Bone = 2,
    Uv = 3,
    AdditionalUv1 = 4,
    AdditionalUv2 = 5,
    AdditionalUv3 = 6,
    AdditionalUv4 = 7,
    Material = 8,
    Flip = 9,
    Impulse = 10,
}

public sealed class PmxMorph
{
    public string Name { get; init; } = "";
    public string NameEn { get; init; } = "";
    /// <summary>0 = system, 1 = eyebrow, 2 = eye, 3 = mouth, 4 = other.</summary>
    public byte Panel { get; init; }
    public PmxMorphType Type { get; init; }
    public PmxVertexMorphOffset[] VertexOffsets { get; init; } = [];
    public PmxGroupMorphOffset[] GroupOffsets { get; init; } = [];
    public PmxBoneMorphOffset[] BoneOffsets { get; init; } = [];
}

public readonly record struct PmxVertexMorphOffset(int Vertex, Vector3 Offset);

public readonly record struct PmxGroupMorphOffset(int Morph, float Ratio);

public readonly record struct PmxBoneMorphOffset(int Bone, Vector3 Translation, Quaternion Rotation);
