using Microsoft.AspNetCore.Mvc;
using RagBackend.Models;
using RagBackend.Services;
using System.Collections.Concurrent;

namespace RagBackend.Controllers;

[ApiController]
[Route("rag")]
public class RagController : ControllerBase
{
    private readonly RagPipelineService       _rag;
    private readonly PacParserService         _pac;
    private readonly ConversationMemoryService _memory;
    private readonly LlmClientService         _llm;
    private readonly ILogger<RagController>   _logger;

    // In-process dataset registry (equivalent to Python DATASETS dict)
    private static readonly Dictionary<string, DatasetInfo> Datasets = new();
    private static readonly object DsLock = new();
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> IngestLocks = new();

    public RagController(
        RagPipelineService rag,
        PacParserService pac,
        ConversationMemoryService memory,
        LlmClientService llm,
        ILogger<RagController> logger)
    {
        _rag    = rag;
        _pac    = pac;
        _memory = memory;
        _llm    = llm;
        _logger = logger;
    }

    // ── GET /rag/status ───────────────────────────────────────────────────────
    [HttpGet("status")]
    public IActionResult Status([FromQuery] string? dataset_id)
    {
        try
        {
            var count    = dataset_id != null ? _rag.GetCollectionCount(dataset_id) : 0;
            var provider = _llm.ResolveProvider();
            var model    = _llm.ResolveModel(provider);

            return Ok(new
            {
                status           = "ready",
                backend_online   = true,
                provider,
                model,
                chunks_indexed   = count,
                collection_name  = dataset_id,
                embedding_model  = "text-embedding-ada-002 (Azure OpenAI)"
            });
        }
        catch (Exception ex)
        {
            return Ok(new { status = "error", backend_online = false, error = ex.Message });
        }
    }

    // ── POST /rag/ingest-solution ─────────────────────────────────────────────
    [HttpPost("ingest-solution")]
    public async Task<IActionResult> IngestSolution(
        IFormFile file,
        [FromForm] string? dataset_id,
        [FromForm] string? api_key)
    {
        _logger.LogInformation("=== INGESTION START: {FileName} ===", file?.FileName ?? "null");
        
        if (file == null)
            return BadRequest(JsonError("NO_FILE", "No file was uploaded."));
        
        dataset_id ??= "default";

        if (!file.FileName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
            return BadRequest(JsonError("INVALID_SOLUTION_ZIP", "File must be a .zip export."));

        var ingestLock = IngestLocks.GetOrAdd(dataset_id, _ => new SemaphoreSlim(1, 1));
        if (!await ingestLock.WaitAsync(0))
        {
            _logger.LogWarning("Ingestion already in progress for dataset {DatasetId}", dataset_id);
            return Conflict(JsonError("INGEST_IN_PROGRESS",
                $"An ingestion is already running for dataset '{dataset_id}'. Please wait and retry."));
        }

        var tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);

        try
        {
            _logger.LogInformation("Step 1: Saving ZIP to temp folder...");
            var zipPath = Path.Combine(tempDir, file.FileName);
            await using (var fs = System.IO.File.Create(zipPath))
                await file.CopyToAsync(fs);

            _logger.LogInformation("Step 2: Classifying upload...");
            var (type, reason) = _pac.ClassifyUpload(zipPath);
            if (type != "solution_zip")
                return BadRequest(JsonError("INVALID_SOLUTION_ZIP",
                    "Zip does not look like a Power Platform solution export."));

            _logger.LogInformation("Step 3: Clearing old collection...");
            SetDataset(dataset_id, "solution", reason, new List<string> { file.FileName });
            _rag.ClearCollection(dataset_id);

            _logger.LogInformation("Step 4: Starting ingestion (this may take several minutes)...");
            var result = await _rag.IngestSolutionZipAsync(zipPath, dataset_id);
            _logger.LogInformation("=== INGESTION COMPLETE ===");
            return Ok(result);
        }
        catch (Exception ex)
        {
            return StatusCode(500, JsonError("SERVER_ERROR", ex.Message));
        }
        finally
        {
            try { Directory.Delete(tempDir, recursive: true); } catch { /* best effort */ }
            ingestLock.Release();
        }
    }

    // ── POST /rag/ingest-chunks ───────────────────────────────────────────────
    [HttpPost("ingest-chunks")]
    public async Task<IActionResult> IngestChunks([FromBody] IngestChunksRequest request)
    {
        if (request.Chunks == null || request.Chunks.Count == 0)
            return BadRequest(JsonError("NO_CHUNKS", "No chunks provided."));

        var datasetId = request.DatasetId ?? "default";

        try
        {
            var chunks = request.Chunks.Select(c =>
            {
                var meta = new Dictionary<string, string>(c.Metadata);
                if (!meta.ContainsKey("file_name") && meta.TryGetValue("source", out var src))
                    meta["file_name"] = Path.GetFileName(src);
                return (c.Content, meta);
            }).ToList();

            var sources = chunks
                .SelectMany(c => new[] { c.meta.GetValueOrDefault("source",""), c.meta.GetValueOrDefault("path","") })
                .Where(s => !string.IsNullOrEmpty(s))
                .ToList();

            SetDataset(datasetId, request.DatasetMode ?? "generic", "chunks uploaded", sources);

            var stored = await _rag.StoreChunksAsync(chunks, datasetId);

            return Ok(new IngestResponse
            {
                Success = true,
                Message = $"Ingested {stored} chunks.",
                Details = new Dictionary<string, object>
                {
                    ["chunks_received"] = request.Chunks.Count,
                    ["chunks_stored"]   = stored,
                    ["total_in_db"]     = _rag.GetCollectionCount(datasetId)
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, JsonError("SERVER_ERROR", ex.Message));
        }
    }

    // ── POST /rag/retrieve ────────────────────────────────────────────────────
    [HttpPost("retrieve")]
    public async Task<IActionResult> Retrieve([FromBody] RagRetrieveRequest request)
    {
        var datasetId = request.DatasetId ?? "default";
        var dsInfo    = GetDataset(datasetId);
        var provider  = _llm.ResolveProvider(request.Provider);
        var model     = _llm.ResolveModel(provider, request.Model);
        var apiKey    = request.ApiKey ?? Environment.GetEnvironmentVariable("OPENAI_API_KEY");
        var endpoint  = request.Endpoint ?? Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT");

        if (provider == "cloud" && string.IsNullOrEmpty(apiKey))
            return StatusCode(500, JsonError("NO_API_KEY",
                "Cloud provider selected but no API key configured."));

        if (_rag.GetCollectionCount(datasetId) == 0)
            return Ok(new RagRetrieveResponse
            {
                Chunks      = new List<RetrievedChunk>(),
                ChunksFound = 0,
                Answer      = "No documents ingested yet. Upload files first."
            });

        try
        {
            var retrieved = await _rag.RetrieveAsync(
                request.Question, datasetId, request.NResults,
                focusFiles: request.FocusFiles);

            // Filter to focus files if requested
            if (request.FocusFiles?.Count > 0)
            {
                var focusSet = request.FocusFiles.Select(f => f.ToLower()).ToHashSet();
                retrieved = retrieved.Where(c =>
                    c.Metadata.TryGetValue("file_name", out var fn) && focusSet.Contains(fn.ToLower()))
                    .ToList();
            }

            string? answer = null;
            if (retrieved.Count > 0)
            {
                _memory.AddMessage(datasetId, "user", request.Question);

                var systemPrompt = dsInfo.Mode == "solution"
                    ? "You are a helpful assistant that answers questions about Power Platform solutions. "
                      + "Be concise but thorough. Explain technical XML in plain English. "
                      + "Do not list file paths."
                    : "You are a general document assistant. Answer only from the uploaded documents. "
                      + "Do not assume any domain unless it appears in the sources. Do not list file paths.";

                var contextParts = retrieved.Select((c, i) =>
                    $"[{c.Metadata.GetValueOrDefault("source", $"Source {i+1}")}]\n"
                    + (c.Content.Length > 1500 ? c.Content[..1500] : c.Content));

                var conversationCtx = string.Empty;
                if (request.ConversationHistory?.Count > 0)
                {
                    var history = request.ConversationHistory
                        .TakeLast(5)
                        .Select(m => $"{m.Role}: {m.Content}");
                    conversationCtx = "\n\nPrevious conversation:\n" + string.Join('\n', history) + "\n";
                }
                else
                {
                    var summary = _memory.GetContextSummary(datasetId, 1000);
                    if (!string.IsNullOrEmpty(summary))
                        conversationCtx = $"\n\nPrevious conversation:\n{summary}\n";
                }

                var userPrompt = $"Context:\n{string.Join("\n\n---\n\n", contextParts)}"
                    + conversationCtx
                    + $"\n\n---\n\nCurrent Question: {request.Question}";

                try
                {
                    answer = await _llm.ChatCompleteAsync(
                        systemPrompt, userPrompt,
                        providerOverride: provider,
                        modelOverride:    model,
                        apiKeyOverride:   apiKey,
                        endpointOverride: endpoint);

                    if (!string.IsNullOrEmpty(answer))
                        _memory.AddMessage(datasetId, "assistant", answer);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[LLM Error] {ex.Message}");
                    answer = null;
                }
            }

            var chunks = retrieved.Select(c => new RetrievedChunk
            {
                Source    = c.Metadata.GetValueOrDefault("source", "Unknown"),
                Content   = c.Content,
                Relevance = c.RelevanceScore
            }).ToList();

            return Ok(new RagRetrieveResponse
            {
                Chunks      = chunks,
                ChunksFound = chunks.Count,
                Answer      = answer ?? "No answer generated."
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, JsonError("SERVER_ERROR", ex.Message));
        }
    }

    // ── POST /rag/query ───────────────────────────────────────────────────────
    [HttpPost("query")]
    public async Task<IActionResult> Query([FromBody] RagQueryRequest request)
    {
        var datasetId = request.DatasetId ?? "default";
        var provider  = _llm.ResolveProvider(request.Provider);
        var model     = _llm.ResolveModel(provider, request.Model);
        var apiKey    = request.ApiKey ?? Environment.GetEnvironmentVariable("OPENAI_API_KEY");

        if (provider == "cloud" && !_llm.IsValidApiKey(apiKey))
            return BadRequest(JsonError("NO_API_KEY", "Valid API key required for cloud provider."));

        try
        {
            var result = await _rag.QueryAsync(
                request.Question, datasetId, request.NResults,
                provider, model, apiKey, request.Endpoint);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return StatusCode(500, JsonError("SERVER_ERROR", ex.Message));
        }
    }

    // ── GET /rag/list-docs ────────────────────────────────────────────────────
    [HttpGet("list-docs")]
    public IActionResult ListDocs([FromQuery] string? dataset_id)
    {
        var id    = dataset_id ?? "default";
        var files = _rag.ListFiles(id);
        return Ok(new { dataset_id = id, files, count = files.Count });
    }

    // ── POST /rag/reset ───────────────────────────────────────────────────────
    [HttpPost("reset")]
    public IActionResult Reset([FromBody] ResetRequest request)
    {
        var id = request.DatasetId ?? "default";
        _rag.ClearCollection(id);
        _memory.ClearHistory(id);
        lock (DsLock) Datasets.Remove(id);
        return Ok(new { success = true, message = $"Dataset '{id}' reset." });
    }

    // ── POST /rag/delete-docs ─────────────────────────────────────────────────
    [HttpPost("delete-docs")]
    public IActionResult DeleteDocs([FromBody] DeleteDocsRequest request)
    {
        var id = request.DatasetId ?? "default";
        _rag.DeleteFiles(id, request.FileNames ?? new List<string>());
        return Ok(new { success = true });
    }

    // ── GET /rag/files ────────────────────────────────────────────────────────
    [HttpGet("files")]
    public IActionResult ListFiles([FromQuery] string? dataset_id)
    {
        var id    = dataset_id ?? "default";
        var files = _rag.ListFiles(id);
        return Ok(new { dataset_id = id, files, count = files.Count });
    }

    // ── DELETE /rag/dataset ───────────────────────────────────────────────────
    [HttpDelete("dataset")]
    public IActionResult ClearDataset([FromQuery] string? dataset_id)
    {
        var id = dataset_id ?? "default";
        _rag.ClearCollection(id);
        _memory.ClearHistory(id);
        return Ok(new { success = true, message = $"Dataset '{id}' cleared." });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    private static void SetDataset(string id, string mode, string reason, List<string>? files)
    {
        lock (DsLock)
        {
            var existing = Datasets.GetValueOrDefault(id) ?? new DatasetInfo("unknown", "", new());
            var combined = existing.Files.Union(files ?? Enumerable.Empty<string>()).ToList();
            Datasets[id] = new DatasetInfo(mode, reason, combined);
        }
    }

    private static DatasetInfo GetDataset(string id)
    {
        lock (DsLock)
            return Datasets.GetValueOrDefault(id) ?? new DatasetInfo("unknown", "not registered", new());
    }

    private static object JsonError(string code, string message) =>
        new { ok = false, error = new { code, message } };

    private record DatasetInfo(string Mode, string Reason, List<string> Files);
}
