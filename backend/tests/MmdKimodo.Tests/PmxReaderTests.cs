using System.Numerics;
using System.Text;
using MmdKimodo.Core.Pmx;

namespace MmdKimodo.Tests;

public class PmxReaderTests
{
    private static string SamplePath => Path.Combine(AppContext.BaseDirectory, "samples", "sample-model", "sample.pmx");

    [Fact]
    public void ReadsSampleModel()
    {
        var m = PmxReader.Read(SamplePath);

        Assert.Equal(2.0f, m.Version);
        Assert.Equal("サンプル", m.Name);
        Assert.Equal(456, m.Vertices.Length);
        Assert.Equal(228 * 3, m.Indices.Length);
        Assert.Equal(["tex\\checker.png"], m.Textures);
        Assert.Equal(4, m.Materials.Length);
        Assert.Equal(m.Indices.Length, m.Materials.Sum(x => x.IndexCount));
        Assert.Equal(23, m.Bones.Length);
        Assert.Equal(3, m.Morphs.Length);

        var center = m.Bones.Single(b => b.Name == "センター");
        Assert.Equal(new Vector3(0, 8, 0), center.Position);

        var ik = m.Bones.Single(b => b.Name == "左足ＩＫ");
        Assert.True(ik.Flags.HasFlag(PmxBoneFlags.Ik));
        Assert.NotNull(ik.Ik);
        Assert.Equal("左足首", m.Bones[ik.Ik!.Target].Name);
        Assert.Equal(40, ik.Ik.LoopCount);
        Assert.Equal(2, ik.Ik.Links.Length);
        Assert.Equal("左ひざ", m.Bones[ik.Ik.Links[0].Bone].Name);
        Assert.True(ik.Ik.Links[0].HasLimit);
        Assert.False(ik.Ik.Links[1].HasLimit);

        Assert.Equal(PmxMorphType.Vertex, m.Morphs[0].Type);
        Assert.NotEmpty(m.Morphs[0].VertexOffsets);
        Assert.Equal(PmxMorphType.Group, m.Morphs[1].Type);
        Assert.Equal(new PmxGroupMorphOffset(0, 0.5f), m.Morphs[1].GroupOffsets.Single());
        Assert.Equal(PmxMorphType.Material, m.Morphs[2].Type);
        var blush = m.Morphs[2].MaterialOffsets.Single();
        Assert.Equal(0, blush.Material);
        Assert.Equal(PmxMaterialMorphOp.Multiply, blush.Op);
        Assert.Equal(new Vector4(1, 0.75f, 0.75f, 1), blush.Diffuse);
        Assert.Equal(1, blush.EdgeSize);
        Assert.Equal(Vector4.One, blush.ToonFactor);

        Assert.Equal(5, m.RigidBodies.Length);
        var head = m.RigidBodies[0];
        Assert.Equal("頭", head.Name);
        Assert.Equal("頭", m.Bones[head.Bone].Name);
        Assert.Equal(PmxRigidBodyShape.Sphere, head.Shape);
        Assert.Equal(PmxRigidBodyMode.Static, head.Mode);
        Assert.Equal(0xFFFF, head.CollisionMask);
        var hair = m.RigidBodies[2];
        Assert.Equal("髪1", m.Bones[hair.Bone].Name);
        Assert.Equal(PmxRigidBodyShape.Capsule, hair.Shape);
        Assert.Equal(PmxRigidBodyMode.Dynamic, hair.Mode);
        Assert.Equal(1, hair.Group);
        Assert.Equal(0x0001, hair.CollisionMask);
        Assert.Equal(0.35f, hair.Size.X);
        Assert.Equal(0.5f, hair.LinearDamping);

        Assert.Equal(3, m.Joints.Length);
        var j = m.Joints[0];
        Assert.Equal(0, j.Type);
        Assert.Equal((0, 2), (j.RigidBodyA, j.RigidBodyB));
        Assert.Equal(new Vector3(0, 18.2f, 1.4f), j.Position);
        Assert.Equal(-40 * MathF.PI / 180, j.AngularLowerLimit.X, 5);
        Assert.Equal(new Vector3(20, 20, 20), j.SpringAngular);
    }

    [Fact]
    public void ReadsRigidBodiesAndJointsWithWideIndices()
    {
        var bytes = MinimalPmx(utf8: true, indexSize: 4, withPhysics: true);
        var m = PmxReader.Read(new MemoryStream(bytes));

        Assert.Equal(2, m.RigidBodies.Length);
        Assert.Equal("rb1", m.RigidBodies[1].Name);
        Assert.Equal(1, m.RigidBodies[1].Bone);
        Assert.Equal(PmxRigidBodyShape.Box, m.RigidBodies[1].Shape);
        Assert.Equal(PmxRigidBodyMode.DynamicBoneAligned, m.RigidBodies[1].Mode);
        Assert.Equal(new Vector3(0.1f, 0.2f, 0.3f), m.RigidBodies[1].Rotation);
        var j = m.Joints.Single();
        Assert.Equal((0, 1), (j.RigidBodyA, j.RigidBodyB));
        Assert.Equal(new Vector3(1, 2, 3), j.LinearUpperLimit);
        Assert.Equal(new Vector3(7, 8, 9), j.SpringAngular);
    }

    [Fact]
    public void ReadsUtf8WithWideIndicesAndAllWeightTypes()
    {
        var bytes = MinimalPmx(utf8: true, indexSize: 4);
        var m = PmxReader.Read(new MemoryStream(bytes));

        Assert.Equal("テスト", m.Name);
        Assert.Equal(5, m.Vertices.Length);
        Assert.Equal(PmxWeightType.Bdef1, m.Vertices[0].WeightType);
        Assert.Equal((1, 0, 0.25f, 0.75f), (m.Vertices[1].Bone0, m.Vertices[1].Bone1, m.Vertices[1].Weight0, m.Vertices[1].Weight1));
        Assert.Equal(PmxWeightType.Bdef4, m.Vertices[2].WeightType);
        Assert.Equal(PmxWeightType.Sdef, m.Vertices[3].WeightType);
        Assert.Equal(0.5f, m.Vertices[3].Weight1);
        Assert.Equal(PmxWeightType.Qdef, m.Vertices[4].WeightType);
        Assert.Equal([0, 1, 2], m.Indices);
        Assert.Equal(2, m.Bones.Length);
        Assert.Equal(0, m.Bones[1].Parent);
        Assert.Equal(PmxBoneFlags.AppendRotate, m.Bones[1].Flags & PmxBoneFlags.AppendRotate);
        Assert.Equal(0, m.Bones[1].AppendParent);
        Assert.Equal(0.5f, m.Bones[1].AppendRatio);
        Assert.Empty(m.Morphs);
    }

    [Fact]
    public void KeepsTheFirstAdditionalUv()
    {
        var m = PmxReader.Read(new MemoryStream(MinimalPmx(utf8: true, indexSize: 4, additionalUvs: 2)));

        Assert.Equal(2, m.AdditionalUvCount);
        Assert.Equal(new Vector4(3, 0.5f, 0, 1), m.Vertices[3].AdditionalUv1);
        Assert.Equal(PmxWeightType.Sdef, m.Vertices[3].WeightType);
    }

    [Fact]
    public void RejectsNonPmx()
    {
        Assert.Throws<InvalidDataException>(() => PmxReader.Read(new MemoryStream("Pmd\0\0\0\0\0"u8.ToArray())));
        Assert.Throws<InvalidDataException>(() => PmxReader.Read(new MemoryStream("hello world!"u8.ToArray())));
    }

    [Fact]
    public void RejectsTruncatedFile()
    {
        var bytes = File.ReadAllBytes(SamplePath);
        Assert.ThrowsAny<Exception>(() => PmxReader.Read(new MemoryStream(bytes[..(bytes.Length / 2)])));
    }

    /// <summary>Hand-built PMX with UTF-8 text and 4-byte indices.</summary>
    private static byte[] MinimalPmx(bool utf8, int indexSize, bool withPhysics = false, int additionalUvs = 0)
    {
        var enc = utf8 ? Encoding.UTF8 : Encoding.Unicode;
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        void Text(string s) { var b = enc.GetBytes(s); w.Write(b.Length); w.Write(b); }
        void Idx(int v)
        {
            switch (indexSize)
            {
                case 1: w.Write((sbyte)v); break;
                case 2: w.Write((short)v); break;
                default: w.Write(v); break;
            }
        }
        void V3(float x, float y, float z) { w.Write(x); w.Write(y); w.Write(z); }

        w.Write("PMX "u8.ToArray());
        w.Write(2.1f);
        w.Write((byte)8);
        w.Write(new byte[] { (byte)(utf8 ? 1 : 0), (byte)additionalUvs, (byte)indexSize, (byte)indexSize, (byte)indexSize, (byte)indexSize, (byte)indexSize, (byte)indexSize });
        Text("テスト"); Text("test"); Text(""); Text("");

        w.Write(5);
        for (int i = 0; i < 5; i++)
        {
            V3(i, 0, 0); V3(0, 0, -1); w.Write(0f); w.Write(0f);
            for (int k = 0; k < additionalUvs; k++) { w.Write(i + k * 10f); w.Write(0.5f); w.Write(0f); w.Write(1f); }
            switch (i)
            {
                case 0: w.Write((byte)0); Idx(0); break;
                case 1: w.Write((byte)1); Idx(1); Idx(0); w.Write(0.25f); break;
                case 2:
                case 4:
                    w.Write((byte)(i == 2 ? 2 : 4));
                    Idx(0); Idx(1); Idx(-1); Idx(-1);
                    w.Write(0.5f); w.Write(0.5f); w.Write(0f); w.Write(0f);
                    break;
                case 3: w.Write((byte)3); Idx(0); Idx(1); w.Write(0.5f); V3(0, 0, 0); V3(0, 0, 0); V3(0, 0, 0); break;
            }
            w.Write(1f);
        }
        w.Write(3);
        w.Write(0); w.Write(1); w.Write(2); // 4-byte vertex indices
        w.Write(0); // textures
        w.Write(1); // materials
        Text("mat"); Text("");
        w.Write(1f); w.Write(1f); w.Write(1f); w.Write(1f); V3(0, 0, 0); w.Write(1f); V3(0, 0, 0);
        w.Write((byte)0); w.Write(0f); w.Write(0f); w.Write(0f); w.Write(1f); w.Write(1f);
        Idx(-1); Idx(-1); w.Write((byte)0); w.Write((byte)0); Idx(-1); Text(""); w.Write(3);
        w.Write(2); // bones
        Text("root"); Text(""); V3(0, 0, 0); Idx(-1); w.Write(0); w.Write((ushort)0x001E); V3(0, 1, 0);
        Text("child"); Text(""); V3(0, 1, 0); Idx(0); w.Write(0); w.Write((ushort)(0x0002 | 0x0100 | 0x0001)); Idx(-1);
        Idx(0); w.Write(0.5f);
        w.Write(0); // morphs
        if (withPhysics)
        {
            w.Write(1); // display frames
            Text("frame"); Text(""); w.Write((byte)0); w.Write(2);
            w.Write((byte)0); Idx(1); // bone
            w.Write((byte)1); Idx(0); // morph
            w.Write(2); // rigid bodies
            for (int i = 0; i < 2; i++)
            {
                Text($"rb{i}"); Text(""); Idx(i); w.Write((byte)i); w.Write((ushort)0xFFFE); w.Write((byte)i);
                V3(1, 1, 1); V3(0, i, 0); V3(0.1f * i, 0.2f * i, 0.3f * i);
                w.Write(1f); w.Write(0.5f); w.Write(0.5f); w.Write(0f); w.Write(0.5f); w.Write((byte)(i == 0 ? 0 : 2));
            }
            w.Write(1); // joints
            Text("j"); Text(""); w.Write((byte)0); Idx(0); Idx(1); V3(0, 1, 0); V3(0, 0, 0);
            V3(-1, -2, -3); V3(1, 2, 3); V3(-0.5f, 0, 0); V3(0.5f, 0, 0); V3(4, 5, 6); V3(7, 8, 9);
        }
        return ms.ToArray();
    }
}
