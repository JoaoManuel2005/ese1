using Microsoft.AspNetCore.Mvc;
using RagBackend.Models;
using RagBackend.Services;

namespace RagBackend.Controllers;

[ApiController]
public class SolutionController : ControllerBase
{
    private readonly PacParserService      _pac;
    private readonly RagPipelineService    _rag;
    private readonly ConversationMemoryService _memory;
    private readonly LlmClientService      _llm;
    private readonly SharePointService     _sharePoint;

    public SolutionController(
        PacParserService pac,
        RagPipelineService rag,
        ConversationMemoryService memory,
        LlmClientService llm,
        SharePointService sharePoint)
    {
        _pac    = pac;
        _rag    = rag;
        _memory = memory;
        _llm    = llm;
        _sharePoint = sharePoint;
    }

    // ── POST /parse-solution ─────────────────────────────────────────────────
    [HttpPost("parse-solution")]
    public async Task<IActionResult> ParseSolution(IFormFile file)
    {
        if (!file.FileName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
            return BadRequest(Error("INVALID_SOLUTION_ZIP", "Only .zip solution files are supported."));

        var tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);

        try
        {
            var zipPath = Path.Combine(tempDir, file.FileName);
            await using (var fs = System.IO.File.Create(zipPath))
                await file.CopyToAsync(fs);

            var (type, reason) = _pac.ClassifyUpload(zipPath);
            if (type != "solution_zip")
                return BadRequest(Error("INVALID_SOLUTION_ZIP",
                    "Zip does not look like a Power Platform solution export.",
                    "Ensure the zip contains solution.xml or [Content_Types].xml."));

            var solution = _pac.ParseSolution(zipPath, tempDir);

            // Detect SharePoint URLs from knowledge sources
            var sharePointUrls = solution.Components
                .Where(c => c.Type == "knowledge_source_item")
                .SelectMany(c =>
                {
                    var urls = new List<string>();
                    if (c.Metadata == null) return urls;
                    if (c.Metadata.TryGetValue("web_url", out var web) && web is string wu && !string.IsNullOrWhiteSpace(wu)) 
                        urls.Add(_sharePoint.ExtractSiteUrl(wu));
                    if (c.Metadata.TryGetValue("site_url", out var site) && site is string su && !string.IsNullOrWhiteSpace(su)) 
                        urls.Add(_sharePoint.ExtractSiteUrl(su));
                    return urls;
                })
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var parseResponse = new ParseSolutionResponse
            {
                Data = solution,
                SharePointUrls = sharePointUrls,
                SharePointEnrichmentStatus = SharePointEnrichmentStatuses.NotNeeded
            };

            if (sharePointUrls.Count == 0)
            {
                return Ok(parseResponse);
            }

            if (!_sharePoint.IsEnrichmentEnabled)
            {
                Console.WriteLine($"[ParseSolution] Detected {sharePointUrls.Count} SharePoint URL(s) but enrichment is disabled");
                parseResponse.SharePointEnrichmentStatus = SharePointEnrichmentStatuses.Disabled;
                parseResponse.Message = "SharePoint references detected. Enrichment is disabled.";
                return Ok(parseResponse);
            }

            if (!_sharePoint.IsConfigured)
            {
                Console.WriteLine($"[ParseSolution] Detected {sharePointUrls.Count} SharePoint URL(s) but service not configured - optional enrichment requires user authentication");
                parseResponse.SharePointEnrichmentStatus = SharePointEnrichmentStatuses.DetectedRequiresAuth;
                parseResponse.AuthenticationRequired = true;
                parseResponse.Message = "SharePoint authentication required for optional enrichment";
                return Ok(parseResponse);
            }

            Console.WriteLine($"[ParseSolution] Detected {sharePointUrls.Count} SharePoint URL(s), fetching metadata...");
            var spResponse = await _sharePoint.FetchMetadataAsync(sharePointUrls, includeColumns: true);
            if (spResponse.Sites.Count > 0)
            {
                solution.SharePointMetadata = spResponse.Sites;
            }

            if (spResponse.Success)
            {
                Console.WriteLine($"[ParseSolution] ✓ Fetched SharePoint metadata for {spResponse.Sites.Count} site(s)");
                parseResponse.SharePointEnrichmentStatus = SharePointEnrichmentStatuses.Available;
                return Ok(parseResponse);
            }

            Console.WriteLine($"[ParseSolution] SharePoint enrichment failed for {sharePointUrls.Count} URL(s): {spResponse.ErrorMessage ?? "Unknown error"}");
            parseResponse.SharePointEnrichmentStatus = SharePointEnrichmentStatuses.Failed;
            parseResponse.Message = spResponse.ErrorMessage ?? "SharePoint enrichment failed.";
            return Ok(parseResponse);
        }
        catch (Exception ex)
        {
            return StatusCode(500, Error("SERVER_ERROR", $"Failed to parse solution: {ex.Message}"));
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    // ── POST /generate-documentation ─────────────────────────────────────────
    [HttpPost("generate-documentation")]
    public async Task<IActionResult> GenerateDocumentation([FromBody] GenerateDocRequest request)
    {
        var provider = _llm.ResolveProvider(request.Provider);
        var model    = _llm.ResolveModel(provider, request.Model);

        var hasCustomPrompt = !string.IsNullOrWhiteSpace(request.SystemPrompt);
        var preview = hasCustomPrompt && request.SystemPrompt!.Length > 0
            ? (request.SystemPrompt.Length > 60 ? request.SystemPrompt.AsSpan(0, 60).ToString() + "..." : request.SystemPrompt)
            : "(default)";
        Console.WriteLine("[GenerateDocumentation] SystemPrompt received: custom={0}, length={1}, preview=\"{2}\"",
            hasCustomPrompt, request.SystemPrompt?.Length ?? 0, preview.Replace("\"", "'"));

        if (provider == "cloud")
        {
            bool hasOpenAi = _llm.IsValidApiKey(request.ApiKey)
                          || _llm.IsValidApiKey(Environment.GetEnvironmentVariable("OPENAI_API_KEY"));
            bool hasAzure  = (_llm.IsValidApiKey(request.ApiKey) && !string.IsNullOrEmpty(request.Endpoint))
                          || (_llm.IsValidApiKey(Environment.GetEnvironmentVariable("AZURE_OPENAI_API_KEY"))
                              && !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT")));

            if (!hasOpenAi && !hasAzure)
                return StatusCode(500, Error("NO_API_KEY",
                    "Cloud provider requires an API key or Azure OpenAI credentials."));
        }

        try
        {
            // Build user preferences from conversation memory
            string? userPrefs = null;

            if (!string.IsNullOrEmpty(request.DatasetId))
            {
                var history = _memory.GetHistory(request.DatasetId, 50);
                if (history.Count > 0)
                    userPrefs = ExtractPreferencesFromHistory(history);
            }

            if (string.IsNullOrEmpty(userPrefs) && !string.IsNullOrEmpty(request.UserPreferences))
                userPrefs = request.UserPreferences;

            var doc = await _rag.GenerateDocumentationAsync(
                solution   : request.Solution,
                docType    : request.DocType,
                systemPromptOverride: request.SystemPrompt,
                provider   : provider,
                model      : model,
                userPrefs  : userPrefs,
                apiKey     : request.ApiKey,
                endpoint   : request.Endpoint,
                outputType : request.OutputType);

            return Ok(new GenerateDocResponse { Documentation = doc, Format = request.DocType });
        }
        catch (Exception ex)
        {
            return StatusCode(500, Error("SERVER_ERROR", $"Failed to generate documentation: {ex.Message}"));
        }
    }

    // ── helpers ───────────────────────────────────────────────────────────────
    private static string ExtractPreferencesFromHistory(List<Dictionary<string, string>> history)
    {
        // Simple extraction — summarize user messages as instructions
        var userMessages = history
            .Where(m => m.GetValueOrDefault("role") == "user")
            .Select(m => m.GetValueOrDefault("content", ""))
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .TakeLast(5);

        return string.Join('\n', userMessages);
    }

    private static object Error(string code, string message, string? hint = null)
    {
        var err = new Dictionary<string, object>
        {
            ["ok"]    = false,
            ["error"] = new Dictionary<string, string?> { ["code"] = code, ["message"] = message, ["hint"] = hint }
        };
        return err;
    }
}
