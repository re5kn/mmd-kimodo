using Anthropic;
using Anthropic.Models.Beta.Messages;

namespace MmdKimodo.Api.Services;

/// <summary>
/// Turns a Japanese motion description into an English Kimodo prompt with the Claude API.
/// Needs ANTHROPIC_API_KEY; the model comes from Translation:Model (default claude-opus-5-5).
/// </summary>
public sealed class PromptTranslator
{
    public const string DefaultModel = "claude-opus-5-5";
    public const int MaxInputLength = 1000;

    internal const string SystemPrompt = """
        You write prompts for Kimodo, a text-to-motion model that animates a single human body.
        Turn the user's Japanese description of a motion into one English prompt for it.

        - Describe only what the body does, in plain present tense, starting with "A person".
        - Keep every action, direction (left/right/forward/backward), body part, speed and order the user gave. Add nothing they did not ask for.
        - One or two short sentences. No props, places, emotions or camera unless they change the movement.
        - If the text is already English, tidy it into this form.
        - Reply with the prompt only: no quotes, no notes, no Japanese.
        """;

    private readonly AnthropicClient? _client;
    private readonly string _model;
    private readonly ILogger<PromptTranslator> _log;

    public PromptTranslator(IConfiguration config, ILogger<PromptTranslator> log)
    {
        _log = log;
        _model = string.IsNullOrWhiteSpace(config["Translation:Model"]) ? DefaultModel : config["Translation:Model"]!;
        var key = config["ANTHROPIC_API_KEY"];
        if (!string.IsNullOrWhiteSpace(key)) _client = new AnthropicClient { ApiKey = key };
    }

    public bool Available => _client is not null;
    public string Model => _model;

    public static string? Validate(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return "翻訳する文章を入力してください";
        if (text.Trim().Length > MaxInputLength) return $"{MaxInputLength} 文字以内にしてください";
        return null;
    }

    /// <summary>Returns the English prompt. Throws <see cref="KimodoException"/> on failure.</summary>
    public async Task<string> TranslateAsync(string text, CancellationToken ct)
    {
        if (_client is null)
            throw new KimodoException(System.Net.HttpStatusCode.ServiceUnavailable, "翻訳には ANTHROPIC_API_KEY の設定が必要です");

        var parameters = new MessageCreateParams
        {
            Model = _model,
            MaxTokens = 4096,
            System = SystemPrompt,
            OutputConfig = new BetaOutputConfig { Effort = Effort.Low },
            Messages = [new BetaUserMessageParam { Content = text.Trim() }],
        };
        // Server-side refusal fallback (not offered for Haiku models).
        if (!_model.Contains("haiku", StringComparison.OrdinalIgnoreCase))
        {
            parameters = parameters with
            {
                Betas = ["server-side-fallback-2026-07-01"],
                Fallbacks = new Default(),
            };
        }

        BetaMessage response;
        try
        {
            response = await _client.Beta.Messages.Create(parameters, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            _log.LogWarning(e, "Claude API translation failed");
            throw new KimodoException(System.Net.HttpStatusCode.BadGateway, $"翻訳に失敗しました: {e.Message}");
        }

        if (response.StopReason == "refusal")
            throw new KimodoException(System.Net.HttpStatusCode.BadRequest, "この文章は翻訳できませんでした。言い回しを変えてお試しください");

        var english = string.Concat(response.Content.Select(b => b.TryPickText(out var t) ? t.Text : ""));
        english = Clean(english);
        if (english.Length == 0)
            throw new KimodoException(System.Net.HttpStatusCode.BadGateway, "翻訳結果が空でした");
        return english;
    }

    /// <summary>Single line, no surrounding quotes.</summary>
    public static string Clean(string s)
    {
        s = string.Join(' ', s.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        return s.Trim().Trim('"', '“', '”', '\'', '`').Trim();
    }
}
