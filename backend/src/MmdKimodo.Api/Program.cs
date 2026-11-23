using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.AspNetCore.StaticFiles;
using MmdKimodo.Api.Services;
using MmdKimodo.Core.Pmx;
using MmdKimodo.Core.Vmd;

const long MaxUploadBytes = 1024L * 1024 * 1024; // 1 GiB

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = MaxUploadBytes);
builder.Services.Configure<FormOptions>(o =>
{
    o.MultipartBodyLengthLimit = MaxUploadBytes;
    o.ValueCountLimit = 100_000;
});
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.Providers.Add<GzipCompressionProvider>();
    o.Providers.Add<BrotliCompressionProvider>();
});
builder.Services.Configure<BrotliCompressionProviderOptions>(o => o.Level = System.IO.Compression.CompressionLevel.Fastest);
builder.Services.Configure<GzipCompressionProviderOptions>(o => o.Level = System.IO.Compression.CompressionLevel.Fastest);
builder.Services.AddSingleton<UploadStore>();
builder.Services.AddHttpClient<KimodoClient>();
builder.Services.AddProblemDetails();

var app = builder.Build();

app.UseResponseCompression();
app.UseDefaultFiles();
app.UseStaticFiles();

var api = app.MapGroup("/api");

api.MapGet("/health", () => Results.Ok(new { status = "ok" }));

// Upload a model: one or more files (PMX + textures, or a .zip of the model folder).
// Optional form field "paths" (one per file, same order) carries folder-relative paths.
api.MapPost("/models", async (HttpRequest request, UploadStore store, CancellationToken ct) =>
{
    if (!request.HasFormContentType) return Results.BadRequest(new { error = "multipart/form-data expected" });
    var form = await request.ReadFormAsync(ct);
    var paths = form["paths"];
    var files = form.Files.Select((f, i) => (i < paths.Count && !string.IsNullOrEmpty(paths[i]) ? paths[i]! : f.FileName, f)).ToList();
    if (files.Count == 0) return Results.BadRequest(new { error = "no files" });

    UploadStore.Upload upload;
    try
    {
        upload = await store.CreateAsync(files, ct);
    }
    catch (InvalidDataException e)
    {
        return Results.BadRequest(new { error = e.Message });
    }
    return LoadModel(store, upload, form["pmx"].FirstOrDefault());
}).DisableAntiforgery();

// Re-load another PMX from an existing upload (when the folder contains several).
api.MapGet("/uploads/{id}/model", (string id, string? pmx, UploadStore store) =>
{
    var upload = store.Get(id);
    return upload is null ? Results.NotFound() : LoadModel(store, upload, pmx);
});

api.MapGet("/uploads/{id}/files/{**path}", (string id, string path, UploadStore store) =>
{
    var upload = store.Get(id);
    if (upload is null) return Results.NotFound();
    var full = store.GetFilePath(upload, Uri.UnescapeDataString(path));
    if (full is null) return Results.NotFound();
    var provider = new FileExtensionContentTypeProvider();
    provider.Mappings[".tga"] = "image/x-tga";
    provider.Mappings[".spa"] = "image/bmp";
    provider.Mappings[".sph"] = "image/bmp";
    provider.Mappings[".dds"] = "image/vnd-ms.dds";
    if (!provider.TryGetContentType(full, out var contentType)) contentType = "application/octet-stream";
    return Results.File(full, contentType);
});

// Parse a VMD motion. Stateless: the file is not kept.
api.MapPost("/motions", async (HttpRequest request, CancellationToken ct) =>
{
    if (!request.HasFormContentType) return Results.BadRequest(new { error = "multipart/form-data expected" });
    var form = await request.ReadFormAsync(ct);
    var file = form.Files.FirstOrDefault();
    if (file is null) return Results.BadRequest(new { error = "no file" });
    try
    {
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms, ct);
        ms.Position = 0;
        var motion = VmdReader.Read(ms);
        return Results.Ok(DtoMapper.ToDto(motion, file.FileName));
    }
    catch (Exception e) when (e is InvalidDataException or EndOfStreamException)
    {
        return Results.BadRequest(new { error = $"VMD parse error: {e.Message}" });
    }
}).DisableAntiforgery();

// Kimodo motion generation (text -> VMD for the loaded model).
api.MapGet("/kimodo/status", (KimodoClient kimodo, CancellationToken ct) => kimodo.GetStatusAsync(ct));

api.MapPost("/kimodo/generate", async (GenerateRequest req, UploadStore store, KimodoClient kimodo, CancellationToken ct) =>
{
    var invalid = KimodoClient.Validate(req.Prompt, req.Duration);
    if (invalid is not null) return Results.BadRequest(new { error = invalid });
    var upload = store.Get(req.UploadId);
    var pmxPath = upload is null ? null : store.GetFilePath(upload, req.PmxPath);
    if (pmxPath is null || !pmxPath.EndsWith(".pmx", StringComparison.OrdinalIgnoreCase))
        return Results.NotFound(new { error = "モデルが見つかりません。読み込み直してください" });

    try
    {
        var vmd = await kimodo.GenerateAsync(req.Prompt!, req.Duration, pmxPath, ct);
        using var ms = new MemoryStream(vmd);
        var motion = VmdReader.Read(ms);
        return Results.Ok(DtoMapper.ToDto(motion, "kimodo.vmd"));
    }
    catch (KimodoException e)
    {
        return Results.Json(new { error = e.Message }, statusCode: (int)e.Status);
    }
    catch (Exception e) when (e is InvalidDataException or EndOfStreamException)
    {
        return Results.Json(new { error = $"Kimodo の出力を読めません: {e.Message}" }, statusCode: StatusCodes.Status502BadGateway);
    }
});

// Unknown API routes are 404 (not the SPA page).
api.MapFallback(() => Results.NotFound(new { error = "not found" }));

// SPA fallback for the bundled frontend.
app.MapFallbackToFile("index.html");

app.Run();

static IResult LoadModel(UploadStore store, UploadStore.Upload upload, string? requestedPmx)
{
    var candidates = upload.PmxCandidates;
    if (candidates.Length == 0)
    {
        return Results.BadRequest(new { error = "No .pmx file found in the upload.", uploadId = upload.Id });
    }
    var pmx = requestedPmx is null
        ? candidates[0]
        : candidates.FirstOrDefault(c => c.Equals(UploadStore.SanitizeRelativePath(requestedPmx), StringComparison.OrdinalIgnoreCase));
    if (pmx is null) return Results.NotFound(new { error = $"PMX '{requestedPmx}' not found." });

    try
    {
        var model = PmxReader.Read(store.GetFilePath(upload, pmx)!);
        var dto = DtoMapper.ToDto(model, upload.Id, pmx, candidates, tex =>
        {
            var rel = store.ResolveTexture(upload, pmx, tex);
            return rel is null ? null : $"/api/uploads/{upload.Id}/files/{string.Join('/', rel.Split('/').Select(Uri.EscapeDataString))}";
        });
        return Results.Ok(dto);
    }
    catch (Exception e) when (e is InvalidDataException or EndOfStreamException)
    {
        return Results.BadRequest(new { error = $"PMX parse error: {e.Message}", uploadId = upload.Id });
    }
}

record GenerateRequest(string UploadId, string PmxPath, string? Prompt, double Duration);
