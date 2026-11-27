namespace MmdKimodo.Api.Dtos;

/// <summary>
/// Model sent to the viewer. All coordinates are in native PMX space
/// (left-handed, Y up, model faces -Z); the frontend converts to three.js.
/// Large arrays are base64 encoded little-endian typed arrays.
/// </summary>
public sealed record ModelDto(
    string UploadId,
    string PmxPath,
    string[] PmxCandidates,
    string Name,
    string NameEn,
    string Comment,
    float Version,
    int VertexCount,
    int FaceCount,
    GeometryDto Geometry,
    MaterialDto[] Materials,
    TextureDto[] Textures,
    BoneDto[] Bones,
    MorphDto[] Morphs,
    RigidBodyDto[] RigidBodies,
    JointDto[] Joints);

public sealed record GeometryDto(
    /// <summary>Float32 x3 per vertex.</summary>
    string Positions,
    /// <summary>Float32 x3 per vertex.</summary>
    string Normals,
    /// <summary>Float32 x2 per vertex.</summary>
    string Uvs,
    /// <summary>Uint16 x4 per vertex (unused slots = 0 with weight 0).</summary>
    string SkinIndices,
    /// <summary>Float32 x4 per vertex.</summary>
    string SkinWeights,
    /// <summary>Uint32 x3 per triangle.</summary>
    string Indices,
    /// <summary>Float32 x2 per vertex: xy of the first additional UV (sphere sub-texture), or null when the model has none.</summary>
    string? Uv1 = null);

public sealed record MaterialDto(
    string Name,
    string NameEn,
    float[] Diffuse,
    float[] Specular,
    float Specularity,
    float[] Ambient,
    int Flags,
    float[] EdgeColor,
    float EdgeSize,
    int TextureIndex,
    int SphereTextureIndex,
    int SphereMode,
    bool SharedToon,
    int ToonIndex,
    int IndexStart,
    int IndexCount);

/// <summary>Texture referenced by the PMX; <c>Url</c> is null when the file was not uploaded.</summary>
public sealed record TextureDto(string Path, string? Url);

public sealed record BoneDto(
    string Name,
    string NameEn,
    float[] Position,
    int Parent,
    int Layer,
    int Flags,
    int TailBone,
    float[] TailOffset,
    int AppendParent,
    float AppendRatio,
    IkDto? Ik);

public sealed record IkDto(int Target, int LoopCount, float LimitAngle, IkLinkDto[] Links);

public sealed record IkLinkDto(int Bone, bool HasLimit, float[]? Min, float[]? Max);

public sealed record MorphDto(
    string Name,
    string NameEn,
    int Panel,
    int Type,
    /// <summary>Vertex morph: Uint32 vertex indices (base64).</summary>
    string? VertexIndices,
    /// <summary>Vertex morph: Float32 x3 offsets (base64).</summary>
    string? VertexOffsets,
    /// <summary>Group morph children.</summary>
    GroupOffsetDto[]? Group,
    /// <summary>Material morph entries.</summary>
    MaterialMorphOffsetDto[]? Material);

public sealed record GroupOffsetDto(int Morph, float Ratio);

/// <summary>
/// Material morph entry. Material -1: every material. Op 0: multiply (lerp
/// from 1 by the weight), 1: add. Colors as in PMX (RGBA / RGB).
/// </summary>
public sealed record MaterialMorphOffsetDto(
    int Material,
    int Op,
    float[] Diffuse,
    float[] Specular,
    float Specularity,
    float[] Ambient,
    float[] EdgeColor,
    float EdgeSize,
    float[] TextureFactor,
    float[] SphereFactor,
    float[] ToonFactor);

/// <summary>Rigid body. Shape: 0 sphere, 1 box, 2 capsule. Mode: 0 follow bone, 1 physics, 2 physics + bone position.</summary>
public sealed record RigidBodyDto(
    string Name,
    string NameEn,
    int Bone,
    int Group,
    int CollisionMask,
    int Shape,
    float[] Size,
    float[] Position,
    float[] Rotation,
    float Mass,
    float LinearDamping,
    float AngularDamping,
    float Restitution,
    float Friction,
    int Mode);

public sealed record JointDto(
    string Name,
    string NameEn,
    int Type,
    int RigidBodyA,
    int RigidBodyB,
    float[] Position,
    float[] Rotation,
    float[] LinearLowerLimit,
    float[] LinearUpperLimit,
    float[] AngularLowerLimit,
    float[] AngularUpperLimit,
    float[] SpringLinear,
    float[] SpringAngular);
