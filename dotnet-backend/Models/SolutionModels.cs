namespace RagBackend.Models;

public class SolutionComponent
{
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string? Description { get; set; }
    public Dictionary<string, object>? Metadata { get; set; }
}

public class ParsedSolution
{
    public string SolutionName { get; set; } = string.Empty;
    public string Version { get; set; } = "1.0.0";
    public string Publisher { get; set; } = string.Empty;
    public List<SolutionComponent> Components { get; set; } = new();
}

public class GenerateDocRequest
{
    public ParsedSolution Solution { get; set; } = new();
    public string DocType { get; set; } = "markdown";
    public string? Provider { get; set; }
    public string? Model { get; set; }
    public string? DatasetId { get; set; }
    public string? UserPreferences { get; set; }
    public string? ApiKey { get; set; }
    public string? Endpoint { get; set; }
}

public class GenerateDocResponse
{
    public string Documentation { get; set; } = string.Empty;
    public string Format { get; set; } = string.Empty;
}
