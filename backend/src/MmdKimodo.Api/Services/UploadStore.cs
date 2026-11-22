using System.Collections.Concurrent;
using System.IO.Compression;
using MmdKimodo.Core.IO;

namespace MmdKimodo.Api.Services;

/// <summary>
/// Keeps uploaded model folders (PMX + textures) on disk so the viewer can
/// fetch textures by URL. Only the most recent uploads are kept.
/// </summary>
public sealed class UploadStore
{
    private const long MaxExtractedBytes = 2L * 1024 * 1024 * 1024;
    private readonly string _root;
    private readonly int _maxUploads;
    private readonly ConcurrentDictionary<string, Upload> _uploads = new();
    private readonly ILogger<UploadStore> _log;

    public UploadStore(IConfiguration config, ILogger<UploadStore> log)
    {
        _log = log;
        _root = config["Storage:Root"] is { Length: > 0 } r ? r : Path.Combine(Path.GetTempPath(), "mmd-kimodo-uploads");
        _maxUploads = config.GetValue("Storage:MaxUploads", 8);
        Directory.CreateDirectory(_root);
    }

    public sealed class Upload
    {
        public required string Id { get; init; }
        public required string Dir { get; init; }
        public DateTime Created { get; } = DateTime.UtcNow;
        /// <summary>lower-case normalized relative path -> actual relative path ('/' separated).</summary>
        public Dictionary<string, string> Files { get; } = new();

        public string[] PmxCandidates => Files.Values
            .Where(p => p.EndsWith(".pmx", StringComparison.OrdinalIgnoreCase))
            .OrderBy(p => p.Count(c => c == '/'))
            .ThenBy(p => p, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public Upload? Get(string id) => _uploads.TryGetValue(id, out var u) ? u : null;

    public async Task<Upload> CreateAsync(IReadOnlyList<(string RelativePath, IFormFile File)> files, CancellationToken ct)
    {
        var id = Guid.NewGuid().ToString("N");
        var dir = Path.Combine(_root, id);
        Directory.CreateDirectory(dir);
        var upload = new Upload { Id = id, Dir = dir };
        try
        {
            foreach (var (rel, file) in files)
            {
                var safe = SanitizeRelativePath(rel) ?? SanitizeRelativePath(file.FileName)
                    ?? throw new InvalidDataException($"Invalid file path '{rel}'.");
                if (safe.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                {
                    await using var s = file.OpenReadStream();
                    ExtractZip(s, dir);
                }
                else
                {
                    var full = Path.Combine(dir, safe.Replace('/', Path.DirectorySeparatorChar));
                    Directory.CreateDirectory(Path.GetDirectoryName(full)!);
                    await using var outStream = File.Create(full);
                    await file.CopyToAsync(outStream, ct);
                }
            }
            IndexFiles(upload);
        }
        catch
        {
            TryDelete(dir);
            throw;
        }

        _uploads[id] = upload;
        Evict();
        return upload;
    }

    private static void ExtractZip(Stream s, string dir)
    {
        // Japanese MMD archives usually store names in Shift_JIS without the UTF-8 flag.
        using var zip = new ZipArchive(s, ZipArchiveMode.Read, leaveOpen: false, entryNameEncoding: MmdEncodings.ShiftJis);
        long total = 0;
        foreach (var entry in zip.Entries)
        {
            if (string.IsNullOrEmpty(entry.Name)) continue; // directory
            var safe = SanitizeRelativePath(entry.FullName);
            if (safe is null) continue;
            total += entry.Length;
            if (total > MaxExtractedBytes) throw new InvalidDataException("Archive is too large.");
            var full = Path.Combine(dir, safe.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            entry.ExtractToFile(full, overwrite: true);
        }
    }

    private static void IndexFiles(Upload upload)
    {
        foreach (var full in Directory.EnumerateFiles(upload.Dir, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(upload.Dir, full).Replace(Path.DirectorySeparatorChar, '/');
            upload.Files[rel.ToLowerInvariant()] = rel;
        }
    }

    /// <summary>Returns a '/'-separated relative path, or null if it escapes the root.</summary>
    public static string? SanitizeRelativePath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        var parts = new List<string>();
        foreach (var raw in path.Replace('\\', '/').Split('/'))
        {
            var p = raw.Trim();
            if (p.Length == 0 || p == ".") continue;
            if (p == "..")
            {
                if (parts.Count == 0) return null;
                parts.RemoveAt(parts.Count - 1);
                continue;
            }
            if (p.Contains(':') || p.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) return null;
            parts.Add(p);
        }
        return parts.Count == 0 ? null : string.Join('/', parts);
    }

    /// <summary>Full path of an uploaded file (case-insensitive lookup), or null.</summary>
    public string? GetFilePath(Upload upload, string relativePath)
    {
        var safe = SanitizeRelativePath(relativePath);
        if (safe is null || !upload.Files.TryGetValue(safe.ToLowerInvariant(), out var actual)) return null;
        var full = Path.GetFullPath(Path.Combine(upload.Dir, actual));
        return full.StartsWith(Path.GetFullPath(upload.Dir), StringComparison.Ordinal) ? full : null;
    }

    /// <summary>
    /// Resolves a texture path written in the PMX (relative to the PMX file,
    /// backslash separated, case-insensitive) to an uploaded file.
    /// Falls back to a unique file-name match anywhere in the upload.
    /// </summary>
    public string? ResolveTexture(Upload upload, string pmxRelativePath, string texturePath)
    {
        var pmxDir = pmxRelativePath.Contains('/') ? pmxRelativePath[..pmxRelativePath.LastIndexOf('/')] : "";
        var combined = SanitizeRelativePath(pmxDir.Length > 0 ? pmxDir + "/" + texturePath : texturePath);
        if (combined is not null && upload.Files.TryGetValue(combined.ToLowerInvariant(), out var hit)) return hit;

        var fileName = SanitizeRelativePath(texturePath)?.Split('/').Last();
        if (fileName is null) return null;
        var matches = upload.Files.Values
            .Where(p => p.Split('/').Last().Equals(fileName, StringComparison.OrdinalIgnoreCase))
            .Take(2).ToArray();
        return matches.Length == 1 ? matches[0] : null;
    }

    private void Evict()
    {
        foreach (var old in _uploads.Values.OrderByDescending(u => u.Created).Skip(_maxUploads).ToArray())
        {
            if (_uploads.TryRemove(old.Id, out _)) TryDelete(old.Dir);
        }
    }

    private void TryDelete(string dir)
    {
        try { Directory.Delete(dir, recursive: true); }
        catch (Exception e) { _log.LogWarning(e, "Failed to delete {Dir}", dir); }
    }
}
