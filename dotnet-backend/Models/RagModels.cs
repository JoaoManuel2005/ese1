namespace RagBackend.Models;

public class RagQueryRequest
{
    public string Question { get; set; } = string.Empty;
    public int NResults { get; set; } = 5;
    public string? ApiKey { get; set; }
    public string? Endpoint { get; set; }
    public string? Provider { get; set; }
    public string? Model { get; set; }
    public string? DatasetId { get; set; }
}

public class RagQueryResponse
{
    public string Answer { get; set; } = string.Empty;
    public List<SourceReference> Sources { get; set; } = new();
    public int ChunksFound { get; set; }
}

public class RagRetrieveRequest
{
    public string Question { get; set; } = string.Empty;
    public int NResults { get; set; } = 5;
    public string? Provider { get; set; }
    public string? Model { get; set; }
    public string? DatasetId { get; set; }
    public List<string>? FocusFiles { get; set; }
    public List<ChatMessage>? ConversationHistory { get; set; }
    public string? ApiKey { get; set; }
    public string? Endpoint { get; set; }
}

public class RagRetrieveResponse
{
    public List<RetrievedChunk> Chunks { get; set; } = new();
    public int ChunksFound { get; set; }
    public string? Answer { get; set; }
}

public class RetrievedChunk
{
    public string Source { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public double Relevance { get; set; }
}

public class SourceReference
{
    public string Source { get; set; } = string.Empty;
    public double Relevance { get; set; }
    public string Preview { get; set; } = string.Empty;
}

public class IngestResponse
{
    public bool Success { get; set; }
    public string Message { get; set; } = string.Empty;
    public Dictionary<string, object> Details { get; set; } = new();
    public string? CorpusType { get; set; }
    public string? CorpusReason { get; set; }
}

public class ChunkData
{
    public string Content { get; set; } = string.Empty;
    public Dictionary<string, string> Metadata { get; set; } = new();
}

public class IngestChunksRequest
{
    public List<ChunkData> Chunks { get; set; } = new();
    public string? DatasetId { get; set; }
    public string? DatasetMode { get; set; }
    public List<string>? FocusFiles { get; set; }
}

public class ChatMessage
{
    public string Role { get; set; } = "user";
    public string Content { get; set; } = string.Empty;
}

public class LocalModelsResponse
{
    public List<string> Models { get; set; } = new();
    public string? Error { get; set; }
}

public class ResetRequest
{
    public string? DatasetId { get; set; }
}

public class DeleteDocsRequest
{
    public string? DatasetId { get; set; }
    public List<string>? FileNames { get; set; }
}
