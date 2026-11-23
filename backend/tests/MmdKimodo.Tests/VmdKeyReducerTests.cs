using System.Numerics;
using MmdKimodo.Core.Vmd;

namespace MmdKimodo.Tests;

public class VmdKeyReducerTests
{
    private static VmdBoneFrame Key(string bone, uint f, Vector3 p, Quaternion r) =>
        new() { BoneName = bone, Frame = f, Position = p, Rotation = r };

    private static VmdMotion Dense(string bone, int frames, Func<int, (Vector3, Quaternion)> at) => new()
    {
        ModelName = "m",
        BoneFrames = Enumerable.Range(0, frames).Select(i => { var (p, r) = at(i); return Key(bone, (uint)i, p, r); }).ToArray(),
    };

    private static uint[] Frames(VmdMotion m, string bone) =>
        m.BoneFrames.Where(f => f.BoneName == bone).Select(f => f.Frame).OrderBy(f => f).ToArray();

    [Fact]
    public void ConstantTrackKeepsFirstAndLast()
    {
        var m = Dense("頭", 90, _ => (Vector3.Zero, Quaternion.Identity));
        var r = VmdKeyReducer.Reduce(m);
        Assert.Equal([0u, 89u], Frames(r, "頭"));
        Assert.Equal(89, r.MaxFrame);
    }

    [Fact]
    public void LinearMotionCollapsesToEndpoints()
    {
        var m = Dense("センター", 60, i => (new Vector3(0, 0, i * 0.5f), Quaternion.CreateFromAxisAngle(Vector3.UnitY, i * 0.01f)));
        Assert.Equal([0u, 59u], Frames(VmdKeyReducer.Reduce(m), "センター"));
    }

    [Fact]
    public void KeepsCornersAndStaysWithinTolerance()
    {
        // Moves 0 -> 30 then back: the turn at frame 30 must stay.
        var m = Dense("センター", 61, i => (new Vector3(i <= 30 ? i : 60 - i, 0, 0), Quaternion.Identity));
        Assert.Equal([0u, 30u, 60u], Frames(VmdKeyReducer.Reduce(m), "センター"));
    }

    [Fact]
    public void CurvedRotationIsApproximatedWithinTolerance()
    {
        const float tolDeg = 0.5f;
        var m = Dense("右腕", 150, i => (Vector3.Zero, Quaternion.CreateFromAxisAngle(Vector3.UnitZ, MathF.Sin(i / 60f * MathF.Tau) * 0.5f)));
        var reduced = VmdKeyReducer.Reduce(m, new(tolDeg, 0.02f));
        var kept = reduced.BoneFrames.OrderBy(f => f.Frame).ToArray();
        Assert.InRange(kept.Length, 3, m.BoneFrames.Length / 2);
        // Every original frame is reproduced by slerp between the kept neighbours.
        foreach (var orig in m.BoneFrames)
        {
            var b = kept.First(k => k.Frame >= orig.Frame);
            var a = kept.Last(k => k.Frame <= orig.Frame);
            float t = a.Frame == b.Frame ? 0 : (orig.Frame - a.Frame) / (float)(b.Frame - a.Frame);
            var q = Quaternion.Slerp(a.Rotation, b.Rotation, t);
            float angle = 2 * MathF.Acos(MathF.Min(1, MathF.Abs(Quaternion.Dot(q, orig.Rotation)))) * 180 / MathF.PI;
            Assert.True(angle <= tolDeg + 1e-3f, $"frame {orig.Frame}: {angle}°");
        }
    }

    [Theory]
    [InlineData("none", false)]
    [InlineData("low", true)]
    [InlineData("normal", true)]
    [InlineData(null, true)]
    [InlineData("high", true)]
    public void Presets(string? name, bool reduces)
    {
        Assert.Equal(reduces, VmdKeyReducer.Preset(name) is not null);
        Assert.True(VmdKeyReducer.Preset("low")!.RotationToleranceDegrees < VmdKeyReducer.Preset("high")!.RotationToleranceDegrees);
    }

    [Fact]
    public void LeavesMorphsAndIkAndOtherBones()
    {
        var m = new VmdMotion
        {
            ModelName = "m",
            BoneFrames = [Key("a", 0, Vector3.Zero, Quaternion.Identity), Key("a", 1, Vector3.Zero, Quaternion.Identity), Key("a", 2, Vector3.Zero, Quaternion.Identity), Key("b", 5, Vector3.Zero, Quaternion.Identity)],
            MorphFrames = [new VmdMorphFrame { MorphName = "x", Frame = 3, Weight = 1 }],
            IkFrames = [new VmdIkFrame { Frame = 0, Visible = true }],
        };
        var r = VmdKeyReducer.Reduce(m);
        Assert.Equal([0u, 2u], Frames(r, "a"));
        Assert.Equal([5u], Frames(r, "b"));
        Assert.Same(m.MorphFrames, r.MorphFrames);
        Assert.Same(m.IkFrames, r.IkFrames);
    }
}
