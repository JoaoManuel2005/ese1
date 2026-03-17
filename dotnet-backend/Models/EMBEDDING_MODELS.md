# ONNX Embedding Models

This folder contains local embedding models that run without API costs.

## 📥 Quick Download Links

### Current Model (Default)
- **all-MiniLM-L6-v2** (384 dims, 22M params)
  - Model: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx
  - Vocab: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/vocab.txt
  - Speed: ⚡⚡⚡⚡⚡ | Quality: ⭐⭐⭐

### Better Models (Recommended Upgrades)

#### **bge-small-en-v1.5** (384 dims, SOTA small model)
```bash
cd dotnet-backend/Models
wget https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/onnx/model.onnx -O bge-small-en-v1.5.onnx
wget https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/vocab.txt -O bge-small-en-v1.5-vocab.txt
```
- Speed: ⚡⚡⚡⚡ | Quality: ⭐⭐⭐⭐⭐
- **Best balance of speed/quality**

#### **bge-base-en-v1.5** (768 dims, best for RAG)
```bash
cd dotnet-backend/Models
wget https://huggingface.co/BAAI/bge-base-en-v1.5/resolve/main/onnx/model.onnx -O bge-base-en-v1.5.onnx
wget https://huggingface.co/BAAI/bge-base-en-v1.5/resolve/main/vocab.txt
```
- Speed: ⚡⚡⚡ | Quality: ⭐⭐⭐⭐⭐⭐
- **Best quality for retrieval**

#### **gte-small** (384 dims, good for retrieval)
```bash
cd dotnet-backend/Models
wget https://huggingface.co/thenlper/gte-small/resolve/main/onnx/model.onnx -O gte-small.onnx
wget https://huggingface.co/thenlper/gte-small/resolve/main/vocab.txt
```
- Speed: ⚡⚡⚡⚡ | Quality: ⭐⭐⭐⭐

## 🔧 Configuration

Edit `appsettings.json`:

```json
{
  "ONNX_MODEL_PATH": "models/bge-small-en-v1.5.onnx",
  "ONNX_MAX_SEQUENCE_LENGTH": "512"
}
```

## 📊 Model Comparison

| Model | Dims | Params | Speed | Quality | Best For |
|-------|------|--------|-------|---------|----------|
| all-MiniLM-L6-v2 | 384 | 22M | ⚡⚡⚡⚡⚡ | ⭐⭐⭐ | General use, fast |
| all-MiniLM-L12-v2 | 384 | 33M | ⚡⚡⚡⚡ | ⭐⭐⭐⭐ | Better quality |
| gte-small | 384 | 33M | ⚡⚡⚡⚡ | ⭐⭐⭐⭐ | Retrieval tasks |
| bge-small-en-v1.5 | 384 | 33M | ⚡⚡⚡⚡ | ⭐⭐⭐⭐⭐ | **Best balance** |
| bge-base-en-v1.5 | 768 | 109M | ⚡⚡⚡ | ⭐⭐⭐⭐⭐⭐ | **Best RAG quality** |
| e5-base-v2 | 768 | 109M | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ | Research/accuracy |

## ⚡ Performance Tips

1. **For Mac (Apple Silicon)**: Models will auto-use CoreML acceleration
2. **For Windows (GPU)**: Models will auto-use DirectML/CUDA
3. **Larger models** (768 dims) give better quality but are slower
4. **Smaller models** (384 dims) are faster and often sufficient

## 🎯 Recommendation

For most use cases: **bge-small-en-v1.5** is the best upgrade
- Same speed as default
- Significantly better retrieval quality
- Works great with GPU acceleration
