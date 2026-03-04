namespace RagBackend.Services;

/// <summary>
/// Equivalent to Python conversation_memory.py
/// Stores per-dataset conversation history in memory.
/// </summary>
public class ConversationMemoryService
{
    private readonly Dictionary<string, List<ConversationMessage>> _conversations = new();
    private readonly int _maxMessages;

    public ConversationMemoryService(int maxMessages = 50)
    {
        _maxMessages = maxMessages;
    }

    public void AddMessage(string datasetId, string role, string content)
    {
        if (!_conversations.ContainsKey(datasetId))
            _conversations[datasetId] = new List<ConversationMessage>();

        _conversations[datasetId].Add(new ConversationMessage(role, content));

        // Trim to max
        if (_conversations[datasetId].Count > _maxMessages)
            _conversations[datasetId] = _conversations[datasetId][^_maxMessages..];
    }

    public List<Dictionary<string, string>> GetHistory(string datasetId, int? maxMessages = null)
    {
        if (!_conversations.TryGetValue(datasetId, out var messages))
            return new List<Dictionary<string, string>>();

        var slice = maxMessages.HasValue ? messages[^Math.Min(maxMessages.Value, messages.Count)..] : messages;
        return slice.Select(m => m.ToDict()).ToList();
    }

    public string GetContextSummary(string datasetId, int maxChars = 2000)
    {
        if (!_conversations.TryGetValue(datasetId, out var messages))
            return string.Empty;

        var recent = messages.TakeLast(10).ToList();
        var parts = new List<string>();
        int total = 0;

        foreach (var msg in Enumerable.Reverse(recent))
        {
            var text = $"{msg.Role}: {msg.Content}";
            if (total + text.Length > maxChars) break;
            parts.Insert(0, text);
            total += text.Length;
        }

        return string.Join('\n', parts);
    }

    public void ClearHistory(string datasetId) => _conversations.Remove(datasetId);

    public List<string> GetAllDatasets() => _conversations.Keys.ToList();

    private record ConversationMessage(string Role, string Content, DateTimeOffset Timestamp)
    {
        public ConversationMessage(string role, string content)
            : this(role, content, DateTimeOffset.UtcNow) { }

        public Dictionary<string, string> ToDict() => new()
        {
            ["role"]    = Role,
            ["content"] = Content
        };
    }
}
