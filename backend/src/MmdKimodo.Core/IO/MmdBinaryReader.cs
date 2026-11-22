using System.Numerics;
using System.Text;

namespace MmdKimodo.Core.IO;

/// <summary>Little-endian reader with the helpers PMX / VMD need.</summary>
internal sealed class MmdBinaryReader
{
    private readonly BinaryReader _r;

    public MmdBinaryReader(Stream stream)
    {
        _r = new BinaryReader(stream, Encoding.UTF8, leaveOpen: true);
    }

    public Stream BaseStream => _r.BaseStream;

    public bool AtEnd => _r.BaseStream.Position >= _r.BaseStream.Length;

    public byte ReadByte() => _r.ReadByte();
    public sbyte ReadSByte() => _r.ReadSByte();
    public ushort ReadUInt16() => _r.ReadUInt16();
    public short ReadInt16() => _r.ReadInt16();
    public int ReadInt32() => _r.ReadInt32();
    public uint ReadUInt32() => _r.ReadUInt32();
    public float ReadSingle() => _r.ReadSingle();

    public byte[] ReadBytes(int count)
    {
        var bytes = _r.ReadBytes(count);
        if (bytes.Length != count)
        {
            throw new InvalidDataException("Unexpected end of file.");
        }
        return bytes;
    }

    public Vector2 ReadVector2() => new(ReadSingle(), ReadSingle());
    public Vector3 ReadVector3() => new(ReadSingle(), ReadSingle(), ReadSingle());
    public Vector4 ReadVector4() => new(ReadSingle(), ReadSingle(), ReadSingle(), ReadSingle());

    /// <summary>Signed index of 1, 2 or 4 bytes (-1 = none).</summary>
    public int ReadIndex(int size) => size switch
    {
        1 => ReadSByte(),
        2 => ReadInt16(),
        4 => ReadInt32(),
        _ => throw new InvalidDataException($"Invalid index size {size}."),
    };

    /// <summary>Vertex indices are unsigned for 1 and 2 byte sizes.</summary>
    public int ReadVertexIndex(int size) => size switch
    {
        1 => ReadByte(),
        2 => ReadUInt16(),
        4 => ReadInt32(),
        _ => throw new InvalidDataException($"Invalid vertex index size {size}."),
    };

    /// <summary>PMX text: int32 byte length followed by encoded bytes.</summary>
    public string ReadPmxText(Encoding encoding)
    {
        int length = ReadInt32();
        if (length < 0 || length > BaseStream.Length - BaseStream.Position)
        {
            throw new InvalidDataException($"Invalid text length {length}.");
        }
        return length == 0 ? string.Empty : encoding.GetString(ReadBytes(length));
    }

    /// <summary>Fixed-size, NUL-terminated Shift_JIS string (VMD).</summary>
    public string ReadFixedShiftJis(int size)
    {
        var bytes = ReadBytes(size);
        int end = Array.IndexOf(bytes, (byte)0);
        if (end < 0) end = size;
        // Names are cut at a fixed byte size, possibly inside a double-byte character: drop it.
        for (int i = 0; i < end; i++)
        {
            byte b = bytes[i];
            bool lead = (b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC);
            if (!lead) continue;
            if (i + 1 >= end)
            {
                end = i;
                break;
            }
            i++;
        }
        return MmdEncodings.ShiftJis.GetString(bytes, 0, end);
    }
}
