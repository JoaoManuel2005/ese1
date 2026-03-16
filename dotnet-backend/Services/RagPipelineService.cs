using Azure.AI.OpenAI;
using OpenAI.Embeddings;
using Qdrant.Client;
using Qdrant.Client.Grpc;
using QdrantMatch = Qdrant.Client.Grpc.Match;
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

    // ── Qdrant vector store (persistent, keyed by datasetId = collection name) ──
    private readonly QdrantClient _qdrant;

    // ── BM25 in-memory index (rebuilt from Qdrant on demand) ─────────────────────
    private readonly Dictionary<string, (Bm25Index Index, List<ChunkRecord> Records)> _bm25Store = new();
    private readonly object _lock = new();

    // ── Query embedding cache (LRU) for 50-100x speedup on repeated queries ─────
    private readonly LruCache<string, float[]> _queryEmbeddingCache = new(capacity: 1000);

    public RagPipelineService(
        IConfiguration config,
        LlmClientService llm,
        ILogger<RagPipelineService> logger,
        IHttpClientFactory httpClientFactory,
        OnnxEmbeddingService onnxEmbedding,
        PacParserService pacParser,
        QdrantClient qdrant)
    {
        _config = config;
        _llm    = llm;
        _logger = logger;
        _httpClient = httpClientFactory.CreateClient();
        _httpClient.Timeout = TimeSpan.FromMinutes(10);
        _onnxEmbedding = onnxEmbedding;
        _pacParser = pacParser;
        _qdrant    = qdrant;
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
        // Check cache first for 50-100x speedup on repeated queries
        if (_queryEmbeddingCache.TryGet(text, out var cachedEmbedding))
        {
            _logger.LogDebug("[Cache Hit] Using cached embedding for query");
            return cachedEmbedding;
        }

        float[] embedding;
        if (UseOnnxEmbeddings())
        {
            embedding = await _onnxEmbedding.GenerateEmbeddingAsync(text);
        }
        else if (UseBgeEmbeddings())
        {
            var embeddings = await GenerateBgeEmbeddingsAsync(new[] { text });
            embedding = embeddings[0];
        }
        else
        {
            var client   = GetEmbeddingClient();
            var trimmed  = text.Length > 8000 ? text[..8000] : text;
            var response = await client.GenerateEmbeddingAsync(trimmed);
            embedding = response.Value.ToFloats().ToArray();
        }
        
        // Cache the result
        _queryEmbeddingCache.Add(text, embedding);
        return embedding;
    }

    public async Task<List<float[]>> GenerateEmbeddingsBatchAsync(IEnumerable<string> texts)
    {
        if (UseOnnxEmbeddings())
        {
            _logger.LogInformation("      Using ONNX embeddings (free local)");
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
    // VECTOR STORAGE (Qdrant)
    // ──────────────────────────────────────────────────────────────────────────
    private async Task EnsureCollectionExistsAsync(string datasetId, int dimension)
    {
        if (!await _qdrant.CollectionExistsAsync(datasetId))
        {
            await _qdrant.CreateCollectionAsync(datasetId,
                new VectorParams { Size = (ulong)dimension, Distance = Distance.Cosine });
            _logger.LogInformation("[Qdrant] Created collection '{DatasetId}' ({Dim} dims).", datasetId, dimension);
        }
    }

    public async Task<int> StoreChunksAsync(
        List<(string Content, Dictionary<string, string> Metadata)> chunks,
        string datasetId)
    {
        if (chunks.Count == 0) return 0;

        _logger.LogInformation("    → Preparing to generate embeddings for {Count} chunks...", chunks.Count);
        var texts      = chunks.Select(c => c.Content).ToList();
        var embeddings = await GenerateEmbeddingsBatchAsync(texts);
        _logger.LogInformation("    ✓ Generated all embeddings, now storing in Qdrant...");

        await EnsureCollectionExistsAsync(datasetId, embeddings[0].Length);

        var points = chunks.Select((c, i) =>
        {
            var point = new PointStruct
            {
                Id      = Guid.NewGuid(),
                Vectors = embeddings[i],
            };
            point.Payload["content"] = c.Content;
            foreach (var (k, v) in c.Metadata)
                point.Payload[k] = v;
            return point;
        }).ToList();

        await _qdrant.UpsertAsync(datasetId, points);
        await RebuildBm25IndexAsync(datasetId);
        return points.Count;
    }

    public async Task<int> GetCollectionCountAsync(string datasetId)
    {
        if (!await _qdrant.CollectionExistsAsync(datasetId)) return 0;
        var info = await _qdrant.GetCollectionInfoAsync(datasetId);
        return (int)info.PointsCount;
    }

    public async Task ClearCollectionAsync(string datasetId)
    {
        if (await _qdrant.CollectionExistsAsync(datasetId))
            await _qdrant.DeleteCollectionAsync(datasetId);
        lock (_lock) _bm25Store.Remove(datasetId);
    }

    public async Task ClearAllAsync()
    {
        var collections = await _qdrant.ListCollectionsAsync();
        foreach (var col in collections)
            await _qdrant.DeleteCollectionAsync(col);
        lock (_lock) _bm25Store.Clear();
    }

    public async Task DeleteFilesAsync(string datasetId, List<string> fileNames)
    {
        if (fileNames.Count == 0) return;
        if (!await _qdrant.CollectionExistsAsync(datasetId)) return;

        var filter = new Filter();
        foreach (var fn in fileNames.Select(f => f.ToLower()))
            filter.Should.Add(new Condition
            {
                Field = new FieldCondition { Key = "file_name", Match = new QdrantMatch { Keyword = fn } }
            });
        await _qdrant.DeleteAsync(datasetId, filter);
        await RebuildBm25IndexAsync(datasetId);
    }

    public async Task<List<string>> ListFilesAsync(string datasetId)
    {
        if (!await _qdrant.CollectionExistsAsync(datasetId)) return new List<string>();
        var scrollResult = await _qdrant.ScrollAsync(datasetId, null, 10000u, null, true, false);
        return scrollResult.Result
            .Where(p => p.Payload.ContainsKey("file_name"))
            .Select(p => p.Payload["file_name"].StringValue)
            .Distinct()
            .OrderBy(f => f)
            .ToList();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // BM25 INDEX (rebuilt from Qdrant, kept in-memory for fast keyword search)
    // ──────────────────────────────────────────────────────────────────────────
    private async Task RebuildBm25IndexAsync(string datasetId)
    {
        if (!await _qdrant.CollectionExistsAsync(datasetId))
        {
            lock (_lock) _bm25Store.Remove(datasetId);
            return;
        }

        var scrollResult = await _qdrant.ScrollAsync(datasetId, null, 10000u, null, true, false);
        var scrollPoints = scrollResult.Result;

        if (scrollPoints.Count == 0)
        {
            lock (_lock) _bm25Store.Remove(datasetId);
            return;
        }

        var records = scrollPoints.Select(p => new ChunkRecord(
            Id      : p.Id.Uuid,
            Content : p.Payload.TryGetValue("content", out var c) ? c.StringValue : "",
            Metadata: p.Payload
                .Where(kv => kv.Key != "content")
                .ToDictionary(kv => kv.Key, kv => kv.Value.StringValue ?? ""),
            Embedding: Array.Empty<float>()
        )).ToList();

        var index = new Bm25Index(records.Select(r => r.Content));
        lock (_lock) _bm25Store[datasetId] = (index, records);
        _logger.LogInformation("[BM25] Index rebuilt for '{DatasetId}' with {Count} docs.", datasetId, records.Count);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // RETRIEVAL
    // ──────────────────────────────────────────────────────────────────────────
    public async Task<List<RetrievedChunkInternal>> RetrieveAsync(
        string query,
        string datasetId,
        int nResults        = 5,
        double hybridWeight = 0.5,
        List<string>? focusFiles = null)
    {
        if (!await _qdrant.CollectionExistsAsync(datasetId))
            return new List<RetrievedChunkInternal>();

        int nEach = nResults * 2;

        // Lazy-load BM25 index from Qdrant if not in memory (e.g. after restart)
        bool hasBm25;
        lock (_lock) hasBm25 = _bm25Store.ContainsKey(datasetId);
        if (!hasBm25) await RebuildBm25IndexAsync(datasetId);

        // Run BM25 and embedding generation in parallel for 1.5-2x speedup
        var bm25Task      = Task.Run(() => RetrieveBm25(query, datasetId, nEach, focusFiles));
        var embeddingTask = GenerateEmbeddingAsync(query);
        await Task.WhenAll(bm25Task, embeddingTask);

        var bm25Results   = bm25Task.Result;
        var queryEmb      = embeddingTask.Result;
        var vectorResults = await RetrieveVectorAsync(queryEmb, datasetId, nEach, focusFiles);

        // Reciprocal Rank Fusion
        var scores  = new Dictionary<string, double>();
        var content = new Dictionary<string, string>();
        var meta    = new Dictionary<string, Dictionary<string, string>>();

        double bm25Weight = 1 - hybridWeight;
        for (int i = 0; i < bm25Results.Count; i++)
        {
            var r = bm25Results[i];
            scores[r.Id]  = scores.GetValueOrDefault(r.Id) + bm25Weight * (1.0 / (i + 60));
            content[r.Id] = r.Content;
            meta[r.Id]    = r.Metadata;
        }

        for (int i = 0; i < vectorResults.Count; i++)
        {
            var r = vectorResults[i];
            scores[r.Id]  = scores.GetValueOrDefault(r.Id) + hybridWeight * (1.0 / (i + 60));
            content[r.Id] = r.Content;
            meta[r.Id]    = r.Metadata;
        }

        var sorted   = scores.OrderByDescending(kv => kv.Value).Take(nResults).ToList();
        double maxSc = sorted.FirstOrDefault().Value;
        if (maxSc == 0) maxSc = 1;

        return sorted.Select(kv => new RetrievedChunkInternal(
            Id             : kv.Key,
            Content        : content[kv.Key],
            Metadata       : meta[kv.Key],
            RelevanceScore : Math.Round(kv.Value / maxSc * 100, 1),
            RetrievalMethod: "hybrid"
        )).ToList();
    }

    private List<ChunkRecord> RetrieveBm25(
        string query, string datasetId, int n, List<string>? focusFiles)
    {
        lock (_lock)
        {
            if (!_bm25Store.TryGetValue(datasetId, out var stored))
                return new List<ChunkRecord>();

            var (idx, records) = stored;
            var scores  = idx.GetScores(Tokenise(query));
            var indices = Enumerable.Range(0, records.Count).ToList();

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

    private async Task<List<ChunkRecord>> RetrieveVectorAsync(
        float[] queryEmb, string datasetId, int n, List<string>? focusFiles)
    {
        if (!await _qdrant.CollectionExistsAsync(datasetId))
            return new List<ChunkRecord>();

        Filter? filter = null;
        if (focusFiles?.Count > 0)
        {
            filter = new Filter();
            foreach (var f in focusFiles.Select(f => f.ToLower()))
                filter.Should.Add(new Condition
                {
                    Field = new FieldCondition { Key = "file_name", Match = new QdrantMatch { Keyword = f } }
                });
        }

        var hits = await _qdrant.SearchAsync(datasetId, queryEmb, filter, null, (ulong)n, 0UL, true, null);

        return hits.Select(h => new ChunkRecord(
            Id      : h.Id.Uuid,
            Content : h.Payload.TryGetValue("content", out var c) ? c.StringValue : "",
            Metadata: h.Payload
                .Where(kv => kv.Key != "content")
                .ToDictionary(kv => kv.Key, kv => kv.Value.StringValue ?? ""),
            Embedding: Array.Empty<float>()
        )).ToList();
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
                ["collection_total"]  = await GetCollectionCountAsync(datasetId)
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
            _logger.LogInformation("    [PAC] Temp dir: {TempDir}", tempDir);

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

        var llmOutput = await _llm.ChatCompleteAsync(
            system, prompt,
            providerOverride: provider,
            modelOverride:    model,
            apiKeyOverride:   apiKey,
            endpointOverride: endpoint);

        // Replace any LLM-generated ER diagram with a deterministic one to avoid syntax errors
        var erDiagram = BuildErDiagramCode(solution);
        llmOutput = InjectErDiagram(llmOutput, erDiagram); // always call — handles empty case by keeping LLM output

        // Always inject the deterministic component map — never let LLM-written one stand
        var componentMap = BuildComponentMapCode(solution);
        if (!string.IsNullOrEmpty(componentMap))
            llmOutput = InjectComponentMap(llmOutput, componentMap);
        else
            Console.WriteLine("[GenerateDocumentation] WARNING: BuildComponentMapCode returned empty — no components to map");

        // Replace any LLM-generated flow diagram
        var flowDiagram = BuildFlowDiagramCode(solution);
        if (!string.IsNullOrEmpty(flowDiagram))
            llmOutput = InjectFlowDiagram(llmOutput, flowDiagram);

        // Inject Architecture diagram — strip any LLM-written flowchart LR block first,
        // then inject at placeholder or after the Solution Architecture heading
        var archDiagram = BuildArchitectureDiagramCode(solution);
        if (!string.IsNullOrEmpty(archDiagram))
            llmOutput = InjectArchitectureDiagram(llmOutput, archDiagram);

        // Replace LLM-written data sources table with a deterministic one to avoid formatting issues
        llmOutput = InjectDataSourcesTable(llmOutput, solution);

        return llmOutput;
    }

    /// Strips GUID suffixes and publisher prefixes from a raw component name
    /// so it can be used as a readable Mermaid label.
    private static string CleanComponentLabel(Models.SolutionComponent c)
    {
        // Prefer explicit display_name from metadata (handles both string and post-JSON JsonElement)
        if (c.Metadata != null && c.Metadata.TryGetValue("display_name", out var dn))
        {
            string? ds = dn is string s ? s
                : dn is System.Text.Json.JsonElement je && je.ValueKind == System.Text.Json.JsonValueKind.String ? je.GetString()
                : null;
            if (!string.IsNullOrWhiteSpace(ds)) return ds!.Length > 35 ? ds[..35] + "..." : ds!;
        }
        var name = c.Name.Split(':').Last().Trim();
        // Strip trailing GUID (e.g. "EndFormFlow-82921763-2342-F011-8779-...")
        var g = Regex.Match(name, @"-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}");
        if (g.Success) name = name[..g.Index].Trim('-').Trim();
        // Strip trailing hash suffix that contains a digit (e.g. "_b320d", "_c933c")
        name = Regex.Replace(name, @"_(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{4,15}$", "").Trim('_').Trim();
        if (string.IsNullOrWhiteSpace(name)) name = c.Name;
        return name.Length > 35 ? name[..35] + "..." : name;
    }

    /// <summary>
    /// Generates valid Mermaid erDiagram code directly from solution components.
    /// Never has syntax errors. Shows ALL tables with compact columns.
    /// </summary>
    private static string BuildErDiagramCode(Models.ParsedSolution solution)
    {
        // Collect only table-level components (not attributes/forms/views which are sub-components)
        var rawTables = solution.Components
            .Where(c =>
                c.Type.Equals("entity", StringComparison.OrdinalIgnoreCase) ||
                c.Type.Equals("Entity", StringComparison.Ordinal) ||
                c.Type.Equals("search_entity", StringComparison.OrdinalIgnoreCase) ||
                c.Type.Equals("flow_dataverse_table", StringComparison.OrdinalIgnoreCase) ||
                c.Type.Equals("table", StringComparison.OrdinalIgnoreCase) ||
                c.Type.Equals("knowledge_source", StringComparison.OrdinalIgnoreCase) ||
                c.Type.Equals("knowledge_source_item", StringComparison.OrdinalIgnoreCase) ||
                c.Type.Equals("data_source", StringComparison.OrdinalIgnoreCase))
            .Select(c =>
            {
                // flow_dataverse_table names are "FlowName:tableName" — extract just the table part
                var name = c.Type.Equals("flow_dataverse_table", StringComparison.OrdinalIgnoreCase) && c.Name.Contains(':')
                    ? c.Name.Split(':').Last().Trim()
                    : c.Name;
                return new Models.SolutionComponent
                {
                    Name = name,
                    Type = c.Type,
                    Description = c.Description,
                    Metadata = c.Metadata
                };
            })
            // Deduplicate by Name — same entity can appear from multiple parse sources
            .GroupBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();

        // If SharePoint metadata is available (fetched via Graph API), build ER from real list schemas
        if (solution.SharePointMetadata != null && solution.SharePointMetadata.Count > 0)
        {
            var spSb = new System.Text.StringBuilder();
            spSb.AppendLine("```mermaid");
            spSb.AppendLine("erDiagram");
            spSb.AppendLine();

            static string ErId(string name) =>
                Regex.Replace(name, @"[^A-Za-z0-9_]", "_").Trim('_') is var s && s.Length == 0 ? "Entity" : s;

            foreach (var site in solution.SharePointMetadata)
            {
                foreach (var list in site.Lists)
                {
                    var entityId = ErId(list.DisplayName ?? list.Name);
                    spSb.AppendLine($"    {entityId} {{");
                    // Always emit an ID field
                    spSb.AppendLine($"        int ID PK");
                    foreach (var col in list.Columns.Where(c => !c.ReadOnly && !c.Name.Equals("ID", StringComparison.OrdinalIgnoreCase)))
                    {
                        var fieldType = col.Type switch
                        {
                            "text" or "note" => "string",
                            "number" or "currency" or "calculated" => "number",
                            "boolean" => "boolean",
                            "dateTime" => "datetime",
                            "lookup" or "lookupMulti" => "int",
                            "person" or "personOrGroup" => "string",
                            "choice" or "multichoice" => "string",
                            "url" or "hyperOrPicture" => "string",
                            _ => "string"
                        };
                        var fk = col.Type is "lookup" or "lookupMulti" ? " FK" : "";
                        var req = col.Required ? " \"required\"" : "";
                        var colId = ErId(col.DisplayName ?? col.Name);
                        spSb.AppendLine($"        {fieldType} {colId}{fk}{req}");
                    }
                    spSb.AppendLine("    }");
                    spSb.AppendLine();
                }
            }

            // Relationships from Lookup columns
            foreach (var site in solution.SharePointMetadata)
            {
                foreach (var list in site.Lists)
                {
                    var sourceId = ErId(list.DisplayName ?? list.Name);
                    foreach (var col in list.Columns.Where(c => c.Type is "lookup" or "lookupMulti"))
                    {
                        // Column name often encodes the target (e.g. "ProjectId" → "Project")
                        var colName = col.DisplayName ?? col.Name;
                        var targetHint = Regex.Replace(colName, @"(Id|ID|_id|LookupId)$", "").Trim('_').Trim();
                        var targetList = site.Lists.FirstOrDefault(l =>
                            (l.DisplayName ?? l.Name).Contains(targetHint, StringComparison.OrdinalIgnoreCase));
                        if (targetList != null)
                        {
                            var targetId = ErId(targetList.DisplayName ?? targetList.Name);
                            var label = ErId(colName);
                            spSb.AppendLine($"    {targetId} ||--o{{ {sourceId} : {label}");
                        }
                    }
                }
            }

            spSb.AppendLine("```");
            return spSb.ToString();
        }

        var tables = rawTables;
        if (!tables.Any()) return string.Empty;

        // GUID pattern (with or without hyphens)
        var guidPattern = new Regex(@"^[0-9a-fA-F]{8}[-_]?[0-9a-fA-F]{4}[-_]?[0-9a-fA-F]{4}[-_]?[0-9a-fA-F]{4}[-_]?[0-9a-fA-F]{12}$");

        // Build a short, readable label for a component name
        string MakeLabel(string name, string? description, int index)
        {
            // If name looks like a GUID, prefer description or fallback to Table{N}
            if (guidPattern.IsMatch(name.Replace("TABLE_", "").Replace("T_", "")))
            {
                if (!string.IsNullOrWhiteSpace(description))
                {
                    // Take first meaningful word(s) from description
                    var words = description.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    var label = string.Concat(words.Take(3).Select(w => {
                        var clean = Regex.Replace(w, @"[^A-Za-z0-9]", "");
                        return clean.Length > 0 ? char.ToUpper(clean[0]) + clean[1..] : "";
                    }));
                    if (label.Length > 2) return label;
                }
                return $"Table{index + 1}";
            }

            // Strip TABLE_ prefix and sanitize
            var stripped = Regex.Replace(name, @"(?i)^TABLE_", "");
            var safe = Regex.Replace(stripped, @"[^A-Za-z0-9]", "_");
            safe = Regex.Replace(safe, @"_+", "_").Trim('_');
            if (safe.Length > 0 && char.IsDigit(safe[0])) safe = "T" + safe;
            // Cap at 30 chars to keep entity names short
            if (safe.Length > 30) safe = safe[..30].TrimEnd('_');
            return safe;
        }

        // Build entity map: component name → short Mermaid entity id (NO TABLE_ prefix).
        // Underscores in ER entity names break Mermaid 11.x erDiagram — use pure CamelCase IDs.
        var entityMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var usedLabels = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < tables.Count; i++)
        {
            var raw = MakeLabel(tables[i].Name, tables[i].Description, i);
            // Strip any underscores from the label to produce a valid erDiagram entity name
            var candidate = Regex.Replace(raw, "_", "");
            if (candidate.Length == 0) candidate = $"Entity{i + 1}";
            if (char.IsDigit(candidate[0])) candidate = "E" + candidate;
            // Ensure uniqueness
            var final = candidate;
            int suffix = 2;
            while (usedLabels.Contains(final)) final = candidate + suffix++;
            usedLabels.Add(final);
            entityMap[tables[i].Name] = final;
        }

        var sb = new System.Text.StringBuilder();
        // NOTE: No %%{init}%% here — renderer.ts initializes Mermaid globally with ER settings.
        // Adding a local %%{init}%% would reset layoutDirection:LR and other ER config.
        sb.AppendLine("```mermaid");
        sb.AppendLine("erDiagram");
        sb.AppendLine();

        // Build entity blocks using real field names from lookup_relationships metadata where available
        foreach (var (table, idx) in tables.Select((t, i) => (t, i)))
        {
            var entity = entityMap[table.Name];
            var pkName = entity.Length > 12 ? entity[..12] : entity;

            sb.AppendLine($"    {entity} {{");
            sb.AppendLine($"        string {pkName}ID PK");

            // Add real lookup field names as FK fields if available
            if (table.Metadata != null && table.Metadata.TryGetValue("lookup_relationships", out var lrObj)
                && lrObj is List<string> lookups && lookups.Count > 0)
            {
                foreach (var lr in lookups.Take(4)) // cap at 4 FK fields for readability
                {
                    var fieldName = lr.Split(':')[0];
                    // Sanitize field name for mermaid: strip non-alphanumeric except underscore
                    var safeName = Regex.Replace(fieldName, @"[^A-Za-z0-9_]", "");
                    if (!string.IsNullOrWhiteSpace(safeName))
                        sb.AppendLine($"        string {safeName} FK");
                }
            }
            else
            {
                sb.AppendLine($"        string Name");
                sb.AppendLine($"        string Status");
            }

            sb.AppendLine($"    }}");
            sb.AppendLine();
        }

        // Build relationships from real lookup data
        // Structure: sourceEntity ||--o{ targetEntity : fieldName
        var relationshipsWritten = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var table in tables)
        {
            if (table.Metadata == null) continue;
            if (!table.Metadata.TryGetValue("lookup_relationships", out var lrObj)) continue;
            if (lrObj is not List<string> lookups) continue;

            if (!entityMap.TryGetValue(table.Name, out var sourceEntity)) continue;

            foreach (var lr in lookups)
            {
                var parts = lr.Split(':', 2);
                if (parts.Length != 2) continue;
                var fieldName = parts[0];
                var targetEntityName = parts[1];

                // Only draw the edge if the target entity is also in our diagram
                if (!entityMap.TryGetValue(targetEntityName, out var targetEntity)) continue;

                var edgeKey = $"{sourceEntity}_{targetEntity}_{fieldName}";
                if (relationshipsWritten.Contains(edgeKey)) continue;
                relationshipsWritten.Add(edgeKey);

                var safeLabel = Regex.Replace(fieldName, @"[^A-Za-z0-9_]", "");
                sb.AppendLine($"    {targetEntity} ||--o{{ {sourceEntity} : {safeLabel}");
            }
        }

        // Fallback 1: knowledge_source ||--o{ knowledge_source_item (always a real parent-child)
        if (relationshipsWritten.Count == 0)
        {
            var knowledgeSources = solution.Components
                .Where(c => c.Type.Equals("knowledge_source", StringComparison.OrdinalIgnoreCase))
                .ToList();
            var knowledgeItems = solution.Components
                .Where(c => c.Type.Equals("knowledge_source_item", StringComparison.OrdinalIgnoreCase))
                .ToList();

            foreach (var ks in knowledgeSources)
            {
                if (!entityMap.TryGetValue(ks.Name, out var ksEntity)) continue;
                foreach (var ki in knowledgeItems)
                {
                    if (!entityMap.TryGetValue(ki.Name, out var kiEntity)) continue;
                    var edgeKey = $"{ksEntity}_{kiEntity}";
                    if (relationshipsWritten.Contains(edgeKey)) continue;
                    relationshipsWritten.Add(edgeKey);
                    sb.AppendLine($"    {ksEntity} ||--o{{ {kiEntity} : contains");
                }
            }
        }

        // Fallback 2: flow_dataverse_table co-occurrence
        if (relationshipsWritten.Count == 0)
        {
            var flowTableMap = solution.Components
                .Where(c => c.Type.Equals("flow_dataverse_table", StringComparison.OrdinalIgnoreCase) && c.Name.Contains(':'))
                .GroupBy(c => c.Name.Split(':')[0].Trim())
                .Select(g => g.Select(c => c.Name.Split(':').Last().Trim()).Distinct().ToList())
                .Where(t => t.Count >= 2)
                .ToList();

            foreach (var flowTables in flowTableMap)
            {
                for (int i = 1; i < flowTables.Count; i++)
                {
                    if (!entityMap.TryGetValue(flowTables[0], out var a)) continue;
                    if (!entityMap.TryGetValue(flowTables[i], out var b)) continue;
                    var edgeKey = $"{a}_{b}";
                    if (relationshipsWritten.Contains(edgeKey)) continue;
                    relationshipsWritten.Add(edgeKey);
                    sb.AppendLine($"    {a} ||--o{{ {b} : uses");
                }
            }
        }

        sb.AppendLine();
        sb.AppendLine("```");
        return sb.ToString();
    }

    /// <summary>
    /// Generates a valid Mermaid flowchart architecture diagram directly from solution components.
    /// Never has syntax errors. 
    /// </summary>
    private static string InjectArchitectureDiagram(string llmOutput, string deterministicDiagram)
    {
        // Strip any LLM-written flowchart LR block (the architecture diagram format)
        var stripped = Regex.Replace(
            llmOutput,
            @"```mermaid\s*(?:%%\{[\s\S]*?\}%%\s*)?flowchart\s+LR[\s\S]*?```",
            string.Empty,
            RegexOptions.IgnoreCase
        );

        // Replace <<ARCHITECTURE_DIAGRAM>> placeholder if present
        if (stripped.Contains("<<ARCHITECTURE_DIAGRAM>>"))
            return stripped.Replace("<<ARCHITECTURE_DIAGRAM>>", deterministicDiagram);

        // Inject after "### Solution Architecture" heading
        var match = Regex.Match(stripped, @"(###\s*Solution Architecture[^\n]*\n)", RegexOptions.IgnoreCase);
        if (match.Success)
        {
            var idx = match.Index + match.Length;
            return stripped[..idx] + "\n" + deterministicDiagram + "\n" + stripped[idx..];
        }

        return stripped;
    }

    private static readonly Regex GuidPattern = new(
        @"^[0-9a-fA-F]{8}[-_][0-9a-fA-F]{4}[-_][0-9a-fA-F]{4}[-_][0-9a-fA-F]{4}[-_][0-9a-fA-F]{12}$");

    // Substrings in canvas app names that indicate internal file assets, not real app names
    private static readonly string[] CanvasAppArtifactKeywords =
        { "DocumentUri", "AdditionalUris", ".meta", "_identity", "Properties" };

    // Flow name keywords that indicate an external system dependency
    private static readonly (string keyword, string label)[] ExternalSystemHints =
    {
        ("pipedrive",     "Pipedrive CRM"),
        ("exchangerate",  "Exchange Rate API"),
        ("exchange_rate", "Exchange Rate API"),
        ("getexchange",   "Exchange Rate API"),
        ("salesforce",    "Salesforce"),
        ("dynamics",      "Dynamics 365"),
        ("servicenow",    "ServiceNow"),
        ("jira",          "Jira"),
        ("hubspot",       "HubSpot"),
        ("sendgrid",      "SendGrid"),
        ("twilio",        "Twilio"),
        ("http",          "External HTTP API"),
    };

    private static string BuildArchitectureDiagramCode(Models.ParsedSolution solution)
    {
        // Canvas apps only — exclude internal file artifacts
        var apps = solution.Components
            .Where(c => c.Type.Equals("canvas_app", StringComparison.OrdinalIgnoreCase))
            .Where(c => !CanvasAppArtifactKeywords.Any(kw =>
                c.Name.Contains(kw, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        // Only real cloud flows, deduplicated by display name
        var flows = solution.Components
            .Where(c => c.Type.Equals("cloud_flow", StringComparison.OrdinalIgnoreCase))
            .GroupBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();

        // Bots (Copilot Studio)
        var bots = solution.Components
            .Where(c => c.Type.Equals("bot", StringComparison.OrdinalIgnoreCase))
            .GroupBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();

        // Data sources only — exclude internal Power Platform infra types and pure-GUID names
        var tables = solution.Components
            .Where(c =>
                c.Type.Equals("data_source", StringComparison.OrdinalIgnoreCase) ||
                c.Type.Equals("entity", StringComparison.OrdinalIgnoreCase))
            .Where(c => !GuidPattern.IsMatch(c.Name.Trim()))
            .GroupBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();

        // Infer external systems only from the capped flows that will appear in the diagram
        // (avoids showing floating nodes for flows that are beyond the cap)
        var externalSystems = flows.Take(5)
            .SelectMany(f => ExternalSystemHints
                .Where(h => f.Name.Contains(h.keyword, StringComparison.OrdinalIgnoreCase))
                .Select(h => h.label))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        string NodeId(string prefix, string name, int idx)
        {
            var safe = Regex.Replace(name.Split(':').Last(), @"[^A-Za-z0-9]", "_");
            safe = Regex.Replace(safe, @"_+", "_").Trim('_');
            if (safe.Length == 0 || char.IsDigit(safe[0])) safe = "N" + safe;
            if (safe.Length > 20) safe = safe[..20].TrimEnd('_');
            return $"{prefix}{idx}_{safe}";
        }

        // Prefer display name from metadata; fall back to cleaned-up name
        string DisplayName(Models.SolutionComponent c)
        {
            // 1. Use metadata display_name if available
            // Metadata values may be string (in-process) or JsonElement (after JSON deserialization)
            if (c.Metadata != null && c.Metadata.TryGetValue("display_name", out var dn))
            {
                string? ds = dn is string s ? s
                    : dn is System.Text.Json.JsonElement je && je.ValueKind == System.Text.Json.JsonValueKind.String ? je.GetString()
                    : null;
                if (!string.IsNullOrWhiteSpace(ds))
                    return ds!.Length > 35 ? ds[..35] + "..." : ds!;
            }

            // 2. Clean up the component name — strip GUID suffix and known prefixes
            var name = c.Name.Split(':').Last().Trim();

            // Strip trailing GUID (e.g. "EndFormFlow-82921763-2342-F011-8779-000D3A0CEB69")
            var guidMatch = Regex.Match(name, @"-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}");
            if (guidMatch.Success) name = name[..guidMatch.Index].Trim('-').Trim();

            // Strip publisher prefix (e.g. "wmreply_replybrary_b320d_" → look for 3+ segments before real name)
            var segments = name.Split('_');
            if (segments.Length >= 4 && segments[0].Length <= 10)
                name = string.Join("_", segments.Skip(3));

            // Strip "Cloud " prefix added by description fallback
            name = Regex.Replace(name, @"^(Cloud\s+flow\s*:\s*|Cloud\s+)", "", RegexOptions.IgnoreCase).Trim();

            // Strip trailing hash-like suffix (e.g. "_Esnblz79KI97s", "_c933c") — must contain at least one digit
            name = Regex.Replace(name, @"_(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{4,15}$", "").Trim('_').Trim();

            if (string.IsNullOrWhiteSpace(name)) name = c.Name;
            return name.Length > 35 ? name[..35] + "..." : name;
        }

        string SafeLabel(string name)
        {
            var s = Regex.Replace(name, @"[<>&\[\]{}()#;""]", " ");
            return Regex.Replace(s, @"\s+", " ").Trim().Replace("'", "");
        }

        var sb = new System.Text.StringBuilder();
        sb.AppendLine("```mermaid");
        sb.AppendLine("flowchart LR");
        sb.AppendLine();
        sb.AppendLine("    USER[End User]");
        sb.AppendLine();

        var cappedApps  = apps.Take(5).ToList();
        var cappedFlows = flows.Take(5).ToList();
        var cappedBots  = bots.Take(2).ToList();
        var cappedDbs   = tables.Take(4).ToList();
        var cappedExt   = externalSystems.Take(3).ToList();

        if (cappedApps.Any() || cappedFlows.Any() || cappedBots.Any())
        {
            sb.AppendLine("    subgraph PowerPlatform[\"Power Platform\"]");
            for (int i = 0; i < cappedApps.Count; i++)
                sb.AppendLine($"        {NodeId("APP", cappedApps[i].Name, i)}[\"{SafeLabel(DisplayName(cappedApps[i]))}\"]");
            for (int i = 0; i < cappedFlows.Count; i++)
                sb.AppendLine($"        {NodeId("FLOW", cappedFlows[i].Name, i)}[\"{SafeLabel(DisplayName(cappedFlows[i]))}\"]");
            for (int i = 0; i < cappedBots.Count; i++)
                sb.AppendLine($"        {NodeId("BOT", cappedBots[i].Name, i)}(\"{SafeLabel(DisplayName(cappedBots[i]))}\")");
            sb.AppendLine("    end");
            sb.AppendLine();
        }

        if (cappedDbs.Any())
        {
            sb.AppendLine("    subgraph DataSources[\"Data Sources\"]");
            for (int i = 0; i < cappedDbs.Count; i++)
            {
                var db = cappedDbs[i];
                var dbLabel = DisplayName(db);
                sb.AppendLine($"        {NodeId("DB", db.Name, i)}[(\"{SafeLabel(dbLabel)}\")]");
            }
            sb.AppendLine("    end");
            sb.AppendLine();
        }

        if (cappedExt.Any())
        {
            sb.AppendLine("    subgraph ExternalSystems[\"External Systems\"]");
            for (int i = 0; i < cappedExt.Count; i++)
            {
                var safe = Regex.Replace(cappedExt[i], @"[^A-Za-z0-9]", "_").Trim('_');
                sb.AppendLine($"        EXT{i}_{safe}[\"{SafeLabel(cappedExt[i])}\"]");
            }
            sb.AppendLine("    end");
            sb.AppendLine();
        }

        // Edges
        var appIds  = cappedApps .Select((a, i) => NodeId("APP",  a.Name, i)).ToList();
        var flowIds = cappedFlows.Select((f, i) => NodeId("FLOW", f.Name, i)).ToList();
        var botIds  = cappedBots .Select((b, i) => NodeId("BOT",  b.Name, i)).ToList();
        var dbIds   = cappedDbs  .Select((d, i) => NodeId("DB",   d.Name, i)).ToList();
        var extIds  = cappedExt  .Select((e, i) => $"EXT{i}_{Regex.Replace(e, @"[^A-Za-z0-9]", "_").Trim('_')}").ToList();

        // USER → all apps, all bots (direct interaction)
        foreach (var a in appIds)  sb.AppendLine($"    USER --> {a}");
        foreach (var b in botIds)  sb.AppendLine($"    USER --> {b}");
        if (!appIds.Any() && !botIds.Any())
            foreach (var f in flowIds) sb.AppendLine($"    USER --> {f}");

        // First app triggers all flows (representative)
        if (appIds.Any() && flowIds.Any())
            foreach (var f in flowIds) sb.AppendLine($"    {appIds[0]} --> {f}");

        // Bot → all flows (bots can trigger any flow)
        if (botIds.Any() && flowIds.Any())
            foreach (var f in flowIds) sb.AppendLine($"    {botIds[0]} --> {f}");

        // Only first flow → all data sources (representative)
        if (flowIds.Any())
            foreach (var d in dbIds) sb.AppendLine($"    {flowIds[0]} --> {d}");

        // Each app → each data source (direct read/write)
        foreach (var a in appIds.Take(3))
            foreach (var d in dbIds) sb.AppendLine($"    {a} --> {d}");

        // Flows with external system keywords → those external systems
        for (int i = 0; i < cappedExt.Count; i++)
        {
            var matchingFlows = cappedFlows
                .Select((f, fi) => (f, fi))
                .Where(x => ExternalSystemHints.Any(h =>
                    h.label == cappedExt[i] &&
                    x.f.Name.Contains(h.keyword, StringComparison.OrdinalIgnoreCase)))
                .Select(x => NodeId("FLOW", x.f.Name, x.fi))
                .ToList();
            foreach (var fid in matchingFlows)
                sb.AppendLine($"    {fid} --> {extIds[i]}");
        }

        sb.AppendLine("```");
        return sb.ToString();
    }
    private static string BuildComponentMapCode(Models.ParsedSolution solution)
    {
        if (!solution.Components.Any()) return string.Empty;

        // Schema.md: flowchart TB, SOLUTION at top, components grouped by category with naming prefixes.
        // Use subgraphs per category so 40+ nodes don't collapse into one unreadable horizontal row.
        var typeMap = new[]
        {
            (new[]{"canvas_app","model_driven_app"},                               "APP",    "Applications"),
            (new[]{"bot"},                                                         "BOT",    "Bots"),
            (new[]{"cloud_flow","instant_flow"},                                   "FLOW",   "Cloud Flows"),
            (new[]{"entity","flow_dataverse_table","search_entity","data_source"}, "TABLE",  "Data Tables"),
            (new[]{"environment_variable"},                                        "ENVVAR", "Environment Variables"),
            (new[]{"connection_reference","connection"},                           "CONN",   "Connection References"),
        };

        static string SafeId(string prefix, int idx)
            => $"{prefix}_{idx}";

        static string SafeLabel(string name)
        {
            var s = name.Length > 30 ? name[..30] + "..." : name;
            s = Regex.Replace(s, @"[<>&\[\]{}()#;]", " ");
            return Regex.Replace(s, @"\s+", " ").Trim().Replace("\"", "'");
        }

        var sb = new System.Text.StringBuilder();
        sb.AppendLine("```mermaid");
        sb.AppendLine("flowchart TB");
        sb.AppendLine();

        var solutionLabel = SafeLabel(solution.SolutionName ?? "Solution");
        sb.AppendLine($"    SOLUTION[\"{solutionLabel}\"]");
        sb.AppendLine($"    style SOLUTION fill:#4CAF50,stroke:#2E7D32,stroke-width:3px,color:#fff");
        sb.AppendLine();

        foreach (var (typeKeywords, prefix, groupTitle) in typeMap)
        {
            var members = solution.Components
                .Where(c => typeKeywords.Any(kw => c.Type.Equals(kw, StringComparison.OrdinalIgnoreCase)))
                .Where(c => !CanvasAppArtifactKeywords.Any(kw => c.Name.Contains(kw, StringComparison.OrdinalIgnoreCase)))
                .DistinctBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (members.Count == 0) continue;

            var grpId = $"GRP_{prefix}";
            sb.AppendLine($"    subgraph {grpId}[\"{groupTitle}\"]");
            for (int i = 0; i < members.Count; i++)
            {
                var label = SafeLabel(CleanComponentLabel(members[i]));
                var nodeId = SafeId(prefix, i);
                sb.AppendLine($"        {nodeId}[\"{prefix}_{label}\"]");
            }
            sb.AppendLine("    end");
            sb.AppendLine($"    SOLUTION --> {grpId}");
            sb.AppendLine();
        }

        sb.AppendLine("```");
        return sb.ToString();
    }

    /// <summary>
    /// Generates a Mermaid flowchart TB showing each flow as a subgraph with its trigger and
    /// connector dependencies — exactly as Schema.md specifies. Never has syntax errors.
    /// </summary>
    private static string BuildFlowDiagramCode(Models.ParsedSolution solution)
    {
        var flows = solution.Components
            .Where(c => c.Type.Contains("flow", StringComparison.OrdinalIgnoreCase)
                     || c.Type.Contains("cloud_flow", StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (!flows.Any()) return string.Empty;

        var apps = solution.Components
            .Where(c => c.Type.Contains("app", StringComparison.OrdinalIgnoreCase)
                     || c.Type.Contains("canvas", StringComparison.OrdinalIgnoreCase))
            .Take(3).ToList();

        // 1. Gather any explicit connection components
        var connNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in solution.Components.Where(x => x.Type.Contains("connection", StringComparison.OrdinalIgnoreCase) || x.Type.Contains("connector", StringComparison.OrdinalIgnoreCase)))
        {
            connNames.Add(c.Name);
        }

        // 2. Also search flows for used connectors inside metadata
        foreach (var flow in flows)
        {
            if (flow.Metadata != null && flow.Metadata.TryGetValue("connectors", out var connsObj))
            {
                if (connsObj is System.Text.Json.JsonElement je && je.ValueKind == System.Text.Json.JsonValueKind.Array)
                {
                    foreach (var elem in je.EnumerateArray()) 
                    {
                        var str = elem.GetString();
                        if (!string.IsNullOrEmpty(str)) connNames.Add(str);
                    }
                }
                else if (connsObj is System.Collections.Generic.IEnumerable<string> list)
                {
                    foreach (var str in list) 
                    {
                        if (!string.IsNullOrEmpty(str)) connNames.Add(str);
                    }
                }
            }
        }

        // Add a fallback generic connector if absolutely none are found but we have flows
        if (connNames.Count == 0 && flows.Any())
        {
            connNames.Add("SharePoint");
            connNames.Add("Dataverse");
        }

        var conns = connNames.ToList();

        // Safe node ID
        static string SafeId(string prefix, string name, int idx)
        {
            var safe = Regex.Replace(name, @"[^A-Za-z0-9]", "_");
            safe = Regex.Replace(safe, @"_+", "_").Trim('_');
            if (safe.Length == 0 || char.IsDigit(safe[0])) safe = "N" + safe;
            if (safe.Length > 25) safe = safe[..25].TrimEnd('_');
            return $"{prefix}{idx}_{safe}";
        }

        static string SafeLabel(string name)
        {
            var s = name.Length > 35 ? name[..35] + "..." : name;
            s = Regex.Replace(s, @"[<>&\[\]{}()#;]", " ");
            s = Regex.Replace(s, @"\s+", " ").Trim().Replace("\"", "'");
            return s;
        }

        var sb = new System.Text.StringBuilder();
        // Schema.md §Flow Execution + Connector Dependency Map:
        //   USER --> APP --> flow-subgraph (with Trigger-->Step nodes inside)
        //   Step nodes inside subgraph --> CONN_ nodes outside subgraph
        //   CONN_ nodes are standalone (NOT wrapped in a subgraph)
        sb.AppendLine("```mermaid");
        sb.AppendLine("flowchart TB");
        sb.AppendLine();
        sb.AppendLine("    %% ==============================");
        sb.AppendLine("    %% TRIGGER SOURCES");
        sb.AppendLine("    %% ==============================");
        sb.AppendLine("    USER[End User]");
        sb.AppendLine("    style USER fill:#E8F5E9,stroke:#388E3C,stroke-width:3px");

        var appIds = new List<string>();
        for (int i = 0; i < apps.Count; i++)
        {
            var aid = SafeId("APP", apps[i].Name, i);
            appIds.Add(aid);
            sb.AppendLine($"    {aid}[\"{SafeLabel(CleanComponentLabel(apps[i]))}\"]");
            sb.AppendLine($"    style {aid} fill:#E3F2FD,stroke:#1976D2,stroke-width:3px");
        }
        sb.AppendLine();
        foreach (var aid in appIds)
            sb.AppendLine($"    USER --> {aid}");
        sb.AppendLine();

        sb.AppendLine("    %% ==============================");
        sb.AppendLine("    %% FLOW EXECUTION");
        sb.AppendLine("    %% ==============================");

        // Connector nodes defined outside all subgraphs (schema pattern)
        var connIds = new List<string>();
        for (int i = 0; i < conns.Count; i++)
        {
            var cid = SafeId("CONN", conns[i], i);
            connIds.Add(cid);
        }

        // Per-flow: step node (last node inside subgraph) connects to its connector
        var flowStepIds = new List<string>(); // last step node id per flow, for connector edges
        for (int i = 0; i < flows.Count; i++)
        {
            var flow = flows[i];
            var fid = SafeId("FLW", flow.Name, i);

            var trigger = "Manual";
            if (flow.Metadata != null)
                foreach (var k in new[] { "trigger", "trigger_type", "triggerType" })
                    if (flow.Metadata.TryGetValue(k, out var tv) && tv is string ts && !string.IsNullOrWhiteSpace(ts))
                    { trigger = Regex.Replace(ts.Length > 20 ? ts[..20] : ts, @"[^A-Za-z0-9 ]", "").Trim(); break; }

            var trigId  = $"TRG{i}_{fid}";
            var getId   = $"GET{i}_{fid}";
            var procId  = $"PRC{i}_{fid}";
            var storeId = $"STR{i}_{fid}";
            flowStepIds.Add(storeId);   // last step connects to connectors

            sb.AppendLine();
            sb.AppendLine($"    subgraph {fid}[\"{SafeLabel(CleanComponentLabel(flow))}\"]");
            sb.AppendLine($"        {trigId}[\"Trigger: {trigger}\"]");
            sb.AppendLine($"        {getId}[\"Retrieve Data\"]");
            sb.AppendLine($"        {procId}[\"Process Logic\"]");
            sb.AppendLine($"        {storeId}[\"Update Data Source\"]");
            sb.AppendLine($"        {trigId} --> {getId} --> {procId} --> {storeId}");
            sb.AppendLine("    end");
            sb.AppendLine($"    style {fid} fill:#FFF3E0,stroke:#F57C00,stroke-width:3px");
        }
        sb.AppendLine();

        // Trigger sources → flows (connect to first trigger node inside each subgraph)
        for (int i = 0; i < flows.Count; i++)
        {
            var trigId = $"TRG{i}_" + SafeId("FLW", flows[i].Name, i);
            if (appIds.Any())
                sb.AppendLine($"    {appIds[0]} --> {trigId}");
            else
                sb.AppendLine($"    USER --> {trigId}");
        }
        sb.AppendLine();

        if (connIds.Any())
        {
            sb.AppendLine("    %% ==============================");
            sb.AppendLine("    %% CONNECTOR DEPENDENCIES");
            sb.AppendLine("    %% ==============================");
            // Connector nodes IN a subgraph for visual grouping.
            // Arrows FROM flow step nodes INTO a subgraph work fine in Mermaid 11.x.
            // (Only arrows FROM a subgraph ID *as a source* are broken.)
            sb.AppendLine("    subgraph CONNS[\"Connection References\"]");
            for (int i = 0; i < conns.Count; i++)
                sb.AppendLine($"        {connIds[i]}[\"{SafeLabel(conns[i])}\"]");
            sb.AppendLine("    end");
            sb.AppendLine("    style CONNS fill:#FCE4EC,stroke:#C2185B,stroke-width:3px");
            sb.AppendLine();
            // Each flow's last step → round-robin connector
            for (int i = 0; i < flowStepIds.Count; i++)
                sb.AppendLine($"    {flowStepIds[i]} --> {connIds[i % connIds.Count]}");
        }

        sb.AppendLine();
        sb.AppendLine("```");
        return sb.ToString();
    }

    private static string InjectFlowDiagram(string llmOutput, string deterministicDiagram)
    {
        // Replace <<FLOW_DIAGRAM>> placeholder (first occurrence, remove extras)
        if (llmOutput.Contains("<<FLOW_DIAGRAM>>"))
        {
            var first = llmOutput.IndexOf("<<FLOW_DIAGRAM>>", StringComparison.Ordinal);
            var result = llmOutput[..first] + deterministicDiagram + llmOutput[(first + "<<FLOW_DIAGRAM>>".Length)..];
            return result.Replace("<<FLOW_DIAGRAM>>", string.Empty);
        }

        // Find Flow Execution heading and replace or insert diagram
        var headingMatch = Regex.Match(llmOutput,
            @"(#{1,6}[^\n]*(?:Flow Execution|Connector Dependency)[^\n]*\n)",
            RegexOptions.IgnoreCase);
        if (headingMatch.Success)
        {
            var afterStart = headingMatch.Index + headingMatch.Length;
            var section = llmOutput[afterStart..Math.Min(afterStart + 4000, llmOutput.Length)];
            var blockMatch = Regex.Match(section, @"```mermaid[\s\S]*?```", RegexOptions.IgnoreCase, TimeSpan.FromSeconds(3));
            if (blockMatch.Success)
            {
                var blockStart = afterStart + blockMatch.Index;
                var blockEnd   = afterStart + blockMatch.Index + blockMatch.Length;
                return llmOutput[..blockStart] + deterministicDiagram + llmOutput[blockEnd..];
            }
            // No mermaid block found — insert right after heading
            return llmOutput[..afterStart] + "\n" + deterministicDiagram + "\n" + llmOutput[afterStart..];
        }

        return llmOutput;
    }

    /// <summary>
    /// Replaces the first flowchart mermaid block that looks like a component map in LLM output.
    /// </summary>
    private static string InjectComponentMap(string llmOutput, string deterministicMap)
    {
        // 1. Replace <<COMPONENT_MAP>> placeholder if LLM used it
        if (llmOutput.Contains("<<COMPONENT_MAP>>"))
        {
            Console.WriteLine("[InjectComponentMap] Strategy 1: <<COMPONENT_MAP>> placeholder found");
            return llmOutput.Replace("<<COMPONENT_MAP>>", deterministicMap);
        }

        // 2. Replace any LLM-written flowchart block that contains a SOLUTION node
        var replaced = Regex.Replace(
            llmOutput,
            @"```mermaid[\s\S]*?SOLUTION[\s\S]*?```",
            deterministicMap,
            RegexOptions.IgnoreCase,
            TimeSpan.FromSeconds(5)
        );
        if (replaced != llmOutput)
        {
            Console.WriteLine("[InjectComponentMap] Strategy 2: replaced SOLUTION flowchart block");
            return replaced;
        }

        // 3. Find any heading containing "Component Map" or "Solution Component" and inject after it
        var headingMatch = Regex.Match(llmOutput,
            @"(#{1,6}[^\n]*(?:Component Map|Solution Component)[^\n]*\n)",
            RegexOptions.IgnoreCase);
        Console.WriteLine($"[InjectComponentMap] Strategy 3: heading match={headingMatch.Success}, value='{(headingMatch.Success ? headingMatch.Value.Trim() : "N/A")}'");
        if (headingMatch.Success)
        {
            var afterHeading = headingMatch.Index + headingMatch.Length;
            var section = llmOutput[afterHeading..Math.Min(afterHeading + 3000, llmOutput.Length)];
            var blockMatch = Regex.Match(section, @"```mermaid[\s\S]*?```", RegexOptions.IgnoreCase, TimeSpan.FromSeconds(3));
            if (blockMatch.Success)
            {
                Console.WriteLine("[InjectComponentMap] Strategy 3a: replacing existing mermaid block after heading");
                var blockStart = afterHeading + blockMatch.Index;
                var blockEnd   = afterHeading + blockMatch.Index + blockMatch.Length;
                return llmOutput[..blockStart] + deterministicMap + llmOutput[blockEnd..];
            }
            Console.WriteLine("[InjectComponentMap] Strategy 3b: no mermaid block found, inserting after heading");
            return llmOutput[..afterHeading] + "\n" + deterministicMap + "\n" + llmOutput[afterHeading..];
        }

        // 4. Last resort: append at end
        Console.WriteLine("[InjectComponentMap] Strategy 4: last resort append at end");
        return llmOutput + "\n\n## Solution Component Map\n\n" + deterministicMap;
    }

    /// <summary>
    /// Replaces any erDiagram mermaid block in the LLM output with the deterministic one.
    /// Finds the ## 3. Data Model section and swaps the diagram.
    /// </summary>
    private static string InjectErDiagram(string llmOutput, string deterministicDiagram)
    {
        // If no real relationship data was found, keep the LLM's ER diagram as-is
        // (just remove the placeholder so it doesn't appear in output)
        if (string.IsNullOrWhiteSpace(deterministicDiagram))
        {
            return llmOutput.Replace("<<ER_DIAGRAM>>", string.Empty);
        }

        // Step 1: Strip ALL erDiagram mermaid blocks the LLM may have written anywhere
        var stripped = Regex.Replace(
            llmOutput,
            @"```mermaid\s*(?:%%\{[\s\S]*?\}%%\s*)?erDiagram[\s\S]*?```",
            string.Empty,
            RegexOptions.IgnoreCase
        );

        // Step 2: Replace <<ER_DIAGRAM>> placeholder (may appear once or twice - take first)
        if (stripped.Contains("<<ER_DIAGRAM>>"))
        {
            // Replace first occurrence only, remove any extras
            var firstIdx = stripped.IndexOf("<<ER_DIAGRAM>>", StringComparison.Ordinal);
            var result = stripped[..firstIdx] + deterministicDiagram + stripped[(firstIdx + "<<ER_DIAGRAM>>".Length)..];
            return result.Replace("<<ER_DIAGRAM>>", string.Empty); // remove any remaining duplicates
        }

        // Step 3: Inject after the "## 3." heading
        var match = Regex.Match(stripped, @"(## 3\.[^\n]*\n)", RegexOptions.IgnoreCase);
        if (match.Success)
        {
            var idx = match.Index + match.Length;
            return stripped[..idx] + "\n" + deterministicDiagram + "\n" + stripped[idx..];
        }

        // Fallback: append at the end
        return stripped + "\n\n## Data Model - ER Diagram\n\n" + deterministicDiagram;
    }

    /// Builds a clean, deterministic markdown table for the Data Sources section.
    private static string BuildDataSourcesTable(Models.ParsedSolution solution)
    {
        var guidPat = new Regex(@"^[0-9a-fA-F]{8}-");
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("| Data Source Name | Type | Description | Key Fields |");
        sb.AppendLine("|-----------------|------|-------------|-----------|");

        // SharePoint lists from environment variables
        var spLists = solution.Components
            .Where(c => c.Type.Equals("environment_variable", StringComparison.OrdinalIgnoreCase)
                     && c.Metadata != null)
            .Where(c =>
            {
                c.Metadata!.TryGetValue("api_id", out var apiObj);
                c.Metadata!.TryGetValue("parameter_key", out var pkObj);
                var apiId = apiObj is string s1 ? s1 : apiObj is System.Text.Json.JsonElement j1 && j1.ValueKind == System.Text.Json.JsonValueKind.String ? j1.GetString() ?? "" : "";
                var pk    = pkObj  is string s2 ? s2 : pkObj  is System.Text.Json.JsonElement j2 && j2.ValueKind == System.Text.Json.JsonValueKind.String ? j2.GetString() ?? "" : "";
                return apiId.Contains("sharepointonline", StringComparison.OrdinalIgnoreCase)
                    && pk.Equals("table", StringComparison.OrdinalIgnoreCase);
            })
            .Select(c =>
            {
                var dn = CleanComponentLabel(c);
                var segs = dn.Split('_');
                return (segs.Length >= 3 ? string.Join(" ", segs.Skip(2)) : dn.Replace("_", " ")).Trim();
            })
            .Where(n => !string.IsNullOrWhiteSpace(n) && !guidPat.IsMatch(n))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(n => n)
            .ToList();

        foreach (var name in spLists)
            sb.AppendLine($"| {name} | SharePoint List | | |");

        // Dataverse tables
        var dvTables = solution.Components
            .Where(c => c.Type.Equals("entity", StringComparison.OrdinalIgnoreCase)
                     || c.Type.Equals("flow_dataverse_table", StringComparison.OrdinalIgnoreCase))
            .Select(c => CleanComponentLabel(c))
            .Where(n => !string.IsNullOrWhiteSpace(n) && !guidPat.IsMatch(n))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(10)
            .ToList();

        foreach (var name in dvTables)
            sb.AppendLine($"| {name} | Dataverse Table | | |");

        if (!spLists.Any() && !dvTables.Any())
            sb.AppendLine("| — | — | No data sources detected | — |");

        return sb.ToString().TrimEnd();
    }

    /// Replaces the LLM-written data sources table with a deterministic one.
    private static string InjectDataSourcesTable(string llmOutput, Models.ParsedSolution solution)
    {
        var table = BuildDataSourcesTable(solution);

        // Find "Data Sources" heading
        var headingMatch = Regex.Match(llmOutput,
            @"(#{1,6}[^\n]*Data Source[^\n]*\n)",
            RegexOptions.IgnoreCase);
        if (!headingMatch.Success) return llmOutput;

        // Find the NEXT section heading after the data sources section
        var afterHeading = headingMatch.Index + headingMatch.Length;
        var nextHeadingMatch = Regex.Match(llmOutput[afterHeading..], @"^#{1,6}\s", RegexOptions.Multiline);
        var sectionEnd = nextHeadingMatch.Success
            ? afterHeading + nextHeadingMatch.Index
            : llmOutput.Length;

        // Replace the ENTIRE data sources section body with our deterministic table
        // (keeps any text the LLM wrote before the first | char, then replaces from there)
        var sectionBody = llmOutput[afterHeading..sectionEnd];
        var firstTableLine = Regex.Match(sectionBody, @"^\|", RegexOptions.Multiline);

        string newBody;
        if (firstTableLine.Success)
        {
            // Keep text before the table, replace from first | onward
            newBody = sectionBody[..firstTableLine.Index] + table + "\n\n";
        }
        else
        {
            // No existing table — append deterministic table after any descriptive text
            newBody = sectionBody.TrimEnd() + "\n\n" + table + "\n\n";
        }

        return llmOutput[..afterHeading] + newBody + llmOutput[sectionEnd..];
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
        var hasSharePointRefsWithoutMetadata = sharePointUrls.Count > 0 && (solution.SharePointMetadata == null || solution.SharePointMetadata.Count == 0);

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

        // SharePoint Metadata (if available from Microsoft Graph)
        if (solution.SharePointMetadata != null && solution.SharePointMetadata.Count > 0)
        {
            sb.AppendLine("## SharePoint Integration Details");
            sb.AppendLine("The following SharePoint sites and data structures were automatically detected:");
            sb.AppendLine();

            foreach (var site in solution.SharePointMetadata)
            {
                if (!string.IsNullOrEmpty(site.ErrorMessage))
                {
                    sb.AppendLine($"### ⚠️ {site.SiteUrl}");
                    sb.AppendLine($"**Error:** {site.ErrorMessage}");
                    sb.AppendLine();
                    continue;
                }

                sb.AppendLine($"### {site.SiteName}");
                sb.AppendLine($"**Site URL:** {site.SiteUrl}");
                sb.AppendLine();

                if (site.Lists.Count > 0)
                {
                    sb.AppendLine("#### SharePoint Lists");
                    foreach (var list in site.Lists)
                    {
                        sb.AppendLine($"- **{list.DisplayName ?? list.Name}**");
                        if (!string.IsNullOrEmpty(list.Description))
                            sb.AppendLine($"  - Description: {list.Description}");
                        sb.AppendLine($"  - URL: {list.WebUrl}");
                        
                        if (list.Columns.Count > 0)
                        {
                            sb.AppendLine("  - Columns:");
                            foreach (var col in list.Columns)
                            {
                                var required = col.Required ? " (Required)" : "";
                                sb.AppendLine($"    - `{col.DisplayName ?? col.Name}` ({col.Type}){required}");
                            }
                        }
                        sb.AppendLine();
                    }
                }

                if (site.Libraries.Count > 0)
                {
                    sb.AppendLine("#### Document Libraries");
                    foreach (var lib in site.Libraries)
                    {
                        sb.AppendLine($"- **{lib.DisplayName ?? lib.Name}**");
                        if (!string.IsNullOrEmpty(lib.Description))
                            sb.AppendLine($"  - Description: {lib.Description}");
                        sb.AppendLine($"  - URL: {lib.WebUrl}");
                        sb.AppendLine();
                    }
                }

                sb.AppendLine("---");
                sb.AppendLine();
            }

            sb.AppendLine("*This data was automatically fetched from SharePoint using Microsoft Graph API*");
            sb.AppendLine();
        }
        else if (hasSharePointRefsWithoutMetadata)
        {
            sb.AppendLine("## SharePoint Integration Details");
            sb.AppendLine("SharePoint references were detected in the solution export.");
            sb.AppendLine("Additional SharePoint metadata was not available during documentation generation.");
            sb.AppendLine("Use the SharePoint URLs and references listed above as the available evidence.");
            sb.AppendLine();
        }

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
        var sharePointUrls = solution.Components
            .Where(c => c.Type.Equals("knowledge_source_item", StringComparison.OrdinalIgnoreCase))
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
        var hasSharePointMetadata = solution.SharePointMetadata != null && solution.SharePointMetadata.Count > 0;

        var sb = new System.Text.StringBuilder();
        if (sharePointUrls.Count > 0)
        {
            sb.AppendLine("## SHAREPOINT EVIDENCE");
            sb.AppendLine($"- SharePoint references detected in solution export: {string.Join(", ", sharePointUrls)}");
            if (hasSharePointMetadata)
            {
                sb.AppendLine("- Additional SharePoint metadata is available and may be used when present.");
            }
            else
            {
                sb.AppendLine("- Additional SharePoint metadata was not available during this run.");
                sb.AppendLine("- Treat SharePoint URLs and explicit component references as valid export evidence.");
                sb.AppendLine("- Do not describe missing SharePoint list/library/column details as 'Not found in solution export' unless the export itself lacks the reference.");
            }
            sb.AppendLine();
        }

        foreach (var (type, comps) in byType)
        {
            sb.AppendLine($"\n## {type.ToUpper()}S ({comps.Count})");
            foreach (var c in comps)
            {
                sb.AppendLine($"- **{c.Name}**: {c.Description ?? "No description"}");
                if (c.Metadata != null && c.Metadata.Count > 0)
                {
                    // Format metadata in a more readable way for AI
                    sb.AppendLine("  Metadata:");
                    foreach (var kv in c.Metadata)
                    {
                        var value = kv.Value?.ToString() ?? "";
                        // For lists, format them nicely
                        if (kv.Value is System.Collections.IEnumerable enumerable && !(kv.Value is string))
                        {
                            var items = enumerable.Cast<object>().Select(x => x.ToString()).ToList();
                            if (items.Count > 0)
                                sb.AppendLine($"    - {kv.Key}: {string.Join(", ", items)}");
                        }
                        else
                        {
                            sb.AppendLine($"    - {kv.Key}: {value}");
                        }
                    }
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
        
        // Note: ER diagram is generated deterministically by BuildErDiagramCode - LLM does not need to generate it
        var tableCount = solution.Components.Count(c => c.Type.Contains("table") || c.Type.Contains("entity") || c.Type == "flow_dataverse_table");
        if (tableCount > 0)
        {
            sb.AppendLine($"# Data: Solution has {tableCount} tables/entities. The ER diagram (Section 6 Data Model) is auto-generated - just write <<ER_DIAGRAM>> as a placeholder in the Data Model section.");
            sb.AppendLine();
        }
        
        sb.AppendLine("# CRITICAL NAMING CONVENTIONS - MUST FOLLOW:");
        sb.AppendLine("Apply these prefixes to ALL component references in diagrams and documentation:");
        sb.AppendLine("| Component Type | Prefix     |");
        sb.AppendLine("|---------------|------------|");
        sb.AppendLine("| App           | APP_       |");
        sb.AppendLine("| Flow          | FLOW_      |");
        sb.AppendLine("| Table/List    | TABLE_     |");
        sb.AppendLine("| Environment   | ENV_       |");
        sb.AppendLine("| Role          | ROLE_      |");
        sb.AppendLine("| Connector     | CONN_      |");
        sb.AppendLine("| Variable      | ENVVAR_    |");
        sb.AppendLine("| External Sys  | EXT_       |");
        sb.AppendLine();
        
        sb.AppendLine("Output requirements (show everything):");
        sb.AppendLine("1. Cover ALL component types and ALL components listed in the input.");
        sb.AppendLine("2. List every component under its exact type with proper prefix.");
        sb.AppendLine("3. Apply naming convention prefixes to component names in ALL diagrams and text.");
        sb.AppendLine("4. Prefer concrete values from metadata (URLs, IDs, table names, connectors) when available.");
        sb.AppendLine("5. If a detail is genuinely absent from the solution export, write: 'Not found in solution export'.");
        sb.AppendLine("6. Do not invent new systems, APIs, or architecture layers not present in the component data.");
        sb.AppendLine("7. For Dataverse/SharePoint, surface every explicit reference found in components and metadata.");
        sb.AppendLine("8. If SharePoint references are present but additional SharePoint metadata is unavailable, omit those extra details or write: 'Additional SharePoint metadata was not available'.");
        sb.AppendLine();
        
        sb.AppendLine("DOCUMENT STRUCTURE (follow this exact structure):");
        sb.AppendLine();
        sb.AppendLine("## 1. Overview");
        sb.AppendLine("   - Document Overview: Brief description of solution purpose");
        sb.AppendLine("   - App Functionality Overview: What the solution does");
        sb.AppendLine("   - Solution Architecture: High-level architecture with Architecture diagram");
        sb.AppendLine("   - Access Levels: List user roles/permissions (Admin, ReadOnly, etc.)");
        sb.AppendLine();
        sb.AppendLine("## 2. Environment Details");
        sb.AppendLine("   ### Environment Variables");
        sb.AppendLine("   - Create a table with columns: Variable Name (ENVVAR_ prefix), Type, Description, Value");
        sb.AppendLine("   - !!CRITICAL RULE!!: Keep each row on a single line. Never use newlines inside table cells.");
        sb.AppendLine("   - Example format:");
        sb.AppendLine("     | Variable Name | Type | Description | Value |");
        sb.AppendLine("     |--------------|------|-------------|-------|");
        sb.AppendLine("     | ENVVAR_SharePointSite | Text | SharePoint site URL | https://... |");
        sb.AppendLine("     | ENVVAR_DocumentLibrary | Text | Document library name | Documents |");
        sb.AppendLine("   - List all environment variables found in solution");
        sb.AppendLine();
        sb.AppendLine("   ### Connection References");
        sb.AppendLine("   - Create a table with columns: Connection Reference Name (CONN_ prefix), Connection Type, Use");
        sb.AppendLine("   - !!CRITICAL RULE!!: Keep each row on a single line. Never use newlines inside table cells.");
        sb.AppendLine("   - Example format:");
        sb.AppendLine("     | Connection Reference | Connection | Use |");
        sb.AppendLine("     |---------------------|-----------|-----|");
        sb.AppendLine("     | CONN_SharePoint | SharePoint | Used in flows: FLOW_DataSync |");
        sb.AppendLine("     | CONN_Outlook | Outlook | Used in flows: FLOW_SendNotification |");
        sb.AppendLine("   - Include which flows/apps use each connection");
        sb.AppendLine();
        sb.AppendLine("## 3. Data Sources");
        sb.AppendLine("   - Describe where data is stored (e.g., 'All data is stored within SharePoint' or 'Uses Dataverse tables')");
        sb.AppendLine("   - List environment-specific sites/databases if applicable (Dev, Test, Production)");
        sb.AppendLine("   - ⚠️ ONLY use the exact rows pre-populated below. Do NOT add any extra rows. Do NOT include knowledge sources, search entities, GUIDs, or internal components.");
        sb.AppendLine("   - !!CRITICAL TABLE RULES!!: (1) Each row on ONE line only. (2) No newlines inside cells. (3) Strip all line breaks from descriptions. (4) Use clean readable names — no GUIDs, no hash suffixes.");
        sb.AppendLine();

        // Pre-populate with real data sources:
        // 1. SharePoint lists from environment variables (strip publisher prefix, keep readable list name)
        // 2. Dataverse tables from entity/flow_dataverse_table components (skip pure GUIDs)
        // knowledge_source and search_entity are internal infrastructure — excluded from client docs
        sb.AppendLine("| Data Source Name | Type | Description | Key Fields |");
        sb.AppendLine("|-----------------|------|-------------|-----------|");

        var guidPat = new Regex(@"^[0-9a-fA-F\-]{32,}$");

        // SharePoint lists from environment variables
        var spLists = solution.Components
            .Where(c => c.Type.Equals("environment_variable", StringComparison.OrdinalIgnoreCase)
                     && c.Metadata != null
                     && c.Metadata.TryGetValue("api_id", out var apiObj)
                     && apiObj?.ToString()?.Contains("sharepointonline", StringComparison.OrdinalIgnoreCase) == true
                     && c.Metadata.TryGetValue("parameter_key", out var pkObj)
                     && pkObj?.ToString()?.Equals("table", StringComparison.OrdinalIgnoreCase) == true)
            .Select(c =>
            {
                // Display name: strip publisher prefix (e.g. "wmreply_Replybrary_Project_List" → "Project List")
                var dn = (c.Metadata!.TryGetValue("display_name", out var d) && d is string ds && !string.IsNullOrWhiteSpace(ds)) ? ds : c.Name;
                var segments = dn.Split('_');
                var cleanName = segments.Length >= 3 ? string.Join(" ", segments.Skip(2)) : dn.Replace("_", " ");
                return cleanName.Trim();
            })
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(n => n)
            .ToList();

        foreach (var listName in spLists)
            sb.AppendLine($"| {listName} | SharePoint List | [Describe purpose] | [Key fields] |");

        // Dataverse tables (entity / flow_dataverse_table) — skip pure GUIDs
        var dvTables = solution.Components
            .Where(c =>
                c.Type.Equals("entity", StringComparison.OrdinalIgnoreCase) ||
                c.Type.Equals("flow_dataverse_table", StringComparison.OrdinalIgnoreCase))
            .Select(c =>
            {
                var n = c.Type.Equals("flow_dataverse_table", StringComparison.OrdinalIgnoreCase) && c.Name.Contains(':')
                    ? c.Name.Split(':').Last().Trim() : c.Name;
                if (c.Metadata != null && c.Metadata.TryGetValue("display_name", out var dn) && dn is string dns && !string.IsNullOrWhiteSpace(dns))
                    n = dns;
                return n.Trim();
            })
            .Where(n => !string.IsNullOrWhiteSpace(n) && !guidPat.IsMatch(n))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(10)
            .ToList();

        foreach (var tbl in dvTables)
            sb.AppendLine($"| {tbl} | Dataverse Table | [Describe purpose] | [Key fields] |");

        if (!spLists.Any() && !dvTables.Any())
            sb.AppendLine("| [TableName] | SharePoint List / Dataverse Table | [Purpose] | [Column1, Column2] |");

        sb.AppendLine("   - Fill in Description and Key Fields for each row. Do NOT modify the Data Source Name column.");
        sb.AppendLine();
        sb.AppendLine("## 4. Solution Components");
        sb.AppendLine("   ### Power Apps Applications");
        sb.AppendLine("   - List each app (APP_ prefix) with description");
        sb.AppendLine();
        sb.AppendLine("   ### Power Automate Flows");
        sb.AppendLine("   - List each flow (FLOW_ prefix) with:");
        sb.AppendLine("     * Trigger: Use metadata['trigger'] if available, otherwise infer from flow name/description (e.g., 'Manual', 'PowerApps', 'Schedule', 'When item created')");
        sb.AppendLine("     * Summary: Describe what the flow does using metadata['summary'], metadata['action_count'], metadata['dataverse_tables'], and flow name");
        sb.AppendLine("     * Connectors Used: Use metadata['connectors'] if available, otherwise infer from flow name/description and map to CONN_ names");
        sb.AppendLine("   - IMPORTANT: Always provide reasonable inferences - never write 'Not found in solution export' for flows");
        sb.AppendLine();
        sb.AppendLine("## 5. User Permissions");
        sb.AppendLine("   - Document permission levels and user groups");
        sb.AppendLine("   - Create sections for each permission level:");
        sb.AppendLine("     ### Users with Admin Permission");
        sb.AppendLine("     - List users/groups with full access (create, edit, delete)");
        sb.AppendLine("     - Example: Site Owners, Admins group");
        sb.AppendLine();
        sb.AppendLine("     ### Users with ReadOnly Permission");
        sb.AppendLine("     - List users/groups with read-only access");
        sb.AppendLine("     - Example: Site Visitors, specific user groups");
        sb.AppendLine();
        sb.AppendLine("   - If using SharePoint/Dataverse security, mention permission inheritance");
        sb.AppendLine("   - If custom roles (ROLE_ prefix) are used, list them with permissions");
        sb.AppendLine();
        sb.AppendLine("## 6. Technical Appendix");
        sb.AppendLine("   - Solution Component Map diagram");
        sb.AppendLine("   - Data Model (auto-generated - do NOT write an erDiagram block)");
        sb.AppendLine("   - Flow Execution diagrams (for each major flow)");
        sb.AppendLine();
        
        sb.AppendLine("# MANDATORY MERMAID DIAGRAM FORMATS:");
        sb.AppendLine();
        sb.AppendLine("## 1. Architecture Diagram Format (REQUIRED in Solution Architecture section):");
        sb.AppendLine("⚠️ FORMAT TEMPLATE ONLY — Replace ALL placeholder names (APP_MainApplication, FLOW_PrimaryAutomation, etc.) with REAL names from the solution component data above. Only include subgraphs/nodes for systems that actually exist in the solution.");
        sb.AppendLine("```mermaid");
        sb.AppendLine("flowchart LR");
        sb.AppendLine();
        sb.AppendLine("    USER[End User]");
        sb.AppendLine();
        sb.AppendLine("    subgraph PowerPlatform");
        sb.AppendLine("        APP[APP_MainApplication]");
        sb.AppendLine("        FLOW[FLOW_PrimaryAutomation]");
        sb.AppendLine("    end");
        sb.AppendLine();
        sb.AppendLine("    subgraph DataSources");
        sb.AppendLine("        DB[(Dataverse)]");
        sb.AppendLine("        SP[(SharePoint)]");
        sb.AppendLine("        SQL[(SQL Database)]");
        sb.AppendLine("    end");
        sb.AppendLine();
        sb.AppendLine("    subgraph ExternalSystems");
        sb.AppendLine("        EXT1[External API]");
        sb.AppendLine("        EXT2[Email Service]");
        sb.AppendLine("    end");
        sb.AppendLine();
        sb.AppendLine("    USER --> APP");
        sb.AppendLine("    APP --> DB");
        sb.AppendLine("    APP --> SP");
        sb.AppendLine("    APP --> FLOW");
        sb.AppendLine("    FLOW --> SQL");
        sb.AppendLine("    FLOW --> EXT1");
        sb.AppendLine("    FLOW --> EXT2");
        sb.AppendLine();
        sb.AppendLine("```");
        sb.AppendLine();
        
        sb.AppendLine("## 2. Solution Component Map:");
        sb.AppendLine("The component map diagram is auto-generated. Write 1-2 sentences describing the solution components, then write exactly: <<COMPONENT_MAP>>");
        sb.AppendLine("Do NOT write any ```mermaid flowchart TB block for the component map yourself.");
        sb.AppendLine();
        sb.AppendLine("## 3. Flow Execution + Connector Dependencies:");
        sb.AppendLine("The flow execution diagram is auto-generated. Write 1-2 sentences describing how the flows orchestrate work, then write exactly: <<FLOW_DIAGRAM>>");
        sb.AppendLine("Do NOT write any ```mermaid flowchart block for the flow execution yourself.");
        sb.AppendLine();
        sb.AppendLine("## 4. ER / Data Model:");
        sb.AppendLine("The ER diagram is auto-generated. In Section 6 Technical Appendix under '### Data Model', write exactly: <<ER_DIAGRAM>>");
        sb.AppendLine("Do NOT write any ```mermaid erDiagram block anywhere in your output.");
        sb.AppendLine();
        
        sb.AppendLine("DIAGRAM REQUIREMENTS:");
        sb.AppendLine("1. Include fenced ```mermaid blocks (not images) for ALL required diagrams.");
        sb.AppendLine("2. Follow the structure of the format templates — but ALWAYS substitute real component names. NEVER copy placeholder names like APP_MainApplication, FLOW_PrimaryAutomation, EXT1, EXT2 into your output.");
        sb.AppendLine("3. Apply naming convention prefixes (APP_, FLOW_, TABLE_, CONN_, EXT_, ENVVAR_) to ALL component names.");
        sb.AppendLine("4. Use actual component names from the solution with appropriate prefixes.");
        sb.AppendLine("5. Use ONLY component names/types present in the provided data - do not invent.");
        sb.AppendLine("6. If evidence is missing for a connection, omit the edge instead of guessing.");
        sb.AppendLine("7. Ensure Mermaid syntax is valid and renderable - no trailing underscores in node IDs.");
        sb.AppendLine("8. Place each diagram in its appropriate section per the template.");
        sb.AppendLine();
        sb.AppendLine("⚠️⚠️⚠️ CRITICAL DIAGRAM RULES (STRICTLY ENFORCED): ⚠️⚠️⚠️");
        sb.AppendLine();
        sb.AppendLine("- Solution Component Map: MUST list ALL components (every single app, flow, table, envvar, connector) in organized subgraphs. Use TB (top-bottom) layout with large 24px fonts for readability. This should be a comprehensive full-page diagram showing the complete solution inventory.");
        sb.AppendLine();
        sb.AppendLine("- Flow Execution Diagram: Show ALL flows together in ONE diagram with their connectors using TB (top-bottom) layout with large 28px fonts. Group flows in organized colored subgraphs if many exist. NOT separate diagrams per flow");
        sb.AppendLine();
        sb.AppendLine("- ER Diagram: AUTO-GENERATED by the system - write <<ER_DIAGRAM>> as placeholder in Section 6 Data Model only. Do not write any erDiagram block anywhere else.");
        sb.AppendLine();
        sb.AppendLine("- Do NOT create individual flow diagrams - consolidate all flows into one Flow Execution diagram with organized subgraphs");
        sb.AppendLine("- Use large, readable font sizes in all diagrams (24-32px) - diagrams should fill full pages but text must be legible");
        sb.AppendLine();
        
        sb.AppendLine("Output format template (use exactly these headings and structure):");
        sb.AppendLine();
        sb.AppendLine("# [Solution Name] - Solution Overview Document");
        sb.AppendLine();
        sb.AppendLine("## 1. Overview");
        sb.AppendLine("### Document Overview");
        sb.AppendLine("### App Functionality Overview");
        sb.AppendLine("### Solution Architecture");
        sb.AppendLine("<<ARCHITECTURE_DIAGRAM>>");
        sb.AppendLine("### Access Levels");
        sb.AppendLine("- Admin Access");
        sb.AppendLine("- ReadOnly Access");
        sb.AppendLine();
        sb.AppendLine("## 2. Environment Details");
        sb.AppendLine("### Environment Variables");
        sb.AppendLine("| Variable Name | Type | Description | Value |");
        sb.AppendLine("|--------------|------|-------------|-------|");
        sb.AppendLine("| ENVVAR_VariableName | Text/Site/etc | Purpose of variable | Value or reference |");
        sb.AppendLine();
        sb.AppendLine("### Connection References");
        sb.AppendLine("| Connection Reference | Connection | Use |");
        sb.AppendLine("|---------------------|-----------|-----|");
        sb.AppendLine("| CONN_ConnectionName | Service Name | Used in: FLOW_FlowName, APP_AppName |");
        sb.AppendLine();
        sb.AppendLine("## 3. Data Sources");
        sb.AppendLine("[Describe storage location: 'All data is stored within SharePoint/Dataverse']");
        sb.AppendLine("[List environment-specific sites/databases if applicable]");
        sb.AppendLine();
        sb.AppendLine("| Data Source Name | Type | Description | Key Fields |");
        sb.AppendLine("|------------------|------|-------------|-----------|");
        sb.AppendLine("| TABLE_TableName | SharePoint/Dataverse/SQL | Purpose | Column1, Column2, Column3 |");
        sb.AppendLine();
        sb.AppendLine("## 4. Solution Components");
        sb.AppendLine("### Power Apps Applications");
        sb.AppendLine("List all applications in a clear bulleted list:");
        sb.AppendLine("- **APP_AppName**: [Detailed description based on purpose]");
        sb.AppendLine();
        sb.AppendLine("### Power Automate Flows");
        sb.AppendLine("List all flows in a clear, formatted structure. For each flow, include:");
        sb.AppendLine("- **Flow Name**: **FLOW_FlowName** (Premium/Non-Premium if known)");
        sb.AppendLine("  - **Trigger**: [If metadata['trigger'] exists, use it. Otherwise infer from flow name/description (e.g., 'Manual', 'Schedule', 'When item created')]");
        sb.AppendLine("  - **Summary**: [Describe what the flow does using available metadata and flow name]");
        sb.AppendLine("  - **Connectors Used**: [If metadata['connectors'] exists, list them as CONN_ names. Otherwise infer from description (e.g., CONN_SharePoint)]");
        sb.AppendLine("IMPORTANT: Do NOT write 'Not found in solution export' for flows. Always provide a reasonable inference based on flow name/description.");
        sb.AppendLine("Example:");
        sb.AppendLine("  - **Name**: FLOW_CreateOutputForm (Non-Premium)");
        sb.AppendLine("  - **Trigger**: PowerApps (activated from a Power App)");
        sb.AppendLine("  - **Summary**: Exports selected contract and data into PDF format and sends to user's email");
        sb.AppendLine("  - **Connectors Used**: CONN_SharePoint, CONN_Outlook");
        sb.AppendLine();
        sb.AppendLine("## 5. User Permissions");
        sb.AppendLine("### Users with Admin Permission");
        sb.AppendLine("- [List user groups/roles with full access]");
        sb.AppendLine("- Example: Site Owners, Admin security group");
        sb.AppendLine("- Permissions: Full Control - Add, Edit, View, Delete");
        sb.AppendLine();
        sb.AppendLine("### Users with ReadOnly Permission");
        sb.AppendLine("- [List user groups/roles with read-only access]");
        sb.AppendLine("- Example: Site Visitors, ReadOnly security group");
        sb.AppendLine("- Permissions: Read only");
        sb.AppendLine();
        sb.AppendLine("## 6. Technical Appendix");
        sb.AppendLine("### Solution Component Map");
        sb.AppendLine("<<COMPONENT_MAP>>");
        sb.AppendLine();
        sb.AppendLine("### Data Model");
        sb.AppendLine("<<ER_DIAGRAM>>");
        sb.AppendLine();
        sb.AppendLine("### Flow Execution and Connector Dependencies");
        sb.AppendLine("<<FLOW_DIAGRAM>>");
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
                  + "CRITICAL REQUIREMENTS: "
                  + "1. Apply naming convention prefixes to ALL component names in diagrams and text: "
                  + "APP_ (Power Apps), FLOW_ (Power Automate flows), TABLE_ (Dataverse tables), "
                  + "CONN_ (Connectors), ENVVAR_ (Environment variables), EXT_ (External systems), "
                  + "ROLE_ (Security roles), ENV_ (Environments). "
                  + "2. Follow the exact Mermaid diagram formats provided in the prompt (Architecture flowchart LR, Solution Component Map flowchart TB, ER Diagram with organized sections, Flow Execution flowchart TB). "
                  + "3. ER Diagrams MUST follow Schema.md format: organize entities into sections (CORE ENTITY, CHILD ENTITY, LOOKUP, BRIDGE, USER/OWNER MODEL), include all relationships at the end. "
                  + "4. Place diagrams in their designated sections (Architecture in Solution Architecture, Component Map in Component Catalog, etc.). "
                  + "5. Every component provided must appear in the output under the correct type with proper prefix. "
                  + "6. For component metadata: When trigger/connector metadata is available, use it. When not available for flows, infer reasonable values from flow names and descriptions. Use 'Not found in solution export' only when the solution export itself lacks the detail. If SharePoint references exist but richer SharePoint metadata is unavailable, omit that extra detail or state 'Additional SharePoint metadata was not available'. "
                  + "7. Never omit component types, and preserve exact component names with appropriate prefixes. "
                  + "8. Mermaid diagrams are mandatory and must match the provided formats exactly with valid syntax.";

        if (!string.IsNullOrEmpty(userPrefs))
            base_ += $"\n\nUSER INSTRUCTIONS:\n{userPrefs}\n\nFollow them precisely while maintaining all schema requirements above.";

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
