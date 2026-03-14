using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using RagBackend.Controllers;
using RagBackend.Services;
using System.IO.Compression;
using System.Text;
using Xunit;

namespace RagBackend.Tests;

public class UploadValidationControllerTests
{
    private static IConfiguration CreateConfig(Dictionary<string, string?>? values = null)
    {
        return new ConfigurationBuilder()
            .AddInMemoryCollection(values ?? new Dictionary<string, string?>())
            .Build();
    }

    private static PacParserService CreatePacParser()
    {
        var config = CreateConfig(new Dictionary<string, string?>
        {
            ["PAC_USE_CSHARP_MIRROR"] = "true",
            ["PAC_USE_PYTHON_PARITY"] = "false",
            ["FEATURE_SHAREPOINT_ENRICHMENT"] = "false",
        });
        return new PacParserService(new NullLogger<PacParserService>(), config);
    }

    private static SharePointService CreateSharePointService()
    {
        var config = CreateConfig(new Dictionary<string, string?>
        {
            ["FEATURE_SHAREPOINT_ENRICHMENT"] = "false",
        });
        return new SharePointService(new NullLogger<SharePointService>(), config);
    }

    private static IFormFile CreateFormFile(byte[] content, string fileName, string contentType = "application/octet-stream")
    {
        var stream = new MemoryStream(content);
        return new FormFile(stream, 0, content.Length, "file", fileName)
        {
            Headers = new HeaderDictionary(),
            ContentType = contentType
        };
    }

    private static byte[] CreateValidSolutionZipBytes()
    {
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            var entry = zip.CreateEntry("solution.xml");
            using var writer = new StreamWriter(entry.Open(), Encoding.UTF8);
            writer.Write("""
<?xml version="1.0" encoding="utf-8"?>
<ImportExportXml>
  <SolutionManifest>
    <UniqueName>Reply</UniqueName>
    <Version>1.0.0.0</Version>
    <Publisher>
      <UniqueName>Contoso</UniqueName>
    </Publisher>
  </SolutionManifest>
</ImportExportXml>
""");
        }

        return stream.ToArray();
    }

    private static Dictionary<string, object?> ToDictionary(object value)
    {
        var dict = new Dictionary<string, object?>();
        foreach (var prop in value.GetType().GetProperties())
        {
            dict[prop.Name] = prop.GetValue(value);
        }

        return dict;
    }

    [Fact]
    public async Task SolutionController_ParseSolution_Accepts_Valid_Zip_Upload()
    {
        var controller = new SolutionController(
            CreatePacParser(),
            null!,
            null!,
            null!,
            CreateSharePointService());

        var file = CreateFormFile(CreateValidSolutionZipBytes(), "solution.zip", "application/zip");

        var result = await controller.ParseSolution(file);

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = ToDictionary(Assert.IsAssignableFrom<object>(ok.Value!));

        Assert.True(payload.ContainsKey("Data"));
        Assert.Equal(200, ok.StatusCode ?? 200);
    }

    [Fact]
    public async Task SolutionController_ParseSolution_Rejects_NonZip_Upload()
    {
        var controller = new SolutionController(
            CreatePacParser(),
            null!,
            null!,
            null!,
            CreateSharePointService());

        var file = CreateFormFile(Encoding.UTF8.GetBytes("hello"), "notes.txt", "text/plain");

        var result = await controller.ParseSolution(file);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        var payload = ToDictionary(Assert.IsAssignableFrom<object>(badRequest.Value!));
        var error = Assert.IsType<Dictionary<string, string?>>(payload["error"]);

        Assert.Equal(400, badRequest.StatusCode ?? 400);
        Assert.Equal("INVALID_SOLUTION_ZIP", error["code"]);
        Assert.Equal("Only .zip solution files are supported.", error["message"]);
    }

    [Fact]
    public async Task RagController_IngestSolution_Rejects_NonZip_Upload()
    {
        var controller = new RagController(
            null!,
            null!,
            null!,
            null!,
            new NullLogger<RagController>());

        var file = CreateFormFile(Encoding.UTF8.GetBytes("hello"), "notes.txt", "text/plain");

        var result = await controller.IngestSolution(file, "dataset-1", null);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        var payload = ToDictionary(Assert.IsAssignableFrom<object>(badRequest.Value!));
        var error = ToDictionary(Assert.IsAssignableFrom<object>(payload["error"]!));

        Assert.Equal(400, badRequest.StatusCode ?? 400);
        Assert.Equal("INVALID_SOLUTION_ZIP", error["code"]?.ToString());
        Assert.Equal("Only .zip solution files are supported.", error["message"]?.ToString());
    }
}
