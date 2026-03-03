using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using RagBackend.Services;
using System.IO.Compression;
using System.Text.RegularExpressions;
using Xunit.Abstractions;
using Xunit;

namespace RagBackend.Tests;

public class PacParserDataverseSharePointTests
{
    private readonly ITestOutputHelper _output;

    public PacParserDataverseSharePointTests(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public void Parses_DvSearch_And_SearchEntities_With_SharePoint_Urls()
    {
        var root = CreateFixtureRoot();
        try
        {
            CreateSolutionXml(root);
            CreateDvTableSearch(root);
            CreateDvTableSearchEntity(root);

            var parser = CreateParser();
            var parsed = parser.ParseExtractedDirectoryForTests(root);

            Assert.Contains(parsed.Components, c => c.Type == "knowledge_source");
            Assert.Contains(parsed.Components, c => c.Type == "knowledge_source_item");
            Assert.Contains(parsed.Components, c => c.Type == "search_entity");
            Assert.Contains(parsed.Components, c => c.Type == "data_source" && c.Name == "Dataverse");
            Assert.Contains(parsed.Components, c => c.Type == "data_source" && c.Name == "SharePoint");

            var ksItem = parsed.Components.First(c => c.Type == "knowledge_source_item");
            Assert.Contains("https://example.sharepoint.com/sites/Reply", ksItem.Description ?? "");
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Parses_EnvironmentVariables_And_BotComponents_From_Extracted_Folders()
    {
        var root = CreateFixtureRoot();
        try
        {
            CreateSolutionXml(root);
            CreateEnvironmentVariable(root, "wmreply_Replybrary_SP_Site");
            CreateBotTopic(root, "cr6e9_replybraryAgent.topic.Greeting");

            var parser = CreateParser();
            var parsed = parser.ParseExtractedDirectoryForTests(root);

            Assert.Contains(parsed.Components, c => c.Type == "environment_variable" && c.Name == "wmreply_Replybrary_SP_Site");
            Assert.Contains(parsed.Components, c => c.Type == "bot_topic" && c.Name == "Greeting");
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private static PacParserService CreateParser()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["PAC_USE_CSHARP_MIRROR"] = "true",
            ["PAC_USE_PYTHON_PARITY"] = "false"
        }).Build();
        return new PacParserService(new NullLogger<PacParserService>(), config);
    }

    private static string CreateFixtureRoot()
    {
        var root = Path.Combine(Path.GetTempPath(), "pac_parser_test_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        return root;
    }

    private static void CreateSolutionXml(string root)
    {
        var other = Path.Combine(root, "Other");
        Directory.CreateDirectory(other);
        File.WriteAllText(Path.Combine(other, "Solution.xml"), """
<ImportExportXml>
  <SolutionManifest>
    <UniqueName>Replybrary</UniqueName>
    <Version>1.0.0.20</Version>
    <Publisher><UniqueName>WMReply</UniqueName></Publisher>
  </SolutionManifest>
</ImportExportXml>
""");
        File.WriteAllText(Path.Combine(other, "customizations.xml"), "<ImportExportXml></ImportExportXml>");
    }

    private static void CreateDvTableSearch(string root)
    {
        var dir = Path.Combine(root, "dvtablesearchs", "search_1");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "dvtablesearch.xml"), """
<dvtablesearch dvtablesearchid="search-123">
  <name>ReplySearch</name>
  <searchtype>knowledge</searchtype>
  <connectionreference>
    <connectionreferencelogicalname>shared_sharepointonline</connectionreferencelogicalname>
  </connectionreference>
  <knowledgeconfig>{
    "driveItems":[
      {
        "$kind":"list",
        "displayName":"Replybrary project list",
        "webUrl":"https://example.sharepoint.com/sites/Reply/Lists/Projects",
        "driveId":"drive-1",
        "itemId":"item-1",
        "sharepointIds":{
          "siteUrl":"https://example.sharepoint.com/sites/Reply",
          "siteId":"site-1",
          "webId":"web-1",
          "listId":"list-1"
        }
      }
    ]
  }</knowledgeconfig>
</dvtablesearch>
""");
    }

    private static void CreateDvTableSearchEntity(string root)
    {
        var dir = Path.Combine(root, "dvtablesearchentities", "entity_1");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "dvtablesearchentity.xml"), """
<dvtablesearchentity dvtablesearchentityid="entity-search-1">
  <dvtablesearch><dvtablesearchid>search-123</dvtablesearchid></dvtablesearch>
  <entitylogicalname>replybrary_project</entitylogicalname>
  <name>Replybrary project list</name>
</dvtablesearchentity>
""");
    }

    private static void CreateEnvironmentVariable(string root, string schemaName)
    {
        var dir = Path.Combine(root, "environmentvariabledefinitions", schemaName);
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "environmentvariabledefinition.xml"), $"""
<environmentvariabledefinition>
  <schemaname>{schemaName}</schemaname>
  <displayname>{schemaName}</displayname>
  <type>text</type>
</environmentvariabledefinition>
""");
    }

    private static void CreateBotTopic(string root, string folderName)
    {
        var dir = Path.Combine(root, "botcomponents", folderName);
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "topic.json"), """{"name":"Greeting"}""");
    }

    [Fact]
    public void Inspect_Real_SolutionZip_Files_And_Links_Like_Python()
    {
        var solutionZip = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "pac-workspace", "solution.zip"));
        if (!File.Exists(solutionZip))
        {
            _output.WriteLine($"Test skipped: solution zip not found at {solutionZip}");
            return;
        }

        using var zip = ZipFile.OpenRead(solutionZip);
        var entries = zip.Entries.Select(e => e.FullName).ToList();

        _output.WriteLine($"ZIP: {solutionZip}");
        _output.WriteLine($"Total entries: {entries.Count}");

        var topFolders = entries
            .Where(e => e.Contains('/'))
            .Select(e => e.Split('/', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault())
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(s => s)
            .ToList();

        _output.WriteLine("Top-level folders:");
        foreach (var folder in topFolders)
            _output.WriteLine($"  - {folder}");

        Assert.Contains(entries, e => e.EndsWith("solution.xml", StringComparison.OrdinalIgnoreCase)
                                   || e.EndsWith("Other/Solution.xml", StringComparison.OrdinalIgnoreCase));
        Assert.True(entries.Any(e => e.Contains("dvtablesearch", StringComparison.OrdinalIgnoreCase)),
            "Expected dvtablesearch files/folders in solution zip.");
        Assert.True(entries.Any(e => e.Contains("Workflows/", StringComparison.OrdinalIgnoreCase)),
            "Expected Workflows folder in solution zip.");
    }

    [Fact]
    public void Inspect_Real_SolutionZip_Extracts_SharePoint_And_Dataverse_References()
    {
        var solutionZip = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "pac-workspace", "solution.zip"));
        if (!File.Exists(solutionZip))
        {
            _output.WriteLine($"Test skipped: solution zip not found at {solutionZip}");
            return;
        }

        using var zip = ZipFile.OpenRead(solutionZip);
        var urlRegex = new Regex(@"https?://[^\s""'<>]+", RegexOptions.Compiled | RegexOptions.IgnoreCase);

        var discoveredUrls = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var dataverseHits = 0;
        var sharepointHits = 0;

        foreach (var entry in zip.Entries)
        {
            if (entry.Length == 0) continue;
            var ext = Path.GetExtension(entry.FullName).ToLowerInvariant();
            if (ext is not (".xml" or ".json" or ".txt" or ".yaml" or ".yml")) continue;

            using var stream = entry.Open();
            using var reader = new StreamReader(stream);
            var content = reader.ReadToEnd();

            foreach (Match m in urlRegex.Matches(content))
                discoveredUrls.Add(m.Value);

            if (content.Contains("shared_commondataserviceforapps", StringComparison.OrdinalIgnoreCase)
                || content.Contains("entitylogicalname", StringComparison.OrdinalIgnoreCase)
                || content.Contains("dvtablesearchentity", StringComparison.OrdinalIgnoreCase))
            {
                dataverseHits++;
            }

            if (content.Contains("shared_sharepointonline", StringComparison.OrdinalIgnoreCase)
                || content.Contains(".sharepoint.com", StringComparison.OrdinalIgnoreCase)
                || content.Contains("knowledgeconfig", StringComparison.OrdinalIgnoreCase))
            {
                sharepointHits++;
            }
        }

        _output.WriteLine($"Discovered URLs: {discoveredUrls.Count}");
        foreach (var url in discoveredUrls.Take(20))
            _output.WriteLine($"  - {url}");

        _output.WriteLine($"Dataverse indicator files: {dataverseHits}");
        _output.WriteLine($"SharePoint indicator files: {sharepointHits}");

        Assert.True(dataverseHits > 0, "No Dataverse indicators found in ZIP text content.");
        Assert.True(sharepointHits > 0, "No SharePoint indicators found in ZIP text content.");
    }
}
