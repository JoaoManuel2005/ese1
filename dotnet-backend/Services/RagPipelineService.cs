using Azure.AI.OpenAI;
using OpenAI.Embeddings;
using RagBackend.Models;
using System.IO.Compression;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RagBackend.Services;

/// <summary>
/// Equivalent to Python full_rag_pipeline.py
/// 
/// Implements:
///  - Document chunking with overlap
///  - Embedding generation (Azure OpenAI text-embedding-ada-002)
///  - In-memory vector store (per dataset, cosine similarity)
///  - BM25 keyword search
///  - Hybrid retrieval (RRF scoring of BM25 + vector)
///  - LLM answer generation
/// </summary>
public class RagPipelineService
{
    private readonly IConfiguration _config;
    private readonly LlmClientService _llm;
    private readonly ILogger<RagPipelineService> _logger;
    private readonly HttpClient _httpClient;
    private readonly OnnxEmbeddingService _onnxEmbedding;
    private readonly PacParserService _pacParser;

    // ── In-memory stores (keyed by datasetId) ───────────────────────────────────
    private readonly Dictionary<string, List<ChunkRecord>>      _vectorStore = new();
    private readonly Dictionary<string, Bm25Index>              _bm25Store   = new();
    private readonly object _lock = new();

    public RagPipelineService(
        IConfiguration config,
        LlmClientService llm,
        ILogger<RagPipelineService> logger,
        IHttpClientFactory httpClientFactory,
        OnnxEmbeddingService onnxEmbedding,
        PacParserService pacParser)
    {
        _config = config;
        _llm    = llm;
        _logger = logger;
        _httpClient = httpClientFactory.CreateClient();
        _httpClient.Timeout = TimeSpan.FromMinutes(10); // Increase timeout for large documents
        _onnxEmbedding = onnxEmbedding;
        _pacParser = pacParser;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // CHUNKING
    // ──────────────────────────────────────────────────────────────────────────
    public List<string> ChunkText(string text, int chunkSize = 1000, int overlap = 200)
    {
        if (text.Length <= chunkSize) return new List<string> { text };

        var chunks = new List<string>();
        int start = 0;

        while (start < text.Length)
        {
            int end   = Math.Min(start + chunkSize, text.Length);
            var chunk = text[start..end];

            if (end < text.Length)
            {
                int lastPeriod  = chunk.LastIndexOf('.');
                int lastNewline = chunk.LastIndexOf('\n');
                int bp          = Math.Max(lastPeriod, lastNewline);
                if (bp > chunkSize / 2)
                {
                    chunk = text[start..(start + bp + 1)];
                    end   = start + bp + 1;
                }
            }

            var trimmed = chunk.Trim();
            if (!string.IsNullOrEmpty(trimmed))
                chunks.Add(trimmed);

            start = end - overlap;
        }

        return chunks;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // EMBEDDINGS  (ONNX, BGE via Python service, OR Azure OpenAI text-embedding-ada-002)
    // ──────────────────────────────────────────────────────────────────────────
    
    private bool UseOnnxEmbeddings()
    {
        var provider = _config["EMBEDDING_PROVIDER"]?.ToLower();
        return provider == "onnx" || provider == "local" || string.IsNullOrEmpty(provider);
    }

    private bool UseBgeEmbeddings()
    {
        var provider = _config["EMBEDDING_PROVIDER"]?.ToLower();
        return provider == "bge";
    }

    private string GetBgeServiceUrl()
    {
        return _config["BGE_SERVICE_URL"] ?? "http://localhost:8002";
    }

    private EmbeddingClient GetEmbeddingClient()
    {
        var apiKey   = _config["AZURE_OPENAI_API_KEY"] ?? _config["OPENAI_API_KEY"];
        var endpoint = _config["AZURE_OPENAI_ENDPOINT"];
        var embModel = _config["EMBEDDING_MODEL"] ?? "text-embedding-ada-002";

        if (!string.IsNullOrEmpty(endpoint) && _llm.IsValidApiKey(apiKey))
        {
            var azure = new AzureOpenAIClient(new Uri(endpoint), new Azure.AzureKeyCredential(apiKey!));
            return azure.GetEmbeddingClient(embModel);
        }

        if (_llm.IsValidApiKey(apiKey))
        {
            var openai = new OpenAI.OpenAIClient(apiKey);
            return openai.GetEmbeddingClient(embModel);
        }

        throw new InvalidOperationException(
            "Embedding generation requires OPENAI_API_KEY or AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT.");
    }

    public async Task<float[]> GenerateEmbeddingAsync(string text)
    {
        if (UseOnnxEmbeddings())
        {
            return await _onnxEmbedding.GenerateEmbeddingAsync(text);
        }
        
        if (UseBgeEmbeddings())
        {
            var embeddings = await GenerateBgeEmbeddingsAsync(new[] { text });
            return embeddings[0];
        }
        
        var client   = GetEmbeddingClient();
        var trimmed  = text.Length > 8000 ? text[..8000] : text;
        var response = await client.GenerateEmbeddingAsync(trimmed);
        return response.Value.ToFloats().ToArray();
    }

    public async Task<List<float[]>> GenerateEmbeddingsBatchAsync(IEnumerable<string> texts)
    {
        if (UseOnnxEmbeddings())
        {
            _logger.LogInformation("      Using ONNX embeddings (free local, all-MiniLM-L6-v2)");
            return await _onnxEmbedding.GenerateBatchEmbeddingsAsync(texts);
        }
        
        if (UseBgeEmbeddings())
        {
            _logger.LogInformation("      Using BGE embeddings (free local)");
            return await GenerateBgeEmbeddingsAsync(texts);
        }
        
        _logger.LogInformation("      Using OpenAI/Azure embeddings (cloud)");
        var client  = GetEmbeddingClient();
        var trimmed = texts.Select(t => t.Length > 8000 ? t[..8000] : t).ToList();

        var response = await client.GenerateEmbeddingsAsync(trimmed);
        return response.Value.Select(e => e.ToFloats().ToArray()).ToList();
    }

    private async Task<List<float[]>> GenerateBgeEmbeddingsAsync(IEnumerable<string> texts)
    {
        var textList = texts.ToList();
        if (textList.Count == 0)
            return new List<float[]>();

        var bgeUrl = GetBgeServiceUrl();
        const int batchSize = 100; // BGE service limit
        var allEmbeddings = new List<float[]>();

        _logger.LogInformation($"Generating {textList.Count} BGE embeddings in batches of {batchSize}");

        for (int i = 0; i < textList.Count; i += batchSize)
        {
            var batch = textList.Skip(i).Take(batchSize).ToList();
            var request = new BgeEmbedRequest { Texts = batch };
            
            try
            {
                _logger.LogInformation($"  Batch {i / batchSize + 1}/{(int)Math.Ceiling((double)textList.Count / batchSize)}: embedding {batch.Count} texts...");
                
                var response = await _httpClient.PostAsJsonAsync($"{bgeUrl}/embed", request);
                response.EnsureSuccessStatusCode();
                
                var result = await response.Content.ReadFromJsonAsync<BgeEmbedResponse>();
                if (result?.Embeddings == null || result.Embeddings.Count == 0)
                    throw new Exception("BGE service returned no embeddings");
                
                allEmbeddings.AddRange(result.Embeddings);
                _logger.LogInformation($"  ✓ Generated {result.Embeddings.Count} embeddings (dim={result.Dimension})");
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"BGE service HTTP error on batch {i / batchSize + 1}: {ex.Message}");
                throw new InvalidOperationException(
                    $"BGE embedding service error at {bgeUrl}. Check if the service is running. Error: {ex.Message}", ex);
            }
            catch (Exception ex)
            {
                _logger.LogError($"BGE embedding error on batch {i / batchSize + 1}: {ex.Message}");
                throw new InvalidOperationException(
                    $"BGE embedding failed. Error: {ex.Message}", ex);
            }
        }

        _logger.LogInformation($"✓ Total: {allEmbeddings.Count} BGE embeddings generated");
        return allEmbeddings;
    }

    // BGE service DTOs
    private class BgeEmbedRequest
    {
        [JsonPropertyName("texts")]
        public List<string> Texts { get; set; } = new();
    }

    private class BgeEmbedResponse
    {
        [JsonPropertyName("embeddings")]
        public List<float[]> Embeddings { get; set; } = new();
        
        [JsonPropertyName("model")]
        public string Model { get; set; } = "";
        
        [JsonPropertyName("dimension")]
        public int Dimension { get; set; }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // VECTOR STORAGE
    // ──────────────────────────────────────────────────────────────────────────
    public async Task<int> StoreChunksAsync(
        List<(string Content, Dictionary<string, string> Metadata)> chunks,
        string datasetId)
    {
        if (chunks.Count == 0) return 0;

        _logger.LogInformation("    → Preparing to generate embeddings for {Count} chunks...", chunks.Count);
        var texts      = chunks.Select(c => c.Content).ToList();
        var embeddings = await GenerateEmbeddingsBatchAsync(texts);
        _logger.LogInformation("    ✓ Generated all embeddings, now storing in vector database...");

        var records = chunks.Select((c, i) => new ChunkRecord(
            Id       : $"{datasetId}_{Guid.NewGuid():N}",
            Content  : c.Content,
            Metadata : c.Metadata,
            Embedding: embeddings[i]
        )).ToList();

        lock (_lock)
        {
            if (!_vectorStore.ContainsKey(datasetId))
                _vectorStore[datasetId] = new List<ChunkRecord>();

            _vectorStore[datasetId].AddRange(records);
            RebuildBm25Index(datasetId);
        }

        return records.Count;
    }

    public int GetCollectionCount(string datasetId)
    {
        lock (_lock)
            return _vectorStore.TryGetValue(datasetId, out var v) ? v.Count : 0;
    }

    public void ClearCollection(string datasetId)
    {
        lock (_lock)
        {
            _vectorStore.Remove(datasetId);
            _bm25Store.Remove(datasetId);
        }
    }

    public void ClearAll()
    {
        lock (_lock)
        {
            _vectorStore.Clear();
            _bm25Store.Clear();
        }
    }

    public void DeleteFiles(string datasetId, List<string> fileNames)
    {
        if (fileNames.Count == 0) return;
        var lower = fileNames.Select(f => f.ToLower()).ToHashSet();
        lock (_lock)
        {
            if (!_vectorStore.TryGetValue(datasetId, out var records)) return;
            _vectorStore[datasetId] = records
                .Where(r => !r.Metadata.TryGetValue("file_name", out var fn) || !lower.Contains(fn.ToLower()))
                .ToList();
            RebuildBm25Index(datasetId);
        }
    }

    public List<string> ListFiles(string datasetId)
    {
        lock (_lock)
        {
            if (!_vectorStore.TryGetValue(datasetId, out var records))
                return new List<string>();

            return records
                .Where(r => r.Metadata.ContainsKey("file_name"))
                .Select(r => r.Metadata["file_name"])
                .Distinct()
                .OrderBy(f => f)
                .ToList();
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // BM25 INDEX
    // ──────────────────────────────────────────────────────────────────────────
    private void RebuildBm25Index(string datasetId)
    {
        if (!_vectorStore.TryGetValue(datasetId, out var records) || records.Count == 0)
        {
            _bm25Store.Remove(datasetId);
            return;
        }

        _bm25Store[datasetId] = new Bm25Index(records.Select(r => r.Content).ToList());
        _logger.LogInformation("[BM25] Index rebuilt for '{DatasetId}' with {Count} docs.", datasetId, records.Count);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // RETRIEVAL
    // ──────────────────────────────────────────────────────────────────────────
    public async Task<List<RetrievedChunkInternal>> RetrieveAsync(
        string query,
        string datasetId,
        int nResults   = 5,
        double hybridWeight = 0.5,
        List<string>? focusFiles = null)
    {
        if (!_vectorStore.ContainsKey(datasetId) || _vectorStore[datasetId].Count == 0)
            return new List<RetrievedChunkInternal>();

        int nEach        = nResults * 2;
        var bm25Results  = RetrieveBm25(query, datasetId, nEach, focusFiles);
        var queryEmb     = await GenerateEmbeddingAsync(query);
        var vectorResults= RetrieveVector(queryEmb, datasetId, nEach, focusFiles);

        // Reciprocal Rank Fusion
        var scores  = new Dictionary<string, double>();
        var content = new Dictionary<string, string>();
        var meta    = new Dictionary<string, Dictionary<string, string>>();

        double bm25Weight = 1 - hybridWeight;
        for (int i = 0; i < bm25Results.Count; i++)
        {
            var r    = bm25Results[i];
            var id   = r.Id;
            scores[id]  = scores.GetValueOrDefault(id) + bm25Weight * (1.0 / (i + 60));
            content[id] = r.Content;
            meta[id]    = r.Metadata;
        }

        for (int i = 0; i < vectorResults.Count; i++)
        {
            var r    = vectorResults[i];
            var id   = r.Id;
            scores[id]  = scores.GetValueOrDefault(id) + hybridWeight * (1.0 / (i + 60));
            content[id] = r.Content;
            meta[id]    = r.Metadata;
        }

        var sorted   = scores.OrderByDescending(kv => kv.Value).Take(nResults).ToList();
        double maxSc = sorted.FirstOrDefault().Value;
        if (maxSc == 0) maxSc = 1;

        return sorted.Select(kv => new RetrievedChunkInternal(
            Id           : kv.Key,
            Content      : content[kv.Key],
            Metadata     : meta[kv.Key],
            RelevanceScore: Math.Round(kv.Value / maxSc * 100, 1),
            RetrievalMethod: "hybrid"
        )).ToList();
    }

    private List<ChunkRecord> RetrieveBm25(
        string query, string datasetId, int n, List<string>? focusFiles)
    {
        lock (_lock)
        {
            if (!_bm25Store.TryGetValue(datasetId, out var idx) || !_vectorStore.TryGetValue(datasetId, out var records))
                return new List<ChunkRecord>();

            var scores   = idx.GetScores(Tokenise(query));
            var indices  = Enumerable.Range(0, records.Count).ToList();

            if (focusFiles?.Count > 0)
            {
                var focusSet = focusFiles.Select(f => f.ToLower()).ToHashSet();
                indices = indices.Where(i =>
                    records[i].Metadata.TryGetValue("file_name", out var fn) && focusSet.Contains(fn.ToLower()))
                    .ToList();
            }

            return indices
                .Where(i => scores[i] > 0)
                .OrderByDescending(i => scores[i])
                .Take(n)
                .Select(i => records[i])
                .ToList();
        }
    }

    private List<ChunkRecord> RetrieveVector(
        float[] queryEmb, string datasetId, int n, List<string>? focusFiles)
    {
        lock (_lock)
        {
            if (!_vectorStore.TryGetValue(datasetId, out var records))
                return new List<ChunkRecord>();

            var candidates = focusFiles?.Count > 0
                ? records.Where(r => r.Metadata.TryGetValue("file_name", out var fn)
                    && focusFiles.Any(f => f.ToLower() == fn.ToLower()))
                : records;

            return candidates
                .Select(r => (Record: r, Score: CosineSimilarity(queryEmb, r.Embedding)))
                .OrderByDescending(x => x.Score)
                .Take(n)
                .Select(x => x.Record)
                .ToList();
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // LLM ANSWER GENERATION
    // ──────────────────────────────────────────────────────────────────────────
    public async Task<string> GenerateAnswerAsync(
        string query,
        List<RetrievedChunkInternal> chunks,
        string datasetMode = "generic",
        string? provider   = null,
        string? model      = null,
        string? apiKey     = null,
        string? endpoint   = null)
    {
        var contextParts = chunks.Select((c, i) =>
        {
            var src  = c.Metadata.GetValueOrDefault("source", $"Document {i + 1}");
            var body = c.Content.Length > 2000 ? c.Content[..2000] : c.Content;
            return $"[Source: {src}]\n{body}";
        });

        var context = string.Join("\n\n---\n\n", contextParts);

        var systemPrompt = datasetMode == "solution"
            ? "You are a helpful assistant that answers questions about Power Platform solutions. "
              + "Use the provided context to answer accurately. Do not list file paths."
            : "You are a general document assistant. Answer only from the provided context. "
              + "Do not assume any domain unless it appears in the sources. Do not list file paths.";

        var userPrompt = $"""
            Context from knowledge base:

            {context}

            ---

            Question: {query}

            Please provide a detailed answer based on the context above.
            """;

        return await _llm.ChatCompleteAsync(
            systemPrompt, userPrompt,
            providerOverride: provider,
            modelOverride:    model,
            apiKeyOverride:   apiKey,
            endpointOverride: endpoint);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // FULL RAG QUERY
    // ──────────────────────────────────────────────────────────────────────────
    public async Task<RagQueryResponse> QueryAsync(
        string question,
        string datasetId,
        int nResults   = 5,
        string? provider = null,
        string? model    = null,
        string? apiKey   = null,
        string? endpoint = null)
    {
        var chunks = await RetrieveAsync(question, datasetId, nResults);

        if (chunks.Count == 0)
            return new RagQueryResponse
            {
                Answer      = "No relevant documents found. Please upload and index documents first.",
                Sources     = new List<SourceReference>(),
                ChunksFound = 0
            };

        var answer = await GenerateAnswerAsync(
            question, chunks, "generic", provider, model, apiKey, endpoint);

        var sources = chunks.Select(c => new SourceReference
        {
            Source    = c.Metadata.GetValueOrDefault("source", "Unknown"),
            Relevance = c.RelevanceScore,
            Preview   = c.Content.Length > 200 ? c.Content[..200] + "..." : c.Content
        }).ToList();

        return new RagQueryResponse
        {
            Answer      = answer,
            Sources     = sources,
            ChunksFound = chunks.Count
        };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // INGESTION
    // ──────────────────────────────────────────────────────────────────────────
    public async Task<IngestResponse> IngestSolutionZipAsync(string zipPath, string datasetId)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        
        _logger.LogInformation("  → Parsing solution with PAC CLI...");
        var chunks        = ExtractChunksViaPacCli(zipPath, out var solutionName);
        _logger.LogInformation("  ✓ Extracted {Count} chunks from solution '{Name}' in {Sec:F1}s", 
            chunks.Count, solutionName, sw.Elapsed.TotalSeconds);
        
        sw.Restart();
        _logger.LogInformation("  → Generating embeddings and storing (this will take time for large solutions)...");
        var storedCount   = await StoreChunksAsync(chunks, datasetId);
        _logger.LogInformation("  ✓ Stored {Count} chunks successfully in {Sec:F1}s", 
            storedCount, sw.Elapsed.TotalSeconds);

        return new IngestResponse
        {
            Success = true,
            Message = $"Ingested '{solutionName}' with {storedCount} chunks.",
            Details = new Dictionary<string, object>
            {
                ["solution_name"]     = solutionName,
                ["chunks_stored"]     = storedCount,
                ["collection_total"]  = GetCollectionCount(datasetId)
            },
            CorpusType   = "solution_zip",
            CorpusReason = "Power Platform solution ZIP"
        };
    }

    private List<(string Content, Dictionary<string, string> Metadata)> ExtractChunksFromZip(
        string zipPath, out string solutionName)
    {
        _logger.LogInformation("    [ZIP] Opening ZIP file...");
        solutionName = "Unknown";
        var chunks = new List<(string, Dictionary<string, string>)>();

        using var zip = ZipFile.OpenRead(zipPath);
        _logger.LogInformation("    [ZIP] ZIP opened, total entries: {Count}", zip.Entries.Count);

        // Parse solution name
        _logger.LogInformation("    [ZIP] Looking for solution.xml...");
        var solEntry = zip.Entries.FirstOrDefault(e =>
            e.Name.Equals("solution.xml", StringComparison.OrdinalIgnoreCase));
        if (solEntry != null)
        {
            using var s   = solEntry.Open();
            var xDoc      = XDocument.Load(s);
            solutionName  = xDoc.Root?.Element("SolutionManifest")
                ?.Element("UniqueName")?.Value ?? "Unknown";
            _logger.LogInformation("    [ZIP] Found solution: {Name}", solutionName);
        }

        // Important directories / extensions
        var importantDirs = new[] { "Workflows", "botcomponents", "bots" };
        var rootFiles     = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            { "solution.xml", "customizations.xml", "[content_types].xml", "configuration.json" };
        var skip          = new[] { "identity.json", "BackgroundImageUri", "AdditionalUris" };
        var skipExts      = new[] { ".png", ".jpg", ".jpeg", ".gif", ".ico", ".dll", ".msapp", ".zip" };
        var includeExts   = new[] { ".xml", ".json" };

        _logger.LogInformation("    [ZIP] Processing entries...");
        int chunkId = 0;
        int processed = 0;
        foreach (var entry in zip.Entries)
        {
            processed++;
            if (processed % 100 == 0)
                _logger.LogInformation("    [ZIP] Scanned {Count}/{Total} entries, created {Chunks} chunks", 
                    processed, zip.Entries.Count, chunkId);
            
            if (entry.Length == 0) continue;

            var name = entry.FullName;
            var ext  = Path.GetExtension(name).ToLower();

            if (skipExts.Contains(ext)) continue;
            if (skip.Any(s => name.Contains(s))) continue;

            bool include = rootFiles.Contains(entry.Name)
                || importantDirs.Any(d => name.Contains(d + "/") && includeExts.Contains(ext));

            if (!include) continue;

            try
            {
                using var sr = new StreamReader(entry.Open());
                var content  = sr.ReadToEnd();

                if (content.Trim().Length < 50) continue;

                chunkId++;
                var chunkContent = $"File: {name}\nSolution: {solutionName}\n\n{(content.Length > 8000 ? content[..8000] : content)}";

                // Sub-chunk large files
                foreach (var sub in ChunkText(chunkContent, 1000, 100))
                {
                    chunks.Add((sub, new Dictionary<string, string>
                    {
                        ["source"]        = name,
                        ["file_name"]     = entry.Name,
                        ["kind"]          = "solution",
                        ["solution_name"] = solutionName,
                        ["file_type"]     = ext,
                        ["chunk_id"]      = chunkId.ToString()
                    }));
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Could not read zip entry {Name}: {Msg}", name, ex.Message);
            }
        }

        _logger.LogInformation("    [ZIP] ✓ Done processing ZIP: {Chunks} total chunks created", chunks.Count);
        return chunks;
    }

    /// <summary>
    /// Extract chunks using PAC CLI for proper Power Platform solution parsing
    /// </summary>
    private List<(string Content, Dictionary<string, string> Metadata)> ExtractChunksViaPacCli(
        string zipPath, out string solutionName)
    {
        _logger.LogInformation("    [PAC] Using PAC CLI to parse solution...");
        var chunks = new List<(string, Dictionary<string, string>)>();
        solutionName = "Unknown";

        try
        {
            // Use PAC CLI to parse the solution
            var tempDir = Path.Combine(Path.GetTempPath(), $"pac_parse_{Guid.NewGuid()}");
            Directory.CreateDirectory(tempDir);

            try
            {
                var solution = _pacParser.ParseSolution(zipPath, tempDir);
                solutionName = solution.SolutionName;
                
                _logger.LogInformation("    [PAC] ✓ Parsed solution: {Name} v{Ver} by {Pub}", 
                    solution.SolutionName, solution.Version, solution.Publisher);
                _logger.LogInformation("    [PAC] Found {Count} components", solution.Components.Count);

                // Create chunks from solution metadata
                var overviewContent = $"Solution: {solution.SolutionName}\n" +
                    $"Version: {solution.Version}\n" +
                    $"Publisher: {solution.Publisher}\n\n" +
                    $"This Power Platform solution contains {solution.Components.Count} components:\n" +
                    string.Join("\n", solution.Components.Select(c => $"- {c.Name} ({c.Type})" + (c.Description != null ? $": {c.Description}" : "")));

                chunks.Add((overviewContent, new Dictionary<string, string>
                {
                    ["source"] = "solution_metadata",
                    ["file_name"] = "overview",
                    ["kind"] = "solution",
                    ["solution_name"] = solution.SolutionName,
                    ["file_type"] = "metadata",
                    ["chunk_id"] = "0"
                }));

                // Create chunks for each component
                int chunkId = 1;
                foreach (var component in solution.Components)
                {
                    var componentContent = $"Component: {component.Name}\n" +
                        $"Type: {component.Type}\n" +
                        $"Solution: {solution.SolutionName}\n\n" +
                        $"{component.Description ?? "No description available."}\n\n" +
                        "Metadata:\n" +
                        (component.Metadata != null ? string.Join("\n", component.Metadata.Select(kv => $"{kv.Key}: {kv.Value}")) : "None");

                    chunks.Add((componentContent, new Dictionary<string, string>
                    {
                        ["source"] = $"component_{component.Name}",
                        ["file_name"] = component.Name,
                        ["kind"] = "solution",
                        ["solution_name"] = solution.SolutionName,
                        ["file_type"] = component.Type,
                        ["chunk_id"] = chunkId.ToString(),
                        ["component_type"] = component.Type
                    }));

                    chunkId++;
                }

                _logger.LogInformation("    [PAC] ✓ Created {Count} chunks from PAC CLI data", chunks.Count);
            }
            finally
            {
                // Cleanup temp directory
                if (Directory.Exists(tempDir))
                {
                    try { Directory.Delete(tempDir, true); }
                    catch { /* best effort cleanup */ }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning("PAC CLI extraction failed ({Msg}), falling back to direct ZIP parsing", ex.Message);
            return ExtractChunksFromZip(zipPath, out solutionName);
        }

        return chunks;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // RAG PIPELINE for documentation generation (rag_pipeline.py equivalent)
    // ──────────────────────────────────────────────────────────────────────────
    public async Task<string> GenerateDocumentationAsync(
        Models.ParsedSolution solution,
        string docType        = "markdown",
        string? systemPromptOverride = null,
        string? provider      = null,
        string? model         = null,
        string? userPrefs     = null,
        string? apiKey        = null,
        string? endpoint      = null)
    {
        // Default is now LLM with strict evidence guardrails.
        // Set DOC_GENERATION_MODE=deterministic to disable LLM.
        var generationMode = (_config["DOC_GENERATION_MODE"] ?? "llm").Trim().ToLowerInvariant();
        if (generationMode == "deterministic")
            return BuildDeterministicDocumentation(solution, docType, userPrefs);

        var context = BuildSolutionContext(solution);
        var prompt  = BuildDocumentationPrompt(solution, context, docType, userPrefs);
        var system  = GetDocSystemPrompt(systemPromptOverride, userPrefs);

        var usedCustom = !string.IsNullOrWhiteSpace(systemPromptOverride);
        var systemPreview = system.Length > 80 ? system.AsSpan(0, 80).ToString() + "..." : system;
        Console.WriteLine("[GenerateDocumentation] System string sent to LLM: usedCustomOverride={0}, length={1}, preview=\"{2}\"",
            usedCustom, system.Length, systemPreview.Replace("\"", "'"));

        return await _llm.ChatCompleteAsync(
            system, prompt,
            providerOverride: provider,
            modelOverride:    model,
            apiKeyOverride:   apiKey,
            endpointOverride: endpoint);
    }

    private static string BuildDeterministicDocumentation(
        Models.ParsedSolution solution,
        string docType,
        string? userPrefs)
    {
        var byType = solution.Components
            .GroupBy(c => c.Type)
            .OrderByDescending(g => g.Count())
            .ToList();

        var dataverseComponents = solution.Components
            .Where(c => c.Type == "data_source" && c.Name.Equals("Dataverse", StringComparison.OrdinalIgnoreCase)
                     || c.Type == "search_entity"
                     || c.Type == "flow_dataverse_table")
            .ToList();

        var sharePointUrls = solution.Components
            .Where(c => c.Type == "knowledge_source_item")
            .SelectMany(c =>
            {
                var urls = new List<string>();
                if (c.Metadata == null) return urls;
                if (c.Metadata.TryGetValue("web_url", out var web) && web is string wu && !string.IsNullOrWhiteSpace(wu)) urls.Add(wu);
                if (c.Metadata.TryGetValue("site_url", out var site) && site is string su && !string.IsNullOrWhiteSpace(su)) urls.Add(su);
                return urls;
            })
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"# {solution.SolutionName} - Solution Documentation");
        sb.AppendLine();
        sb.AppendLine("## Executive Summary");
        sb.AppendLine($"- Solution Name: {solution.SolutionName}");
        sb.AppendLine($"- Version: {solution.Version}");
        sb.AppendLine($"- Publisher: {solution.Publisher}");
        sb.AppendLine($"- Total Components: {solution.Components.Count}");
        sb.AppendLine($"- Dataverse: {(dataverseComponents.Count > 0 ? "Detected" : "Not found in solution export")}");
        sb.AppendLine($"- SharePoint: {(sharePointUrls.Count > 0 ? "Detected" : "Not found in solution export")}");
        sb.AppendLine();
        sb.AppendLine("## Solution Architecture");
        sb.AppendLine("Component Types:");
        foreach (var group in byType)
            sb.AppendLine($"- {group.Key}: {group.Count()}");
        sb.AppendLine();
        sb.AppendLine("## Component Catalog");
        foreach (var group in byType)
        {
            sb.AppendLine($"### {group.Key} ({group.Count()})");
            foreach (var c in group)
                sb.AppendLine($"- {c.Name}: {c.Description ?? "Not found in solution export"}");
            sb.AppendLine();
        }

        sb.AppendLine("## Data Flow");
        var flows = solution.Components.Where(c => c.Type == "cloud_flow").Select(c => c.Name).ToList();
        if (flows.Count == 0)
        {
            sb.AppendLine("- Not found in solution export");
        }
        else
        {
            sb.AppendLine($"- Cloud Flows: {string.Join(", ", flows)}");
            if (sharePointUrls.Count > 0)
                sb.AppendLine($"- SharePoint URLs: {string.Join(", ", sharePointUrls)}");
            else
                sb.AppendLine("- SharePoint URLs: Not found in solution export");
        }
        sb.AppendLine();

        sb.AppendLine("## Dependencies");
        var dependencies = new List<string>();
        if (dataverseComponents.Count > 0) dependencies.Add("Dataverse");
        if (sharePointUrls.Count > 0) dependencies.Add("SharePoint");
        var botCount = solution.Components.Count(c => c.Type is "bot" or "bot_topic" or "bot_gpt");
        if (botCount > 0) dependencies.Add("Copilot Studio");
        if (dependencies.Count == 0)
            sb.AppendLine("- Not found in solution export");
        else
            dependencies.ForEach(d => sb.AppendLine($"- {d}"));
        sb.AppendLine();

        sb.AppendLine("## Deployment Guide");
        sb.AppendLine("1. Import the solution ZIP into the target Power Platform environment.");
        sb.AppendLine("2. Configure environment variables from exported definitions.");
        sb.AppendLine("3. Validate connections, flows, and bot components.");
        sb.AppendLine("4. Test Dataverse and SharePoint data-source behavior.");
        sb.AppendLine();

        sb.AppendLine("## Troubleshooting");
        sb.AppendLine("- If a component is missing, confirm it exists in the unpacked solution folders.");
        sb.AppendLine("- If flow behavior is incorrect, inspect corresponding files in `Workflows/`.");
        sb.AppendLine("- If SharePoint links are missing, inspect `dvtablesearchs/*/dvtablesearch.xml` knowledge config.");
        sb.AppendLine();

        if (!string.IsNullOrWhiteSpace(userPrefs))
        {
            sb.AppendLine("## User Notes");
            sb.AppendLine(userPrefs);
            sb.AppendLine();
        }

        sb.AppendLine($"Generated in `{docType}` mode using deterministic extraction.");
        return sb.ToString();
    }

    private static string BuildSolutionContext(Models.ParsedSolution solution)
    {
        var byType = solution.Components
            .GroupBy(c => c.Type)
            .ToDictionary(g => g.Key, g => g.ToList());

        var sb = new System.Text.StringBuilder();
        foreach (var (type, comps) in byType)
        {
            sb.AppendLine($"\n## {type.ToUpper()}S ({comps.Count})");
            foreach (var c in comps)
            {
                sb.AppendLine($"- **{c.Name}**: {c.Description ?? "No description"}");
                if (c.Metadata != null && c.Metadata.Count > 0)
                {
                    var meta = string.Join(", ", c.Metadata.Select(kv => $"{kv.Key}={kv.Value}"));
                    sb.AppendLine($"  Metadata: {meta}");
                }
            }
        }
        return sb.ToString();
    }

    private static string BuildDocumentationPrompt(
        Models.ParsedSolution solution,
        string context,
        string docType,
        string? userPrefs)
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"Generate comprehensive {docType} documentation for this Power Platform solution:");
        sb.AppendLine();
        sb.AppendLine($"# Solution: {solution.SolutionName}");
        sb.AppendLine($"- **Version**: {solution.Version}");
        sb.AppendLine($"- **Publisher**: {solution.Publisher}");
        sb.AppendLine($"- **Total Components**: {solution.Components.Count}");
        sb.AppendLine();
        sb.AppendLine("# Components:");
        sb.AppendLine(context);
        sb.AppendLine();
        sb.AppendLine("Output requirements (show everything):");
        sb.AppendLine("1. Cover ALL component types and ALL components listed in the input.");
        sb.AppendLine("2. In Component Catalog, list every component under its exact type.");
        sb.AppendLine("3. Keep component names exact; do not rename, merge, or omit.");
        sb.AppendLine("4. Prefer concrete values from metadata (URLs, IDs, table names, connectors) when available.");
        sb.AppendLine("5. If a detail is unavailable, write: 'Not found in solution export'.");
        sb.AppendLine("6. Do not invent new systems, APIs, or architecture layers not present in the component data.");
        sb.AppendLine("7. For Dataverse/SharePoint, surface every explicit reference found in components and metadata.");
        sb.AppendLine();
        sb.AppendLine("Include:");
        sb.AppendLine("1. **Executive Summary**");
        sb.AppendLine("2. **Solution Architecture**");
        sb.AppendLine("3. **Component Catalog** (by type)");
        sb.AppendLine("4. **Data Flow**");
        sb.AppendLine("5. **Dependencies**");
        sb.AppendLine("6. **Deployment Guide**");
        sb.AppendLine("7. **Troubleshooting**");
        sb.AppendLine("8. **Mermaid Diagrams**");
        sb.AppendLine();
        sb.AppendLine("Mandatory Mermaid diagram requirements:");
        sb.AppendLine("1. Include fenced ```mermaid blocks (not images) for each required diagram.");
        sb.AppendLine("2. Provide these diagrams in order:");
        sb.AppendLine("   - System Architecture diagram (graph TD/LR).");
        sb.AppendLine("   - Data Flow diagram (graph TD/LR).");
        sb.AppendLine("   - Component Relationship diagram (graph TD/LR).");
        sb.AppendLine("   - Deployment Sequence or Pipeline diagram (sequenceDiagram or graph TD).");
        sb.AppendLine("3. Use ONLY component names/types present in the provided data.");
        sb.AppendLine("4. If evidence is missing for a connection, omit the edge instead of guessing.");
        sb.AppendLine("5. Ensure Mermaid syntax is valid and renderable.");
        sb.AppendLine();
        sb.AppendLine("Output format template (use exactly these top-level headings):");
        sb.AppendLine("# Solution Documentation");
        sb.AppendLine("## Executive Summary");
        sb.AppendLine("## Solution Architecture");
        sb.AppendLine("## Component Catalog");
        sb.AppendLine("## Data Flow");
        sb.AppendLine("## Dependencies");
        sb.AppendLine("## Deployment Guide");
        sb.AppendLine("## Troubleshooting");
        sb.AppendLine("## Mermaid Diagrams");
        sb.AppendLine();
        sb.AppendLine($"Format as {docType}.");

        if (!string.IsNullOrEmpty(userPrefs))
        {
            sb.AppendLine();
            sb.AppendLine("USER'S REQUESTS:");
            sb.AppendLine(userPrefs);
        }

        return sb.ToString();
    }

    private static string GetDocSystemPrompt(string? systemPromptOverride, string? userPrefs)
    {
        var base_ = !string.IsNullOrWhiteSpace(systemPromptOverride)
            ? systemPromptOverride.Trim()
            : "You are a technical documentation assistant for Microsoft Power Platform solutions. "
              + "Produce comprehensive documentation that is exhaustive and component-driven. "
              + "Every component provided must appear in the output under the correct type. "
              + "Use only provided component evidence and metadata; if a detail is missing, write 'Not found in solution export'. "
              + "Never omit component types, and preserve exact component names. "
              + "Mermaid diagrams are mandatory and must be valid fenced mermaid code blocks.";

        if (!string.IsNullOrEmpty(userPrefs))
            base_ += $"\n\nUSER INSTRUCTIONS:\n{userPrefs}\n\nFollow them precisely.";

        return base_;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // MATH HELPERS
    // ──────────────────────────────────────────────────────────────────────────
    private static double CosineSimilarity(float[] a, float[] b)
    {
        if (a.Length != b.Length) return 0;
        double dot = 0, magA = 0, magB = 0;
        for (int i = 0; i < a.Length; i++)
        {
            dot  += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }
        double denom = Math.Sqrt(magA) * Math.Sqrt(magB);
        return denom == 0 ? 0 : dot / denom;
    }

    private static List<string> Tokenise(string text) =>
        Regex.Matches(text.ToLower(), @"\b\w+\b")
             .Select(m => m.Value)
             .ToList();

    // ──────────────────────────────────────────────────────────────────────────
    // INNER TYPES
    // ──────────────────────────────────────────────────────────────────────────
    private record ChunkRecord(
        string Id,
        string Content,
        Dictionary<string, string> Metadata,
        float[] Embedding);

    public record RetrievedChunkInternal(
        string Id,
        string Content,
        Dictionary<string, string> Metadata,
        double RelevanceScore,
        string RetrievalMethod);

    /// <summary>BM25-Okapi implementation (no external dependency needed)</summary>
    private sealed class Bm25Index
    {
        private readonly List<List<string>> _tokenizedDocs;
        private readonly Dictionary<string, double> _idf = new();
        private readonly double[] _docLengths;
        private readonly double _avgDocLength;
        private const double K1 = 1.5, B = 0.75;

        public Bm25Index(IEnumerable<string> documents)
        {
            _tokenizedDocs = documents.Select(Tokenise).ToList();
            _docLengths    = _tokenizedDocs.Select(d => (double)d.Count).ToArray();
            _avgDocLength  = _docLengths.Length > 0 ? _docLengths.Average() : 1;
            BuildIdf();
        }

        private void BuildIdf()
        {
            int N = _tokenizedDocs.Count;
            var df = new Dictionary<string, int>();
            foreach (var doc in _tokenizedDocs)
                foreach (var term in doc.Distinct())
                    df[term] = df.GetValueOrDefault(term) + 1;

            foreach (var (term, count) in df)
                _idf[term] = Math.Log((N - count + 0.5) / (count + 0.5) + 1);
        }

        public double[] GetScores(List<string> query)
        {
            var scores = new double[_tokenizedDocs.Count];
            for (int di = 0; di < _tokenizedDocs.Count; di++)
            {
                var termFreq = _tokenizedDocs[di]
                    .GroupBy(t => t)
                    .ToDictionary(g => g.Key, g => (double)g.Count());

                double docLen = _docLengths[di];
                foreach (var term in query)
                {
                    if (!_idf.TryGetValue(term, out double idfVal)) continue;
                    double tf   = termFreq.GetValueOrDefault(term);
                    double norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * docLen / _avgDocLength));
                    scores[di] += idfVal * norm;
                }
            }
            return scores;
        }
    }
}
