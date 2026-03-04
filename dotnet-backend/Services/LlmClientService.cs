using Azure.AI.OpenAI;
using OpenAI.Chat;
using System.Net.Http.Json;
using System.Text.Json;

namespace RagBackend.Services;

/// <summary>
/// Equivalent to Python llm_client.py
/// Supports local Ollama, OpenAI, and Azure OpenAI.
/// </summary>
public class LlmClientService
{
    private readonly IConfiguration _config;
    private readonly IHttpClientFactory _httpClientFactory;

    private static readonly HashSet<string> PlaceholderValues = new(StringComparer.OrdinalIgnoreCase)
    {
        "your_openai_api_key_here", "your_anthropic_api_key_here",
        "sk-xxx", "your-api-key", ""
    };

    public LlmClientService(IConfiguration config, IHttpClientFactory httpClientFactory)
    {
        _config = config;
        _httpClientFactory = httpClientFactory;
    }

    public bool IsValidApiKey(string? key) =>
        !string.IsNullOrWhiteSpace(key) && !PlaceholderValues.Contains(key.Trim());

    public string ResolveProvider(string? providerOverride = null)
    {
        var p = (providerOverride ?? _config["LLM_PROVIDER"] ?? "cloud").Trim().ToLower();
        return p == "local" ? "local" : "cloud";
    }

    public string ResolveModel(string provider, string? modelOverride = null)
    {
        if (provider == "local")
            return modelOverride ?? _config["LOCAL_LLM_MODEL"] ?? "llama3.1:8b";

        return modelOverride
            ?? _config["DEFAULT_MODEL"]
            ?? _config["OPENAI_MODEL"]
            ?? "gpt-4";
    }

    public async Task<string> ChatCompleteAsync(
        string system,
        string user,
        string? providerOverride = null,
        string? modelOverride = null,
        string? apiKeyOverride = null,
        string? endpointOverride = null)
    {
        var provider = ResolveProvider(providerOverride);
        var model = ResolveModel(provider, modelOverride);

        if (provider == "local")
            return await CallLocalOllamaAsync(system, user, model);

        return await CallCloudLlmAsync(system, user, model, apiKeyOverride, endpointOverride);
    }

    // ── Local Ollama ────────────────────────────────────────────────────────────
    private async Task<string> CallLocalOllamaAsync(string system, string user, string model)
    {
        var baseUrl = (_config["LOCAL_LLM_BASE_URL"] ?? "http://localhost:11434").TrimEnd('/');

        var http = _httpClientFactory.CreateClient();
        http.Timeout = TimeSpan.FromMinutes(3);  // Reduced from 10 minutes with token limit

        var body = new
        {
            model,
            messages = new[]
            {
                new { role = "system", content = system },
                new { role = "user",   content = user   }
            },
            stream = false,
            options = new
            {
                temperature = 0.3,     // Increased from 0.1 for faster generation
                top_p = 0.9,           // Increased from 0.2 for more variety
                num_predict = 6000,    // Limit tokens (equivalent to max_tokens)
                repeat_penalty = 1.3   // Reduce repetition (equivalent to frequency_penalty)
            }
        };

        var response = await http.PostAsJsonAsync($"{baseUrl}/api/chat", body);
        response.EnsureSuccessStatusCode();

        using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
        var content = doc.RootElement
            .GetProperty("message")
            .GetProperty("content")
            .GetString();

        if (string.IsNullOrEmpty(content))
            throw new InvalidOperationException("Local LLM returned no content.");

        return content;
    }

    // ── Cloud (OpenAI / Azure OpenAI) ──────────────────────────────────────────
    private async Task<string> CallCloudLlmAsync(
        string system,
        string user,
        string model,
        string? apiKeyOverride,
        string? endpointOverride)
    {
        var apiKey     = apiKeyOverride ?? _config["AZURE_OPENAI_API_KEY"] ?? _config["OPENAI_API_KEY"];
        var endpoint   = endpointOverride ?? _config["AZURE_OPENAI_ENDPOINT"];
        var openAiKey  = apiKeyOverride ?? _config["OPENAI_API_KEY"];

        ChatClient chatClient;

        if (IsValidApiKey(apiKey) && !string.IsNullOrEmpty(endpoint))
        {
            // Azure OpenAI (or Azure AI Foundry — OpenAI-compatible endpoint)
            var azureClient = new AzureOpenAIClient(new Uri(endpoint), new Azure.AzureKeyCredential(apiKey!));
            chatClient = azureClient.GetChatClient(model);
        }
        else if (IsValidApiKey(openAiKey))
        {
            // Standard OpenAI
            var openAiClient = new OpenAI.OpenAIClient(openAiKey);
            chatClient = openAiClient.GetChatClient(model);
        }
        else
        {
            throw new InvalidOperationException(
                "No valid API key configured. Set OPENAI_API_KEY or AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT.");
        }

        var messages = new List<ChatMessage>
        {
            new SystemChatMessage(system),
            new UserChatMessage(user)
        };

        var options = new ChatCompletionOptions
        {
            Temperature = 0.3f,        // Increased from 0.1 for faster generation
            TopP = 0.9f,               // Increased from 0.2 for more variety
            MaxOutputTokenCount = 6000, // Limit output to prevent excessive generation
            FrequencyPenalty = 0.3f    // Reduce repetition
        };

        var result = await chatClient.CompleteChatAsync(messages, options);
        return result.Value.Content[0].Text;
    }
}
