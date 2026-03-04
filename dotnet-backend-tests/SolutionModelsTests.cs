using RagBackend.Models;
using Xunit;

namespace RagBackend.Tests;

public class SolutionModelsTests
{
    [Fact]
    public void SolutionComponent_Has_Empty_Defaults()
    {
        var c = new SolutionComponent();
        Assert.Equal(string.Empty, c.Name);
        Assert.Equal(string.Empty, c.Type);
        Assert.Null(c.Description);
        Assert.Null(c.Metadata);
    }

    [Fact]
    public void SolutionComponent_Properties_Can_Be_Set()
    {
        var c = new SolutionComponent
        {
            Name = "MyEntity",
            Type = "entity",
            Description = "A table",
            Metadata = new Dictionary<string, object> { ["key"] = "value" }
        };
        Assert.Equal("MyEntity", c.Name);
        Assert.Equal("entity", c.Type);
        Assert.Equal("A table", c.Description);
        Assert.NotNull(c.Metadata);
        Assert.Equal("value", c.Metadata["key"]);
    }

    [Fact]
    public void ParsedSolution_Has_Expected_Defaults()
    {
        var s = new ParsedSolution();
        Assert.Equal(string.Empty, s.SolutionName);
        Assert.Equal("1.0.0", s.Version);
        Assert.Equal(string.Empty, s.Publisher);
        Assert.NotNull(s.Components);
        Assert.Empty(s.Components);
    }

    [Fact]
    public void GenerateDocRequest_Solution_And_DocType_Defaults()
    {
        var req = new GenerateDocRequest();
        Assert.NotNull(req.Solution);
        Assert.Equal("markdown", req.DocType);
        Assert.Null(req.DatasetId);
    }

    [Fact]
    public void GenerateDocResponse_Format_Can_Be_Set()
    {
        var res = new GenerateDocResponse
        {
            Documentation = "# Doc",
            Format = "markdown"
        };
        Assert.Equal("# Doc", res.Documentation);
        Assert.Equal("markdown", res.Format);
    }
}
