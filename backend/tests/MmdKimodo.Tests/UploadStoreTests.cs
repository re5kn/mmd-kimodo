using MmdKimodo.Api.Services;

namespace MmdKimodo.Tests;

public class UploadStoreTests
{
    [Theory]
    [InlineData("a/b/c.png", "a/b/c.png")]
    [InlineData("a\\b\\c.png", "a/b/c.png")]
    [InlineData("./a//b/../c.png", "a/c.png")]
    [InlineData("../x.png", null)]
    [InlineData("a/../../x.png", null)]
    [InlineData("C:/x.png", null)]
    [InlineData("", null)]
    public void SanitizesPaths(string input, string? expected)
    {
        Assert.Equal(expected, UploadStore.SanitizeRelativePath(input));
    }
}
