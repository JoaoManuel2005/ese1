using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using RagBackend.Controllers;
using RagBackend.Services;
using Xunit;

namespace RagBackend.Tests;

public class HealthControllerTests
{
    [Fact]
    public void Get_Returns_Ok_With_Status_Healthy()
    {
        var config = new ConfigurationBuilder().Build();
        var pac = new PacParserService(new NullLogger<PacParserService>(), config);

        var controller = new HealthController(pac);
        var result = controller.Get();

        var ok = Assert.IsType<OkObjectResult>(result);
        var obj = Assert.IsAssignableFrom<object>(ok.Value);
        var dict = new Dictionary<string, object?>();
        foreach (var prop in obj.GetType().GetProperties())
            dict[prop.Name] = prop.GetValue(obj);
        Assert.True(dict.ContainsKey("status"));
        Assert.Equal("healthy", dict["status"]?.ToString());
        Assert.True(dict.ContainsKey("pac_cli_available"));
    }

    [Fact]
    public void Get_Returns_Object_With_PacCliAvailable_Boolean()
    {
        var config = new ConfigurationBuilder().Build();
        var pac = new PacParserService(new NullLogger<PacParserService>(), config);

        var controller = new HealthController(pac);
        var result = controller.Get();

        var ok = Assert.IsType<OkObjectResult>(result);
        var obj = ok.Value;
        var pacProp = obj?.GetType().GetProperty("pac_cli_available");
        Assert.NotNull(pacProp);
        Assert.IsType<bool>(pacProp.GetValue(obj));
    }
}
