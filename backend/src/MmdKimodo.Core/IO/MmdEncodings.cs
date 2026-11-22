using System.Text;

namespace MmdKimodo.Core.IO;

public static class MmdEncodings
{
    /// <summary>Shift_JIS (code page 932), used by VMD and most Japanese zip archives.</summary>
    public static Encoding ShiftJis { get; } = Create();

    private static Encoding Create()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        return Encoding.GetEncoding(932);
    }
}
