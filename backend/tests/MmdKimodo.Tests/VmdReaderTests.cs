using System.Numerics;
using MmdKimodo.Api.Services;
using MmdKimodo.Core.IO;
using MmdKimodo.Core.Vmd;

namespace MmdKimodo.Tests;

public class VmdReaderTests
{
    private static string SamplePath => Path.Combine(AppContext.BaseDirectory, "samples", "sample-walk.vmd");

    [Fact]
    public void ReadsSampleMotion()
    {
        var v = VmdReader.Read(SamplePath);
        Assert.Equal("セン", v.ModelName);
        Assert.Equal(45, v.BoneFrames.Length);
        Assert.Equal(60, v.MaxFrame);
        Assert.Contains(v.BoneFrames, f => f.BoneName == "左足ＩＫ");
        Assert.Contains(v.BoneFrames, f => f.BoneName == "センター");
        Assert.Equal(5, v.MorphFrames.Length);
        Assert.All(v.MorphFrames, f => Assert.Equal("あ", f.MorphName));
        var ik = Assert.Single(v.IkFrames);
        Assert.Equal(["左足ＩＫ", "右足ＩＫ"], ik.States.Select(s => s.BoneName));

        var center = v.BoneFrames.Where(f => f.BoneName == "センター").OrderBy(f => f.Frame).ToArray();
        Assert.Equal(new Vector3(0, 0, -1.8f), center[1].Position);
    }

    [Fact]
    public void AcceptsFileWithoutTrailingSections()
    {
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        var header = new byte[30];
        "Vocaloid Motion Data 0002"u8.CopyTo(header);
        w.Write(header);
        w.Write(new byte[20]);
        w.Write(1u);
        var name = new byte[15];
        MmdEncodings.ShiftJis.GetBytes("頭").CopyTo(name, 0);
        w.Write(name);
        w.Write(7u);
        w.Write(1f); w.Write(2f); w.Write(3f);
        w.Write(0f); w.Write(0f); w.Write(0f); w.Write(1f);
        var interp = new byte[64];
        for (int i = 0; i < 16; i++) interp[i] = (byte)i;
        w.Write(interp);
        // no morph / camera / ... sections at all

        var v = VmdReader.Read(new MemoryStream(ms.ToArray()));
        var f = Assert.Single(v.BoneFrames);
        Assert.Equal("頭", f.BoneName);
        Assert.Equal(7u, f.Frame);
        Assert.Empty(v.MorphFrames);

        // Compacted interpolation: per channel x1,y1,x2,y2 = bytes c, c+4, c+8, c+12.
        Assert.Equal([0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15], DtoMapper.CompactInterpolation(interp));
    }

    [Fact]
    public void TrimsNamesCutInsideMultibyteCharacter()
    {
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        var header = new byte[30];
        "Vocaloid Motion Data 0002"u8.CopyTo(header);
        w.Write(header);
        w.Write(new byte[20]);
        w.Write(1u);
        // 8 full-width characters = 16 bytes; the 15-byte field cuts the last one in half.
        var full = MmdEncodings.ShiftJis.GetBytes("あいうえおかきく");
        w.Write(full[..15]);
        w.Write(0u);
        w.Write(new byte[12 + 16 + 64]);
        var v = VmdReader.Read(new MemoryStream(ms.ToArray()));
        Assert.Equal("あいうえおかき", v.BoneFrames[0].BoneName);
    }

    [Fact]
    public void RejectsNonVmd()
    {
        Assert.Throws<InvalidDataException>(() => VmdReader.Read(new MemoryStream(new byte[64])));
    }
}
