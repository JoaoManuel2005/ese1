# BGE Embeddings Integration Guide

## ✅ What's Done

The C# backend now supports **two embedding providers**:

1. **BGE (free local)** - `BAAI/bge-small-en-v1.5` via Python service
2. **Azure OpenAI** - `text-embedding-ada-002` (paid)

## 🚀 Quick Start

### Option 1: Use BGE (Free, Local)

**Terminal 1 - Start BGE Service:**
```bash
cd /Users/tussharlingagiri/ese1/embedding-service
./start.sh
```
Wait for: `"BGE model loaded successfully"`

**Configure C# backend** - Already set in `appsettings.json`:
```json
{
  "EMBEDDING_PROVIDER": "bge",
  "BGE_SERVICE_URL": "http://localhost:8002"
}
```

**Terminal 2 - Start C# Backend:**
```bash
cd /Users/tussharlingagiri/ese1/dotnet-backend
dotnet run
```

**Terminal 3 - Start Frontend:**
```bash
cd /Users/tussharlingagiri/ese1/documentation_generator
npm run dev
```

### Option 2: Use Azure OpenAI (Paid)

**Edit `.env` or `appsettings.json`:**
```json
{
  "EMBEDDING_PROVIDER": "azure",
  "AZURE_OPENAI_API_KEY": "your-key",
  "AZURE_OPENAI_ENDPOINT": "https://your-endpoint.openai.azure.com/",
  "EMBEDDING_MODEL": "text-embedding-ada-002"
}
```

Then start only the C# backend and frontend (no BGE service needed).

## 🧪 Test BGE Service

```bash
# Health check
curl http://localhost:8002/health

# Generate embeddings
curl -X POST http://localhost:8002/embed \
  -H "Content-Type: application/json" \
  -d '{"texts": ["Hello world", "Test document"]}'
```

Expected response:
```json
{
  "embeddings": [[0.1, 0.2, ...], [0.3, 0.4, ...]],
  "model": "BAAI/bge-small-en-v1.5",
  "dimension": 384
}
```

## 📊 Comparison

| Feature | BGE (Local) | Azure OpenAI |
|---------|-------------|--------------|
| **Cost** | Free | ~$0.0001/1K tokens |
| **Speed** | Fast (local) | Network latency |
| **Quality** | Good (384-dim) | Excellent (1536-dim) |
| **Setup** | Python service | API key only |
| **Dimension** | 384 | 1536 |

## 🔧 Architecture

```
Frontend (Next.js :3000)
    ↓
C# Backend (:8001)
    ↓ (if EMBEDDING_PROVIDER=bge)
Python BGE Service (:8002) — sentence-transformers
    ↓
BGE Model (BAAI/bge-small-en-v1.5)
```

## 📝 Configuration Reference

**`appsettings.json` / `.env`:**

```bash
# Embedding provider: "bge" or "azure"
EMBEDDING_PROVIDER=bge

# BGE service endpoint
BGE_SERVICE_URL=http://localhost:8002

# Azure OpenAI (only if EMBEDDING_PROVIDER=azure)
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=...
EMBEDDING_MODEL=text-embedding-ada-002
```

## 🐛 Troubleshooting

**"BGE embedding service unavailable"**
- Start the BGE service: `cd embedding-service && ./start.sh`
- Check it's running: `curl http://localhost:8002/health`

**"Port 8002 already in use"**
- Change `BGE_SERVICE_URL` in `appsettings.json`
- Update `app.py` port: `uvicorn.run(app, host="0.0.0.0", port=YOUR_PORT)`

**Slow first embedding**
- First request downloads the BGE model (~90MB)
- Subsequent requests are fast

## 🔄 Switching Providers

**Runtime switch without restart:**
Currently requires restart. Future: add `/api/embedding/switch` endpoint.

**Development recommendation:**
- Use BGE for development (free, no API key needed)
- Use Azure OpenAI for production (higher quality, simpler deployment)
