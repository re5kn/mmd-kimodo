namespace MmdKimodo.Api.Dtos;

/// <summary>VMD motion grouped into per-bone / per-morph tracks sorted by frame.</summary>
public sealed record MotionDto(
    string FileName,
    string ModelName,
    int MaxFrame,
    int BoneFrameCount,
    int MorphFrameCount,
    BoneTrackDto[] Bones,
    MorphTrackDto[] Morphs,
    IkFrameDto[] Ik);

public sealed record BoneTrackDto(string Name, BoneKeyDto[] Frames);

/// <summary>
/// <c>I</c> holds 16 bezier control values (0-127) ordered
/// [X: x1,y1,x2,y2, Y: ..., Z: ..., Rotation: ...].
/// </summary>
public sealed record BoneKeyDto(int F, float[] P, float[] R, int[] I);

public sealed record MorphTrackDto(string Name, MorphKeyDto[] Frames);

public sealed record MorphKeyDto(int F, float W);

public sealed record IkFrameDto(int F, bool Visible, IkStateDto[] States);

public sealed record IkStateDto(string Name, bool Enabled);
