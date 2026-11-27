using System.Numerics;
using System.Runtime.InteropServices;
using MmdKimodo.Api.Dtos;
using MmdKimodo.Core.Pmx;
using MmdKimodo.Core.Vmd;

namespace MmdKimodo.Api.Services;

public static class DtoMapper
{
    private static string B64<T>(ReadOnlySpan<T> values) where T : struct
        => Convert.ToBase64String(MemoryMarshal.AsBytes(values));

    private static float[] A(Vector2 v) => [v.X, v.Y];
    private static float[] A(Vector3 v) => [v.X, v.Y, v.Z];
    private static float[] A(Vector4 v) => [v.X, v.Y, v.Z, v.W];

    public static ModelDto ToDto(PmxModel m, string uploadId, string pmxPath, string[] candidates, Func<string, string?> resolveTexture)
    {
        int n = m.Vertices.Length;
        var pos = new float[n * 3];
        var nrm = new float[n * 3];
        var uv = new float[n * 2];
        var uv1 = m.AdditionalUvCount > 0 ? new float[n * 2] : null;
        var si = new ushort[n * 4];
        var sw = new float[n * 4];
        for (int i = 0; i < n; i++)
        {
            var v = m.Vertices[i];
            pos[i * 3] = v.Position.X; pos[i * 3 + 1] = v.Position.Y; pos[i * 3 + 2] = v.Position.Z;
            nrm[i * 3] = v.Normal.X; nrm[i * 3 + 1] = v.Normal.Y; nrm[i * 3 + 2] = v.Normal.Z;
            uv[i * 2] = v.Uv.X; uv[i * 2 + 1] = v.Uv.Y;
            if (uv1 != null) { uv1[i * 2] = v.AdditionalUv1.X; uv1[i * 2 + 1] = v.AdditionalUv1.Y; }
            Span<int> b = [v.Bone0, v.Bone1, v.Bone2, v.Bone3];
            Span<float> w = [v.Weight0, v.Weight1, v.Weight2, v.Weight3];
            float total = 0;
            for (int k = 0; k < 4; k++)
            {
                if (b[k] < 0 || b[k] >= m.Bones.Length) { b[k] = 0; w[k] = 0; }
                total += w[k];
            }
            for (int k = 0; k < 4; k++)
            {
                si[i * 4 + k] = (ushort)b[k];
                sw[i * 4 + k] = total > 0 ? w[k] / total : (k == 0 ? 1 : 0);
            }
        }
        var idx = new uint[m.Indices.Length];
        for (int i = 0; i < idx.Length; i++) idx[i] = (uint)m.Indices[i];

        var geometry = new GeometryDto(
            B64<float>(pos), B64<float>(nrm), B64<float>(uv), B64<ushort>(si), B64<float>(sw), B64<uint>(idx),
            uv1 != null ? B64<float>(uv1) : null);

        int start = 0;
        var materials = m.Materials.Select(mt =>
        {
            var dto = new MaterialDto(mt.Name, mt.NameEn, A(mt.Diffuse), A(mt.Specular), mt.Specularity, A(mt.Ambient),
                (int)mt.Flags, A(mt.EdgeColor), mt.EdgeSize, mt.TextureIndex, mt.SphereTextureIndex, mt.SphereMode,
                mt.SharedToon, mt.ToonIndex, start, mt.IndexCount);
            start += mt.IndexCount;
            return dto;
        }).ToArray();

        var textures = m.Textures.Select(t => new TextureDto(t, resolveTexture(t))).ToArray();

        var bones = m.Bones.Select(b => new BoneDto(
            b.Name, b.NameEn, A(b.Position), b.Parent, b.Layer, (int)b.Flags, b.TailBone, A(b.TailOffset),
            b.AppendParent, b.AppendRatio,
            b.Ik is null ? null : new IkDto(b.Ik.Target, b.Ik.LoopCount, b.Ik.LimitAngle,
                b.Ik.Links.Select(l => new IkLinkDto(l.Bone, l.HasLimit,
                    l.HasLimit ? A(l.Min) : null, l.HasLimit ? A(l.Max) : null)).ToArray()))).ToArray();

        var morphs = m.Morphs.Select(mo =>
        {
            string? vi = null, vo = null;
            GroupOffsetDto[]? group = null;
            if (mo.Type == PmxMorphType.Vertex)
            {
                var ids = new uint[mo.VertexOffsets.Length];
                var offs = new float[mo.VertexOffsets.Length * 3];
                for (int i = 0; i < ids.Length; i++)
                {
                    var o = mo.VertexOffsets[i];
                    ids[i] = (uint)o.Vertex;
                    offs[i * 3] = o.Offset.X; offs[i * 3 + 1] = o.Offset.Y; offs[i * 3 + 2] = o.Offset.Z;
                }
                vi = B64<uint>(ids);
                vo = B64<float>(offs);
            }
            else if (mo.Type == PmxMorphType.Group)
            {
                group = mo.GroupOffsets.Select(g => new GroupOffsetDto(g.Morph, g.Ratio)).ToArray();
            }
            MaterialMorphOffsetDto[]? material = null;
            if (mo.Type == PmxMorphType.Material)
            {
                material = mo.MaterialOffsets.Select(o => new MaterialMorphOffsetDto(
                    o.Material, (int)o.Op, A(o.Diffuse), A(o.Specular), o.Specularity, A(o.Ambient),
                    A(o.EdgeColor), o.EdgeSize, A(o.TextureFactor), A(o.SphereFactor), A(o.ToonFactor))).ToArray();
            }
            return new MorphDto(mo.Name, mo.NameEn, mo.Panel, (int)mo.Type, vi, vo, group, material);
        }).ToArray();

        var rigidBodies = m.RigidBodies.Select(rb => new RigidBodyDto(
            rb.Name, rb.NameEn, rb.Bone, rb.Group, rb.CollisionMask, (int)rb.Shape, A(rb.Size), A(rb.Position), A(rb.Rotation),
            rb.Mass, rb.LinearDamping, rb.AngularDamping, rb.Restitution, rb.Friction, (int)rb.Mode)).ToArray();

        var joints = m.Joints.Select(j => new JointDto(
            j.Name, j.NameEn, j.Type, j.RigidBodyA, j.RigidBodyB, A(j.Position), A(j.Rotation),
            A(j.LinearLowerLimit), A(j.LinearUpperLimit), A(j.AngularLowerLimit), A(j.AngularUpperLimit),
            A(j.SpringLinear), A(j.SpringAngular))).ToArray();

        return new ModelDto(uploadId, pmxPath, candidates, m.Name, m.NameEn, m.Comment, m.Version,
            n, m.Indices.Length / 3, geometry, materials, textures, bones, morphs, rigidBodies, joints);
    }

    public static MotionDto ToDto(VmdMotion v, string fileName)
    {
        var bones = v.BoneFrames
            .GroupBy(f => f.BoneName)
            .Select(g => new BoneTrackDto(g.Key, g
                .OrderBy(f => f.Frame)
                .DistinctBy(f => f.Frame)
                .Select(f => new BoneKeyDto((int)f.Frame, A(f.Position),
                    [f.Rotation.X, f.Rotation.Y, f.Rotation.Z, f.Rotation.W], CompactInterpolation(f.Interpolation)))
                .ToArray()))
            .ToArray();

        var morphs = v.MorphFrames
            .GroupBy(f => f.MorphName)
            .Select(g => new MorphTrackDto(g.Key, g
                .OrderBy(f => f.Frame)
                .DistinctBy(f => f.Frame)
                .Select(f => new MorphKeyDto((int)f.Frame, f.Weight))
                .ToArray()))
            .ToArray();

        var ik = v.IkFrames
            .OrderBy(f => f.Frame)
            .Select(f => new IkFrameDto((int)f.Frame, f.Visible,
                f.States.Select(s => new IkStateDto(s.BoneName, s.Enabled)).ToArray()))
            .ToArray();

        return new MotionDto(fileName, v.ModelName, v.MaxFrame, v.BoneFrames.Length, v.MorphFrames.Length, bones, morphs, ik);
    }

    /// <summary>
    /// The 64-byte VMD block stores, for channel c (X, Y, Z, R), the control
    /// points at bytes c, c+4, c+8, c+12 (x1, y1, x2, y2).
    /// </summary>
    public static int[] CompactInterpolation(byte[] raw)
    {
        var o = new int[16];
        for (int c = 0; c < 4; c++)
        {
            o[c * 4 + 0] = raw[c];
            o[c * 4 + 1] = raw[c + 4];
            o[c * 4 + 2] = raw[c + 8];
            o[c * 4 + 3] = raw[c + 12];
        }
        return o;
    }
}
