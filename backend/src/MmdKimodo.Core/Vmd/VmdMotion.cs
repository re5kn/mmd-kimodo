using System.Numerics;

namespace MmdKimodo.Core.Vmd;

public sealed class VmdMotion
{
    public string ModelName { get; init; } = "";
    public VmdBoneFrame[] BoneFrames { get; init; } = [];
    public VmdMorphFrame[] MorphFrames { get; init; } = [];
    public VmdIkFrame[] IkFrames { get; init; } = [];
    public int CameraFrameCount { get; init; }

    /// <summary>Last keyframe number over bone, morph and IK tracks.</summary>
    public int MaxFrame
    {
        get
        {
            uint max = 0;
            foreach (var f in BoneFrames) max = Math.Max(max, f.Frame);
            foreach (var f in MorphFrames) max = Math.Max(max, f.Frame);
            foreach (var f in IkFrames) max = Math.Max(max, f.Frame);
            return (int)max;
        }
    }
}

public sealed class VmdBoneFrame
{
    public string BoneName { get; init; } = "";
    public uint Frame { get; init; }
    /// <summary>Translation relative to the bone's rest position (PMX coordinates).</summary>
    public Vector3 Position { get; init; }
    /// <summary>Local rotation (x, y, z, w) in PMX coordinates.</summary>
    public Quaternion Rotation { get; init; }
    /// <summary>Raw 64-byte interpolation block.</summary>
    public byte[] Interpolation { get; init; } = new byte[64];
}

public sealed class VmdMorphFrame
{
    public string MorphName { get; init; } = "";
    public uint Frame { get; init; }
    public float Weight { get; init; }
}

public sealed class VmdIkFrame
{
    public uint Frame { get; init; }
    public bool Visible { get; init; }
    public VmdIkState[] States { get; init; } = [];
}

public readonly record struct VmdIkState(string BoneName, bool Enabled);
