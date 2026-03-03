using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using Microsoft.ML.Tokenizers;
using System.Text.Json;

namespace RagBackend.Services;

/// <summary>
/// ONNX-based embedding service using all-MiniLM-L6-v2 model.
/// Provides free, fast, local embeddings without external dependencies.
/// </summary>
public class OnnxEmbeddingService : IDisposable
{
    private readonly ILogger<OnnxEmbeddingService> _logger;
    private readonly string _modelPath;
    private InferenceSession? _session;
    private Tokenizer? _tokenizer;
    private bool _initialized;

    public OnnxEmbeddingService(IConfiguration config, ILogger<OnnxEmbeddingService> logger)
    {
        _logger = logger;
        _modelPath = config["ONNX_MODEL_PATH"] ?? Path.Combine(
            AppDomain.CurrentDomain.BaseDirectory, "Models", "all-MiniLM-L6-v2.onnx");
    }

    public async Task InitializeAsync()
    {
        if (_initialized) return;

        try
        {
            _logger.LogInformation("Initializing ONNX embedding model from {Path}", _modelPath);

            // Check if model exists
            if (!File.Exists(_modelPath))
            {
                throw new FileNotFoundException(
                    $"ONNX model not found at {_modelPath}. " +
                    $"Download from: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx");
            }

            // Load ONNX model
            var sessionOptions = new Microsoft.ML.OnnxRuntime.SessionOptions();
            _session = new InferenceSession(_modelPath, sessionOptions);

            // Create tokenizer (WordPiece for BERT-based models)
            var vocabPath = Path.Combine(Path.GetDirectoryName(_modelPath)!, "vocab.txt");
            if (!File.Exists(vocabPath))
            {
                throw new FileNotFoundException(
                    $"Tokenizer vocab.txt not found at {vocabPath}. " +
                    $"Download from: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/vocab.txt");
            }

            var vocabStream = File.OpenRead(vocabPath);
            _tokenizer = await BertTokenizer.CreateAsync(vocabStream);

            _initialized = true;
            _logger.LogInformation("✓ ONNX embedding model loaded successfully (384 dimensions)");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to initialize ONNX embedding model");
            throw;
        }
    }

    public async Task<float[]> GenerateEmbeddingAsync(string text)
    {
        var embeddings = await GenerateBatchEmbeddingsAsync(new[] { text });
        return embeddings[0];
    }

    public async Task<List<float[]>> GenerateBatchEmbeddingsAsync(IEnumerable<string> texts)
    {
        if (!_initialized)
            await InitializeAsync();

        if (_session == null || _tokenizer == null)
            throw new InvalidOperationException("ONNX model not initialized");

        var textList = texts.ToList();
        var allEmbeddings = new List<float[]>();

        _logger.LogInformation("    [ONNX] Starting embedding generation for {Count} texts...", textList.Count);
        var totalSw = System.Diagnostics.Stopwatch.StartNew();

        // Process in batches to avoid memory issues
        const int batchSize = 32;
        int batchNum = 0;
        for (int i = 0; i < textList.Count; i += batchSize)
        {
            batchNum++;
            var batchSw = System.Diagnostics.Stopwatch.StartNew();
            
            var batch = textList.Skip(i).Take(batchSize).ToList();
            var batchEmbeddings = ProcessBatch(batch);
            allEmbeddings.AddRange(batchEmbeddings);

            _logger.LogInformation("    [ONNX] Batch {BatchNum} ({Count} texts) took {Ms}ms", 
                batchNum, batch.Count, batchSw.ElapsedMilliseconds);
        }

        _logger.LogInformation("    [ONNX] ✓ Total embedding generation: {Sec:F1}s for {Count} texts", 
            totalSw.Elapsed.TotalSeconds, textList.Count);

        return allEmbeddings;
    }

    private List<float[]> ProcessBatch(List<string> texts)
    {
        var embeddings = new List<float[]>();

        foreach (var text in texts)
        {
            // Tokenize text
            var truncated = text.Length > 256 ? text[..256] : text;
            var encoded = _tokenizer!.EncodeToTokens(truncated, out var normalizedText);
            
            var inputIds = encoded.Select(t => (long)t.Id).ToArray();
            var attentionMask = Enumerable.Repeat(1L, inputIds.Length).ToArray();
            var tokenTypeIds = new long[inputIds.Length]; // All zeros for single sentence

            // Create input tensors
            var inputIdsTensor = new DenseTensor<long>(inputIds, new[] { 1, inputIds.Length });
            var attentionMaskTensor = new DenseTensor<long>(attentionMask, new[] { 1, attentionMask.Length });
            var tokenTypeIdsTensor = new DenseTensor<long>(tokenTypeIds, new[] { 1, tokenTypeIds.Length });

            var inputs = new List<NamedOnnxValue>
            {
                NamedOnnxValue.CreateFromTensor("input_ids", inputIdsTensor),
                NamedOnnxValue.CreateFromTensor("attention_mask", attentionMaskTensor),
                NamedOnnxValue.CreateFromTensor("token_type_ids", tokenTypeIdsTensor)
            };

            // Run inference
            using var results = _session!.Run(inputs);
            var outputTensor = results.First().AsTensor<float>();

            // Mean pooling (average of all token embeddings)
            var embedding = MeanPooling(outputTensor, attentionMask);
            embeddings.Add(embedding);
        }

        return embeddings;
    }

    private static float[] MeanPooling(Tensor<float> tokenEmbeddings, long[] attentionMask)
    {
        // tokenEmbeddings shape: [1, seq_len, hidden_size]
        var seqLen = tokenEmbeddings.Dimensions[1];
        var hiddenSize = tokenEmbeddings.Dimensions[2];

        var sumEmbedding = new float[hiddenSize];
        var sumMask = 0L;

        for (int i = 0; i < seqLen; i++)
        {
            if (attentionMask[i] == 1)
            {
                for (int j = 0; j < hiddenSize; j++)
                {
                    sumEmbedding[j] += tokenEmbeddings[0, i, j];
                }
                sumMask++;
            }
        }

        // Average
        for (int j = 0; j < hiddenSize; j++)
        {
            sumEmbedding[j] /= sumMask;
        }

        // Normalize (L2 norm)
        var norm = Math.Sqrt(sumEmbedding.Sum(x => x * x));
        for (int j = 0; j < hiddenSize; j++)
        {
            sumEmbedding[j] /= (float)norm;
        }

        return sumEmbedding;
    }

    public void Dispose()
    {
        _session?.Dispose();
    }
}
