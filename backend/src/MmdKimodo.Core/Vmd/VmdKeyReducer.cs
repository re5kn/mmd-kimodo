using System.Numerics;

namespace MmdKimodo.Core.Vmd;

/// <summary>
/// Thins out dense bone keyframes (e.g. one key per frame from Kimodo) by removing
/// keys that linear interpolation between the remaining neighbours reproduces
/// within a tolerance. Meant for linearly interpolated keys: the kept keys keep
/// their own interpolation block, so curved (bezier) segments would change shape.
/// Morph and IK frames are left as they are. The first and last key of each bone
/// are always kept.
/// </summary>
public static class VmdKeyReducer
{
    public sealed record Options(float RotationToleranceDegrees = 1f, float PositionTolerance = 0.05f);

    /// <summary>Presets by name: "none" (null), "low", "normal" (default), "high".</summary>
    public static Options? Preset(string? name) => name?.ToLowerInvariant() switch
    {
        "none" or "off" => null,
        "low" => new Options(0.5f, 0.02f),
        "high" => new Options(2f, 0.1f),
        _ => new Options(),
    };

    public static VmdMotion Reduce(VmdMotion motion, Options? options = null)
    {
        options ??= new Options();
        float rotTol = MathF.Max(0, options.RotationToleranceDegrees) * MathF.PI / 180f;
        float posTol = MathF.Max(0, options.PositionTolerance);

        var bones = motion.BoneFrames
            .GroupBy(f => f.BoneName)
            .SelectMany(g => ReduceTrack(g.OrderBy(f => f.Frame).DistinctBy(f => f.Frame).ToArray(), rotTol, posTol))
            .ToArray();

        return new VmdMotion
        {
            ModelName = motion.ModelName,
            BoneFrames = bones,
            MorphFrames = motion.MorphFrames,
            IkFrames = motion.IkFrames,
            CameraFrameCount = motion.CameraFrameCount,
        };
    }

    /// <summary>Greedy: from each kept key, reach as far as every skipped key stays within tolerance.</summary>
    internal static List<VmdBoneFrame> ReduceTrack(VmdBoneFrame[] keys, float rotTol, float posTol)
    {
        var kept = new List<VmdBoneFrame>();
        if (keys.Length == 0) return kept;
        int anchor = 0;
        kept.Add(keys[0]);
        while (anchor < keys.Length - 1)
        {
            int end = anchor + 1;
            while (end + 1 < keys.Length && Fits(keys, anchor, end + 1, rotTol, posTol)) end++;
            kept.Add(keys[end]);
            anchor = end;
        }
        return kept;
    }

    private static bool Fits(VmdBoneFrame[] keys, int a, int b, float rotTol, float posTol)
    {
        var ka = keys[a];
        var kb = keys[b];
        float span = kb.Frame - ka.Frame;
        for (int i = a + 1; i < b; i++)
        {
            var k = keys[i];
            float t = (k.Frame - ka.Frame) / span;
            if (Vector3.Distance(Vector3.Lerp(ka.Position, kb.Position, t), k.Position) > posTol) return false;
            if (Angle(Quaternion.Slerp(ka.Rotation, kb.Rotation, t), k.Rotation) > rotTol) return false;
        }
        return true;
    }

    private static float Angle(Quaternion p, Quaternion q)
    {
        float d = MathF.Abs(Quaternion.Dot(Quaternion.Normalize(p), Quaternion.Normalize(q)));
        return 2f * MathF.Acos(MathF.Min(1f, d));
    }
}
