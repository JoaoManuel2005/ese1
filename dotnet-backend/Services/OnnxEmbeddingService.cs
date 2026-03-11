using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using Microsoft.ML.Tokenizers;
using System.Text.Json;
using System.Collections.Concurrent;

namespace RagBackend.Services;

/// <summary>
/// ONNX-based embedding service with support for multiple models.
/// Provides free, fast, local embeddings without external dependencies.
/// 
/// Recommended Models (in order of quality/performance tradeoff):
/// 
/// **Fastest (Good Quality):**
/// - all-MiniLM-L6-v2: 384 dims, 22M params - Current default
///   Download: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
/// 
/// **Better Quality (Slightly Slower):**
/// - all-MiniLM-L12-v2: 384 dims, 33M params - Better accuracy
///   Download: https://huggingface.co/sentence-transformers/all-MiniLM-L12-v2
/// 
/// - gte-small: 384 dims - Good balance, good for retrieval
///   Download: https://huggingface.co/thenlper/gte-small
/// 
/// **Best Quality (Slower but more accurate):**
/// - bge-small-en-v1.5: 384 dims - State-of-the-art small model
///   Download: https://huggingface.co/BAAI/bge-small-en-v1.5
/// 
/// - bge-base-en-v1.5: 768 dims - Best quality for RAG
///   Download: https://huggingface.co/BAAI/bge-base-en-v1.5
/// 
/// - e5-base-v2: 768 dims - Excellent for retrieval
///   Download: https://huggingface.co/intfloat/e5-base-v2
/// 
/// To use a different model:
/// 1. Download the ONNX model from HuggingFace
/// 2. Place in Models/ folder (e.g., Models/bge-small-en-v1.5.onnx)
/// 3. Set ONNX_MODEL_PATH in appsettings.json
/// 4. Ensure vocab.txt is in the same folder
/// </summary>
public class OnnxEmbeddingService : IDisposable
{
    private readonly ILogger<OnnxEmbeddingService> _logger;
    private readonly string _modelPath;
    private readonly int _maxSequenceLength;
    private InferenceSession? _session;
    private Tokenizer? _tokenizer;
    private bool _initialized;
    private int _embeddingDimension = 384; // Auto-detected from model

    public OnnxEmbeddingService(IConfiguration config, ILogger<OnnxEmbeddingService> logger)
    {
        _logger = logger;
        _modelPath = config["ONNX_MODEL_PATH"] ?? Path.Combine(
            AppDomain.CurrentDomain.BaseDirectory, "Models", "bge-base-en-v1.5.onnx");
        
        // Configure max sequence length (can be overridden in config)
        _maxSequenceLength = int.TryParse(config["ONNX_MAX_SEQUENCE_LENGTH"], out var len) ? len : 512;
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

            // Load ONNX model with GPU acceleration + optimizations for faster inference
            var sessionOptions = new Microsoft.ML.OnnxRuntime.SessionOptions();
            sessionOptions.GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL;
            sessionOptions.ExecutionMode = ExecutionMode.ORT_PARALLEL;
            sessionOptions.InterOpNumThreads = Environment.ProcessorCount;
            sessionOptions.IntraOpNumThreads = Environment.ProcessorCount;
            
            // Try to enable GPU acceleration (tries in order, falls back to CPU)
            var provider = TryEnableGpuAcceleration(sessionOptions);
            _logger.LogInformation("Using execution provider: {Provider}", provider);
            
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

            // Auto-detect embedding dimension from model output
            _embeddingDimension = DetectEmbeddingDimension();
            
            _initialized = true;
            var modelName = Path.GetFileNameWithoutExtension(_modelPath);
            _logger.LogInformation("✓ ONNX model '{Model}' loaded: {Dim} dimensions, max sequence: {MaxSeq}", 
                modelName, _embeddingDimension, _maxSequenceLength);
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

        // Process in parallel batches for 2-4x speedup
        const int batchSize = 128; // Increased from 32 for better throughput
        int batchNum = 0;
        for (int i = 0; i < textList.Count; i += batchSize)
        {
            batchNum++;
            var batchSw = System.Diagnostics.Stopwatch.StartNew();
            
            var batch = textList.Skip(i).Take(batchSize).ToList();
            var batchEmbeddings = ProcessBatchParallel(batch);
            allEmbeddings.AddRange(batchEmbeddings);

            _logger.LogInformation("    [ONNX] Batch {BatchNum} ({Count} texts) took {Ms}ms (parallel)", 
                batchNum, batch.Count, batchSw.ElapsedMilliseconds);
        }

        _logger.LogInformation("    [ONNX] ✓ Total embedding generation: {Sec:F1}s for {Count} texts", 
            totalSw.Elapsed.TotalSeconds, textList.Count);

        return allEmbeddings;
    }

    private List<float[]> ProcessBatchParallel(List<string> texts)
    {
        // Use parallel processing for 2-4x speedup
        var embeddingBag = new ConcurrentBag<(int index, float[] embedding)>();
        
        Parallel.For(0, texts.Count, new ParallelOptions 
        { 
            MaxDegreeOfParallelism = Environment.ProcessorCount 
        }, i =>
        {
            var text = texts[i];
            var embedding = ProcessSingleText(text);
            embeddingBag.Add((i, embedding));
        });

        // Return embeddings in original order
        return embeddingBag.OrderBy(x => x.index).Select(x => x.embedding).ToList();
    }

    private float[] ProcessSingleText(string text)
    {
        // Tokenize text with configured max length
        var truncated = text.Length > _maxSequenceLength * 4 ? text[..(_maxSequenceLength * 4)] : text;
        var encoded = _tokenizer!.EncodeToTokens(truncated, out var normalizedText);
        
        // CRITICAL: Truncate tokens to max sequence length to prevent ONNX errors
        var inputIds = encoded.Select(t => (long)t.Id).Take(_maxSequenceLength).ToArray();
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

        // Run inference (ONNX Runtime is thread-safe)
        using var results = _session!.Run(inputs);
        var outputTensor = results.First().AsTensor<float>();

        // Mean pooling (average of all token embeddings)
        return MeanPooling(outputTensor, attentionMask);
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

    private string TryEnableGpuAcceleration(Microsoft.ML.OnnxRuntime.SessionOptions options)
    {
        // Try GPU acceleration in order of preference
        // Falls back to CPU if GPU not available
        
        // 1. CoreML for Mac (Apple Silicon M1/M2/M3) - 3-5x faster
        if (OperatingSystem.IsMacOS())
        {
            try
            {
                options.AppendExecutionProvider_CoreML(
                    CoreMLFlags.COREML_FLAG_ENABLE_ON_SUBGRAPH | 
                    CoreMLFlags.COREML_FLAG_ONLY_ENABLE_DEVICE_WITH_ANE);
                return "CoreML (Apple Neural Engine)";
            }
            catch (Exception ex)
            {
                _logger.LogWarning("CoreML not available: {Message}. Trying CPU...", ex.Message);
            }
        }
        
        // 2. CUDA for NVIDIA GPUs (Linux/Windows) - 5-10x faster
        if (OperatingSystem.IsLinux() || OperatingSystem.IsWindows())
        {
            try
            {
                options.AppendExecutionProvider_CUDA(0);
                return "CUDA (NVIDIA GPU)";
            }
            catch (Exception ex)
            {
                _logger.LogDebug("CUDA not available: {Message}", ex.Message);
            }
        }
        
        // 3. DirectML for Windows (AMD/NVIDIA GPUs) - 3-8x faster
        if (OperatingSystem.IsWindows())
        {
            try
            {
                options.AppendExecutionProvider_DML(0);
                return "DirectML (Windows GPU)";
            }
            catch (Exception ex)
            {
                _logger.LogDebug("DirectML not available: {Message}", ex.Message);
            }
        }
        
        // 4. Fallback to CPU with optimizations
        return "CPU (optimized multi-threaded)";
    }

    private int DetectEmbeddingDimension()
    {
        // Auto-detect embedding dimension by checking model output metadata
        try
        {
            var outputMetadata = _session!.OutputMetadata;
            if (outputMetadata.Count > 0)
            {
                var firstOutput = outputMetadata.First().Value;
                if (firstOutput.Dimensions.Length >= 3)
                {
                    // Output shape is typically [batch, sequence, hidden_dim]
                    var dimension = (int)firstOutput.Dimensions[2];
                    _logger.LogInformation("Auto-detected embedding dimension: {Dim}", dimension);
                    return dimension;
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Could not auto-detect dimension, using default 384: {Msg}", ex.Message);
        }
        
        return 384; // Default fallback
    }

    public void Dispose()
    {
        _session?.Dispose();
    }
}
