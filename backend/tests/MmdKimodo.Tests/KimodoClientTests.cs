using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using MmdKimodo.Api.Services;

namespace MmdKimodo.Tests;

public class KimodoClientTests
{
    private sealed class FakeHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string Body)> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            Requests.Add((request, body));
            return await respond(request);
        }
    }

    private static KimodoClient Client(FakeHandler handler, string? url = "http://kimodo:9560")
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Kimodo:Url"] = url })
            .Build();
        return new KimodoClient(new HttpClient(handler), config);
    }

    private static HttpResponseMessage Json(HttpStatusCode code, string json)
        => new(code) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private static string TempPmx()
    {
        var path = Path.GetTempFileName();
        File.WriteAllBytes(path, Encoding.ASCII.GetBytes("PMX fake"));
        return path;
    }

    [Theory]
    [InlineData("A person walks forward.", 6.0, true)]
    [InlineData("A person walks forward.", 2.0, true)]
    [InlineData("A person walks forward.", 10.0, true)]
    [InlineData("  ", 6.0, false)]
    [InlineData(null, 6.0, false)]
    [InlineData("x", 1.9, false)]
    [InlineData("x", 10.1, false)]
    [InlineData("x", double.NaN, false)]
    public void ValidatesPromptAndDuration(string? prompt, double duration, bool ok)
    {
        Assert.Equal(ok, KimodoClient.Validate(prompt, duration) is null);
    }

    [Fact]
    public void RejectsLongPrompt()
    {
        Assert.NotNull(KimodoClient.Validate(new string('a', KimodoClient.MaxPromptLength + 1), 6));
    }

    [Fact]
    public async Task StatusIsUnconfiguredWithoutUrl()
    {
        var handler = new FakeHandler(_ => throw new InvalidOperationException("must not be called"));
        var status = await Client(handler, url: "").GetStatusAsync(CancellationToken.None);
        Assert.Equal("unconfigured", status.Status);
        Assert.False(status.Ready);
    }

    [Fact]
    public async Task StatusReadsHealth()
    {
        var handler = new FakeHandler(_ => Task.FromResult(Json(HttpStatusCode.OK, """{"status":"ready","model":"kimodo-soma-rp","error":null}""")));
        var status = await Client(handler).GetStatusAsync(CancellationToken.None);
        Assert.True(status.Ready);
        Assert.Equal("kimodo-soma-rp", status.Model);
        Assert.Equal("http://kimodo:9560/health", handler.Requests.Single().Request.RequestUri!.ToString());
    }

    [Fact]
    public async Task StatusIsUnreachableWhenServerIsDown()
    {
        var handler = new FakeHandler(_ => throw new HttpRequestException("refused"));
        var status = await Client(handler).GetStatusAsync(CancellationToken.None);
        Assert.Equal("unreachable", status.Status);
    }

    [Fact]
    public async Task GenerateSendsPromptDurationAndPmx()
    {
        var vmd = Encoding.ASCII.GetBytes("Vocaloid Motion Data 0002");
        var handler = new FakeHandler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(vmd) }));
        var pmx = TempPmx();
        try
        {
            var result = await Client(handler).GenerateAsync(" A person waves. ", 4.5, pmx, CancellationToken.None);
            Assert.Equal(vmd, result);
            var (req, body) = handler.Requests.Single();
            Assert.Equal(HttpMethod.Post, req.Method);
            Assert.Equal("http://kimodo:9560/generate", req.RequestUri!.ToString());
            Assert.Contains("name=prompt", body);
            Assert.Contains("A person waves.", body);
            Assert.DoesNotContain(" A person waves. ", body);
            Assert.Contains("4.5", body);
            Assert.Contains("PMX fake", body);
        }
        finally
        {
            File.Delete(pmx);
        }
    }

    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable, """{"detail":"Kimodo model is still loading"}""", HttpStatusCode.ServiceUnavailable, "読み込み中")]
    [InlineData(HttpStatusCode.BadRequest, """{"detail":"PMX parse error: bad magic"}""", HttpStatusCode.BadRequest, "PMX parse error")]
    [InlineData(HttpStatusCode.InternalServerError, "oops", HttpStatusCode.BadGateway, "oops")]
    public async Task GenerateMapsServerErrors(HttpStatusCode upstream, string body, HttpStatusCode expected, string message)
    {
        var handler = new FakeHandler(_ => Task.FromResult(Json(upstream, body)));
        var pmx = TempPmx();
        try
        {
            var e = await Assert.ThrowsAsync<KimodoException>(() => Client(handler).GenerateAsync("x", 6, pmx, CancellationToken.None));
            Assert.Equal(expected, e.Status);
            Assert.Contains(message, e.Message);
        }
        finally
        {
            File.Delete(pmx);
        }
    }

    [Fact]
    public async Task GenerateFailsWhenServerIsDown()
    {
        var handler = new FakeHandler(_ => throw new HttpRequestException("refused"));
        var pmx = TempPmx();
        try
        {
            var e = await Assert.ThrowsAsync<KimodoException>(() => Client(handler).GenerateAsync("x", 6, pmx, CancellationToken.None));
            Assert.Equal(HttpStatusCode.BadGateway, e.Status);
        }
        finally
        {
            File.Delete(pmx);
        }
    }
}
