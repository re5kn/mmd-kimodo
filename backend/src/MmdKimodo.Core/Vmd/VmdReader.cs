using System.Numerics;
using MmdKimodo.Core.IO;

namespace MmdKimodo.Core.Vmd;

/// <summary>
/// Reader for VMD motion files. Bone, morph and IK on/off sections are parsed;
/// camera / light / self-shadow sections are skipped. Files that end early
/// (older exporters omit trailing sections) are accepted.
/// </summary>
public static class VmdReader
{
    private const int BoneFrameSize = 15 + 4 + 12 + 16 + 64;
    private const int MorphFrameSize = 15 + 4 + 4;
    private const int CameraFrameSize = 4 + 4 + 12 + 12 + 24 + 4 + 1;
    private const int LightFrameSize = 4 + 12 + 12;
    private const int ShadowFrameSize = 4 + 1 + 4;

    public static VmdMotion Read(string path)
    {
        using var fs = File.OpenRead(path);
        return Read(fs);
    }

    public static VmdMotion Read(Stream stream)
    {
        var r = new MmdBinaryReader(stream);
        var header = r.ReadFixedShiftJis(30);
        int modelNameSize;
        if (header.StartsWith("Vocaloid Motion Data 0002", StringComparison.Ordinal)) modelNameSize = 20;
        else if (header.StartsWith("Vocaloid Motion Data file", StringComparison.Ordinal)) modelNameSize = 10;
        else throw new InvalidDataException("Not a VMD file.");

        string modelName = r.ReadFixedShiftJis(modelNameSize);

        var bones = new List<VmdBoneFrame>();
        var morphs = new List<VmdMorphFrame>();
        var iks = new List<VmdIkFrame>();
        int cameraCount = 0;

        int n = ReadSectionCount(r, BoneFrameSize);
        bones.Capacity = n;
        for (int i = 0; i < n; i++)
        {
            string name = r.ReadFixedShiftJis(15);
            uint frame = r.ReadUInt32();
            var pos = r.ReadVector3();
            var q = r.ReadVector4();
            var interp = r.ReadBytes(64);
            bones.Add(new VmdBoneFrame
            {
                BoneName = name,
                Frame = frame,
                Position = pos,
                Rotation = new Quaternion(q.X, q.Y, q.Z, q.W),
                Interpolation = interp,
            });
        }

        if (!r.AtEnd)
        {
            n = ReadSectionCount(r, MorphFrameSize);
            for (int i = 0; i < n; i++)
            {
                morphs.Add(new VmdMorphFrame
                {
                    MorphName = r.ReadFixedShiftJis(15),
                    Frame = r.ReadUInt32(),
                    Weight = r.ReadSingle(),
                });
            }
        }

        if (!r.AtEnd)
        {
            cameraCount = ReadSectionCount(r, CameraFrameSize);
            r.ReadBytes(cameraCount * CameraFrameSize);
        }
        if (!r.AtEnd)
        {
            n = ReadSectionCount(r, LightFrameSize);
            r.ReadBytes(n * LightFrameSize);
        }
        if (!r.AtEnd)
        {
            n = ReadSectionCount(r, ShadowFrameSize);
            r.ReadBytes(n * ShadowFrameSize);
        }
        if (!r.AtEnd)
        {
            n = ReadSectionCount(r, 9);
            for (int i = 0; i < n; i++)
            {
                uint frame = r.ReadUInt32();
                bool visible = r.ReadByte() != 0;
                int m = ReadSectionCount(r, 21);
                var states = new VmdIkState[m];
                for (int k = 0; k < m; k++)
                {
                    states[k] = new VmdIkState(r.ReadFixedShiftJis(20), r.ReadByte() != 0);
                }
                iks.Add(new VmdIkFrame { Frame = frame, Visible = visible, States = states });
            }
        }

        return new VmdMotion
        {
            ModelName = modelName,
            BoneFrames = bones.ToArray(),
            MorphFrames = morphs.ToArray(),
            IkFrames = iks.ToArray(),
            CameraFrameCount = cameraCount,
        };
    }

    private static int ReadSectionCount(MmdBinaryReader r, int minElementSize)
    {
        uint n = r.ReadUInt32();
        long remaining = r.BaseStream.Length - r.BaseStream.Position;
        if (n > remaining / minElementSize)
        {
            throw new InvalidDataException($"Invalid VMD section count {n}.");
        }
        return (int)n;
    }
}
