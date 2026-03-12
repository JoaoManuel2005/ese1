using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using RagBackend.Services;
using System.IO.Compression;
using System.Text;
using System.Xml.Linq;
using Xunit;

namespace RagBackend.Tests;

public class PacParserServiceClassifyAndDirectTests
{
    private static PacParserService CreateParser()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["PAC_USE_CSHARP_MIRROR"] = "true",
            ["PAC_USE_PYTHON_PARITY"] = "false"
        }).Build();
        return new PacParserService(new NullLogger<PacParserService>(), config);
    }

    [Fact]
    public void ClassifyUpload_Returns_SolutionZip_When_SolutionXml_Present()
    {
        var root = Path.Combine(Path.GetTempPath(), "pac_classify_" + Guid.NewGuid().ToString("N"));
        var zipPath = Path.Combine(root, "test.zip");
        Directory.CreateDirectory(root);
        try
        {
            using (var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create))
            {
                var entry = zip.CreateEntry("Other/Solution.xml");
                using var sw = new StreamWriter(entry.Open(), Encoding.UTF8);
                sw.Write("<ImportExportXml><SolutionManifest></SolutionManifest></ImportExportXml>");
            }

            var parser = CreateParser();
            var (type, reason) = parser.ClassifyUpload(zipPath);

            Assert.Equal("solution_zip", type);
            Assert.Contains("solution marker", reason, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }

    [Fact]
    public void ClassifyUpload_Returns_SolutionZip_When_ContentTypesXml_Present()
    {
        var root = Path.Combine(Path.GetTempPath(), "pac_classify_ct_" + Guid.NewGuid().ToString("N"));
        var zipPath = Path.Combine(root, "test.zip");
        Directory.CreateDirectory(root);
        try
        {
            using (var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create))
            {
                var entry = zip.CreateEntry("[Content_Types].xml");
                using var sw = new StreamWriter(entry.Open(), Encoding.UTF8);
                sw.Write("<Types></Types>");
            }

            var parser = CreateParser();
            var (type, reason) = parser.ClassifyUpload(zipPath);

            Assert.Equal("solution_zip", type);
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }

    [Fact]
    public void ClassifyUpload_Returns_Unknown_When_No_Solution_Markers()
    {
        var root = Path.Combine(Path.GetTempPath(), "pac_classify_unk_" + Guid.NewGuid().ToString("N"));
        var zipPath = Path.Combine(root, "test.zip");
        Directory.CreateDirectory(root);
        try
        {
            using (var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create))
            {
                var entry = zip.CreateEntry("readme.txt");
                using var sw = new StreamWriter(entry.Open(), Encoding.UTF8);
                sw.Write("Just a file");
            }

            var parser = CreateParser();
            var (type, reason) = parser.ClassifyUpload(zipPath);

            Assert.Equal("unknown", type);
            Assert.Contains("missing solution markers", reason, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }

    [Fact]
    public void ParseDirectly_From_Zip_With_SolutionXml_Returns_Solution_Data()
    {
        var root = Path.Combine(Path.GetTempPath(), "pac_direct_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var zipPath = Path.Combine(root, "sol.zip");
        try
        {
            var solutionXml = """
<?xml version="1.0"?>
<ImportExportXml>
  <SolutionManifest>
    <UniqueName>TestSolution</UniqueName>
    <Version>2.0.0.1</Version>
    <Publisher><UniqueName>Contoso</UniqueName></Publisher>
    <RootComponents>
      <RootComponent type="1" schemaName="account" id="{guid}" />
    </RootComponents>
  </SolutionManifest>
</ImportExportXml>
""";
            using (var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create))
            {
                var entry = zip.CreateEntry("solution.xml");
                using var sw = new StreamWriter(entry.Open(), Encoding.UTF8);
                sw.Write(solutionXml);
            }

            var parser = CreateParser();
            var result = parser.ParseSolution(zipPath, root);

            Assert.Equal("TestSolution", result.SolutionName);
            Assert.Equal("2.0.0.1", result.Version);
            Assert.Equal("Contoso", result.Publisher);
            Assert.True(result.Components.Count >= 0);
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }

    [Fact]
    public void ParseDirectly_From_Zip_Without_SolutionXml_Returns_Unknown()
    {
        var root = Path.Combine(Path.GetTempPath(), "pac_direct_no_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var zipPath = Path.Combine(root, "sol.zip");
        try
        {
            using (var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create))
            {
                var entry = zip.CreateEntry("other.xml");
                using var sw = new StreamWriter(entry.Open(), Encoding.UTF8);
                sw.Write("<root></root>");
            }

            var parser = CreateParser();
            var result = parser.ParseSolution(zipPath, root);

            Assert.Equal("Unknown", result.SolutionName);
            Assert.Equal("Unknown", result.Publisher);
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }
}
