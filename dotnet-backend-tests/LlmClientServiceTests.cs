using Microsoft.Extensions.Configuration;
using Moq;
using RagBackend.Services;
using System.Net.Http;
using Xunit;

namespace RagBackend.Tests;

public class LlmClientServiceTests
{
    private static LlmClientService CreateService(Dictionary<string, string?>? config = null)
    {
        var dict = config ?? new Dictionary<string, string?>();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(dict).Build();
        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient(It.IsAny<string>())).Returns(new HttpClient());
        return new LlmClientService(configuration, factory.Object);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("your_openai_api_key_here")]
    [InlineData("sk-xxx")]
    [InlineData("your-api-key")]
    public void IsValidApiKey_Returns_False_For_Invalid_Keys(string? key)
    {
        var svc = CreateService();
        Assert.False(svc.IsValidApiKey(key));
    }

    [Theory]
    [InlineData("sk-real-key-123")]
    [InlineData("valid-key")]
    public void IsValidApiKey_Returns_True_For_Valid_Keys(string key)
    {
        var svc = CreateService();
        Assert.True(svc.IsValidApiKey(key));
    }

    [Fact]
    public void ResolveProvider_Returns_Local_When_Config_Is_Local()
    {
        var svc = CreateService(new Dictionary<string, string?> { ["LLM_PROVIDER"] = "local" });
        Assert.Equal("local", svc.ResolveProvider(null));
    }

    [Fact]
    public void ResolveProvider_Returns_Cloud_When_Config_Is_Cloud()
    {
        var svc = CreateService(new Dictionary<string, string?> { ["LLM_PROVIDER"] = "cloud" });
        Assert.Equal("cloud", svc.ResolveProvider(null));
    }

    [Fact]
    public void ResolveProvider_Override_Takes_Precedence()
    {
        var svc = CreateService(new Dictionary<string, string?> { ["LLM_PROVIDER"] = "cloud" });
        Assert.Equal("local", svc.ResolveProvider("local"));
    }

    [Fact]
    public void ResolveProvider_Defaults_To_Cloud_When_Not_Set()
    {
        var svc = CreateService();
        Assert.Equal("cloud", svc.ResolveProvider(null));
    }

    [Fact]
    public void ResolveModel_Local_Returns_Config_Or_Default()
    {
        var svc = CreateService(new Dictionary<string, string?> { ["LOCAL_LLM_MODEL"] = "llama3.2:1b" });
        Assert.Equal("llama3.2:1b", svc.ResolveModel("local", null));
    }

    [Fact]
    public void ResolveModel_Local_Override_Takes_Precedence()
    {
        var svc = CreateService(new Dictionary<string, string?> { ["LOCAL_LLM_MODEL"] = "llama3" });
        Assert.Equal("custom", svc.ResolveModel("local", "custom"));
    }

    [Fact]
    public void ResolveModel_Cloud_Returns_DefaultModel_First_Then_OpenAIModel()
    {
        var svc = CreateService(new Dictionary<string, string?> { ["DEFAULT_MODEL"] = "gpt-4" });
        Assert.Equal("gpt-4", svc.ResolveModel("cloud", null));
    }

    [Fact]
    public void ResolveModel_Cloud_Returns_OpenAI_Model_When_OpenAIModel_Set()
    {
        var svc = CreateService(new Dictionary<string, string?>
        {
            ["OPENAI_MODEL"] = "gpt-4o"
        });
        Assert.Equal("gpt-4o", svc.ResolveModel("cloud", null));
    }

    [Fact]
    public void ResolveModel_Cloud_Override_Takes_Precedence()
    {
        var svc = CreateService(new Dictionary<string, string?> { ["DEFAULT_MODEL"] = "gpt-4" });
        Assert.Equal("gpt-4-turbo", svc.ResolveModel("cloud", "gpt-4-turbo"));
    }

    [Fact]
    public void ResolveModel_Cloud_Defaults_To_Gpt4()
    {
        var svc = CreateService();
        Assert.Equal("gpt-4", svc.ResolveModel("cloud", null));
    }
}
