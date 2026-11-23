using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MmdKimodo.Api.Services;

/// <summary>
/// Talks to the Kimodo generation server (re5kn/kimodopmx, kimodo.scripts.run_generation_server).
/// It takes a prompt, a duration and the PMX file, and returns a VMD retargeted to that model.
/// Configure the server with <c>Kimodo:Url</c> (environment variable <c>Kimodo__Url</c>).
/// </summary>
public sealed class KimodoClient
{
    public const double MinDuration = 2.0;
    public const double MaxDuration = 10.0;
    public const int MaxPromptLength = 1000;

    private readonly HttpClient _http;

    public KimodoClient(HttpClient http, IConfiguration config)
    {
        _http = http;
        var url = config["Kimodo:Url"];
        if (!string.IsNullOrWhiteSpace(url))
        {
            _http.BaseAddress = new Uri(url.EndsWith('/') ? url : url + "/");
        }
        // Generation can take a while (model warm-up, 100 diffusion steps).
        var timeout = double.TryParse(config["Kimodo:TimeoutSeconds"], CultureInfo.InvariantCulture, out var s) ? s : 600;
        _http.Timeout = TimeSpan.FromSeconds(timeout);
    }

    public bool Configured => _http.BaseAddress is not null;

    /// <summary>Returns null when the request is valid, otherwise the reason.</summary>
    public static string? Validate(string? prompt, double duration)
    {
        if (string.IsNullOrWhiteSpace(prompt)) return "プロンプトを入力してください";
        if (prompt.Trim().Length > MaxPromptLength) return $"プロンプトは {MaxPromptLength} 文字以内にしてください";
        if (double.IsNaN(duration) || duration < MinDuration || duration > MaxDuration)
            return $"長さは {MinDuration}〜{MaxDuration} 秒で指定してください";
        return null;
    }

    public async Task<KimodoStatus> GetStatusAsync(CancellationToken ct)
    {
        if (!Configured) return new KimodoStatus("unconfigured", null, "Kimodo のURL（Kimodo__Url）が設定されていません");
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(5));
            using var res = await _http.GetAsync("health", cts.Token);
            if (!res.IsSuccessStatusCode) return new KimodoStatus("unreachable", null, $"health: {(int)res.StatusCode}");
            var body = await res.Content.ReadFromJsonAsync<HealthBody>(cts.Token);
            return new KimodoStatus(body?.Status ?? "unknown", body?.Model, body?.Error);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException)
        {
            if (ct.IsCancellationRequested) throw;
            return new KimodoStatus("unreachable", null, $"Kimodo サーバーに接続できません（{_http.BaseAddress}）");
        }
    }

    /// <summary>Generates a motion and returns the VMD bytes. Throws <see cref="KimodoException"/> on failure.</summary>
    public async Task<byte[]> GenerateAsync(string prompt, double duration, string pmxFilePath, CancellationToken ct)
    {
        if (!Configured) throw new KimodoException(HttpStatusCode.ServiceUnavailable, "Kimodo のURL（Kimodo__Url）が設定されていません");

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(prompt.Trim()), "prompt");
        form.Add(new StringContent(duration.ToString("0.###", CultureInfo.InvariantCulture)), "duration");
        var pmx = new StreamContent(File.OpenRead(pmxFilePath));
        pmx.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(pmx, "pmx", "model.pmx");

        HttpResponseMessage res;
        try
        {
            res = await _http.PostAsync("generate", form, ct);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new KimodoException(HttpStatusCode.GatewayTimeout, "Kimodo の生成がタイムアウトしました");
        }
        catch (HttpRequestException)
        {
            throw new KimodoException(HttpStatusCode.BadGateway, $"Kimodo サーバーに接続できません（{_http.BaseAddress}）");
        }

        using (res)
        {
            if (res.IsSuccessStatusCode) return await res.Content.ReadAsByteArrayAsync(ct);
            var detail = await ReadErrorAsync(res, ct);
            var status = res.StatusCode switch
            {
                HttpStatusCode.ServiceUnavailable => HttpStatusCode.ServiceUnavailable,
                HttpStatusCode.BadRequest or HttpStatusCode.UnprocessableEntity => HttpStatusCode.BadRequest,
                _ => HttpStatusCode.BadGateway,
            };
            var message = res.StatusCode == HttpStatusCode.ServiceUnavailable && detail.Contains("loading", StringComparison.OrdinalIgnoreCase)
                ? "Kimodo のモデルを読み込み中です。しばらくしてからもう一度お試しください"
                : $"Kimodo: {detail}";
            throw new KimodoException(status, message);
        }
    }

    private static async Task<string> ReadErrorAsync(HttpResponseMessage res, CancellationToken ct)
    {
        var text = await res.Content.ReadAsStringAsync(ct);
        try
        {
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.TryGetProperty("detail", out var d))
                return d.ValueKind == JsonValueKind.String ? d.GetString()! : d.ToString();
        }
        catch (JsonException)
        {
            /* not JSON */
        }
        return string.IsNullOrWhiteSpace(text) ? $"{(int)res.StatusCode} {res.ReasonPhrase}" : text;
    }

    private sealed record HealthBody(
        [property: JsonPropertyName("status")] string? Status,
        [property: JsonPropertyName("model")] string? Model,
        [property: JsonPropertyName("error")] string? Error);
}

/// <summary>status: unconfigured | unreachable | loading | ready | error.</summary>
public sealed record KimodoStatus(string Status, string? Model, string? Error)
{
    /// <summary>Whether Japanese prompts can be translated (Claude API key configured).</summary>
    public bool Translation { get; init; }
    public bool Ready => Status == "ready";
    public double MinDuration => KimodoClient.MinDuration;
    public double MaxDuration => KimodoClient.MaxDuration;
}

public sealed class KimodoException(HttpStatusCode status, string message) : Exception(message)
{
    public HttpStatusCode Status { get; } = status;
}
