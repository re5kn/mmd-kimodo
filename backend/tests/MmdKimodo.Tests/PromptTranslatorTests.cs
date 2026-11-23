using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using MmdKimodo.Api.Services;

namespace MmdKimodo.Tests;

public class PromptTranslatorTests
{
    private static PromptTranslator Make(Dictionary<string, string?> values) =>
        new(new ConfigurationBuilder().AddInMemoryCollection(values).Build(), NullLogger<PromptTranslator>.Instance);

    [Fact]
    public void UnavailableWithoutKey()
    {
        var t = Make(new() { ["ANTHROPIC_API_KEY"] = "" });
        Assert.False(t.Available);
        Assert.Equal(PromptTranslator.DefaultModel, t.Model);
    }

    [Fact]
    public async Task TranslateWithoutKeyFailsClearly()
    {
        var e = await Assert.ThrowsAsync<KimodoException>(() => Make(new()).TranslateAsync("歩く", CancellationToken.None));
        Assert.Equal(System.Net.HttpStatusCode.ServiceUnavailable, e.Status);
    }

    [Fact]
    public void AvailableWithKeyAndModelOverride()
    {
        var t = Make(new() { ["ANTHROPIC_API_KEY"] = "sk-test", ["Translation:Model"] = "claude-haiku-5-5" });
        Assert.True(t.Available);
        Assert.Equal("claude-haiku-5-5", t.Model);
    }

    [Theory]
    [InlineData("", false)]
    [InlineData("  ", false)]
    [InlineData(null, false)]
    [InlineData("右手を振りながら前に歩く", true)]
    public void Validates(string? text, bool ok) => Assert.Equal(ok, PromptTranslator.Validate(text) is null);

    [Theory]
    [InlineData("A person walks forward.", "A person walks forward.")]
    [InlineData("\"A person waves.\"\n", "A person waves.")]
    [InlineData("A person walks.\nThen turns left.", "A person walks. Then turns left.")]
    public void CleansOutput(string raw, string expected) => Assert.Equal(expected, PromptTranslator.Clean(raw));
}
