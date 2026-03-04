using RagBackend.Services;
using Xunit;

namespace RagBackend.Tests;

public class DataverseMirrorParserTests
{
    [Fact]
    public void ParseAll_Returns_Empty_Result_When_No_Extract_Dir_Content()
    {
        var root = Path.Combine(Path.GetTempPath(), "mirror_empty_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var parser = new DataverseMirrorParser(root);
            var result = parser.ParseAll();

            Assert.NotNull(result.Artifacts);
            Assert.NotNull(result.Automation);
            Assert.NotNull(result.Security);
            Assert.NotNull(result.Dependencies);
            Assert.Empty(result.Artifacts.Forms);
            Assert.Empty(result.Artifacts.DvSearches);
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }

    [Fact]
    public void ParseAll_Parses_EnvironmentVariables_When_Dir_Exists()
    {
        var root = Path.Combine(Path.GetTempPath(), "mirror_env_" + Guid.NewGuid().ToString("N"));
        var evDir = Path.Combine(root, "environmentvariabledefinitions", "my_var");
        Directory.CreateDirectory(evDir);
        try
        {
            var parser = new DataverseMirrorParser(root);
            var result = parser.ParseAll();

            Assert.True(result.Automation.EnvironmentVariables.Count >= 1);
            Assert.Contains(result.Automation.EnvironmentVariables, ev =>
                ev.TryGetValue("name", out var n) && "my_var".Equals(n?.ToString()));
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }

    [Fact]
    public void ParseAll_Parses_Roles_When_Roles_Dir_Exists()
    {
        var root = Path.Combine(Path.GetTempPath(), "mirror_roles_" + Guid.NewGuid().ToString("N"));
        var rolesDir = Path.Combine(root, "Roles");
        Directory.CreateDirectory(rolesDir);
        File.WriteAllText(Path.Combine(rolesDir, "SystemAdministrator.xml"), "<role></role>");
        try
        {
            var parser = new DataverseMirrorParser(root);
            var result = parser.ParseAll();

            Assert.Single(result.Security.Roles);
            Assert.True(result.Security.Roles[0].TryGetValue("name", out var n));
            Assert.Equal("SystemAdministrator", n?.ToString());
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }

    [Fact]
    public void ParseAll_Parses_Customizations_When_Other_CustomizationsXml_Exists()
    {
        var root = Path.Combine(Path.GetTempPath(), "mirror_cust_" + Guid.NewGuid().ToString("N"));
        var otherDir = Path.Combine(root, "Other");
        Directory.CreateDirectory(otherDir);
        var customizationsXml = """
<?xml version="1.0"?>
<ImportExportXml>
  <Entities>
    <Entity>
      <Name>account</Name>
      <forms>
        <systemform type="2" id="{g1}"><name>Main</name></systemform>
      </forms>
      <savedqueries>
        <savedquery id="{g2}"><name>Active Accounts</name></savedquery>
      </savedqueries>
    </Entity>
  </Entities>
  <AppModules>
    <AppModule>
      <UniqueName>MyApp</UniqueName>
      <Name>My App</Name>
    </AppModule>
  </AppModules>
</ImportExportXml>
""";
        File.WriteAllText(Path.Combine(otherDir, "customizations.xml"), customizationsXml);
        try
        {
            var parser = new DataverseMirrorParser(root);
            var result = parser.ParseAll();

            Assert.True(result.Artifacts.Forms.Count >= 1);
            Assert.True(result.Artifacts.Views.Count >= 1);
            Assert.True(result.Artifacts.ModelDrivenApps.Count >= 1);
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }
}
