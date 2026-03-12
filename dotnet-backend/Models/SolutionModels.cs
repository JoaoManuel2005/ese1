using System.Text.Json.Serialization;

namespace RagBackend.Models;

using System.Text.Json.Serialization;

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
    [JsonPropertyName("sharepointRefs")]
    public List<SharePointRef> SharepointRefs { get; set; } = new();
    [JsonPropertyName("sharePointMetadata")]
    public List<SharePointMetadata>? SharePointMetadata { get; set; }
}

public class SharePointRef
{
    [JsonPropertyName("url")]
    public string Url { get; set; } = string.Empty;
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = "unknown";
    [JsonPropertyName("source")]
    public string Source { get; set; } = string.Empty;
}

public class GenerateDocRequest
{
    public ParsedSolution Solution { get; set; } = new();

    [JsonPropertyName("doc_type")]
    public string DocType { get; set; } = "markdown";

    [JsonPropertyName("systemPrompt")]
    public string? SystemPrompt { get; set; }

    public string? Provider { get; set; }
    public string? Model { get; set; }

    [JsonPropertyName("dataset_id")]
    public string? DatasetId { get; set; }

    [JsonPropertyName("user_preferences")]
    public string? UserPreferences { get; set; }

    public string? ApiKey { get; set; }
    public string? Endpoint { get; set; }
}

public class GenerateDocResponse
{
    public string Documentation { get; set; } = string.Empty;
    public string Format { get; set; } = string.Empty;
}
