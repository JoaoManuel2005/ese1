# GPU Acceleration for Production Deployment

## Overview
The RAG backend supports GPU acceleration for 5-10x faster embedding generation in production environments.

**GPU support is automatic and graceful:**
- ✅ If NVIDIA GPU detected: Automatically enables CUDA acceleration
- ✅ If no GPU available: Falls back to optimized CPU multi-threading
- ✅ No manual configuration needed when using `./scripts/up.sh`

## Quick Start

### Using the Built-in Scripts (Recommended)

**Linux/Mac:**
```bash
./scripts/up.sh
# Automatically detects and uses GPU if available
```

**Windows:**
```powershell
.\scripts\up.ps1
# Automatically detects and uses GPU if available
```

The scripts automatically detect NVIDIA GPUs and enable acceleration. No configuration needed!

## Platform Support

### ✅ Production (GPU Enabled)
- **Linux with NVIDIA GPU**: Full CUDA support in Docker
- **Windows with NVIDIA GPU**: Full CUDA support in Docker  
- **Azure Container Apps/AKS with GPU nodes**: Full support
- **AWS ECS/EKS with GPU instances**: Full support
- **GCP Cloud Run/GKE with GPU**: Full support

### ⚠️ Local Development
- **Mac (Apple Silicon)**: GPU only works natively, NOT in Docker
  - Docker: CPU multi-threaded (2-4x speedup from optimizations)
  - Native: CoreML/ANE support (3-5x additional speedup)

## Production Deployment with GPU

### 1. Automatic Detection (Recommended)

Use the provided scripts which auto-detect GPU availability:

```bash
# Linux/Mac
./scripts/up.sh

# Windows
.\scripts\up.ps1
```

### 2. Manual Docker Compose (Linux/Windows with NVIDIA)

**Prerequisites:**
```bash
# Install NVIDIA Container Toolkit
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
  sudo tee /etc/apt/sources.list.d/nvidia-docker.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker
```

**Run with GPU:**
```bash
docker compose -f docker-compose.dotnet.yml -f docker-compose.gpu.yml up -d
```

**Run without GPU (fallback to CPU):**
```bash
docker compose -f docker-compose.dotnet.yml up -d
```

**Verify GPU usage:**
```bash
docker logs rag-backend-dotnet | grep "execution provider"
# With GPU: "Using execution provider: CUDA (NVIDIA GPU)"
# Without GPU: "Using execution provider: CPU (optimized multi-threaded)"
```

### 3. Azure Container Apps with GPU

**Deploy to Azure with GPU-enabled container:**
```bash
az containerapp create \
  --name rag-backend \
  --resource-group myResourceGroup \
  --environment myEnvironment \
  --image myregistry.azurecr.io/rag-backend:latest \
  --target-port 8001 \
  --gpu-count 1 \
  --gpu-type T4
```

The ONNX service will automatically detect and use CUDA.

### 4. Kubernetes with GPU

**Node pool with GPU:**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: rag-backend
spec:
  containers:
  - name: rag-backend
    image: myregistry.azurecr.io/rag-backend:latest
    resources:
      limits:
        nvidia.com/gpu: 1
```

## Performance Comparison

| Environment | Execution Provider | Speedup | Cost |
|-------------|-------------------|---------|------|
| Docker on Mac (Dev) | CPU multi-threaded | 2-4x | Baseline |
| Native Mac (Dev) | CoreML/ANE | 6-15x | Baseline |
| Production Linux/Windows | CUDA GPU | 10-50x | +GPU cost |
| Production CPU | CPU multi-threaded | 2-4x | Baseline |

## Current Configuration

The service automatically tries GPU in this order:
1. **CoreML** (Mac native only) → Apple Neural Engine
2. **CUDA** (NVIDIA GPU) → High performance
3. **DirectML** (Windows AMD/Intel GPU) → Moderate performance  
4. **CPU** (fallback) → Multi-threaded optimization

Check logs for: `"Using execution provider: [PROVIDER]"`

## Recommendations

### Development (Mac)
- Use Docker for consistency with production
- Accept CPU performance (still 2-4x faster with optimizations)
- Run native if you need max speed locally: `cd dotnet-backend && dotnet run`

### Production
- **High throughput needs**: Deploy with GPU (CUDA on Linux/Windows)
- **Cost-sensitive**: Use CPU with multi-threading (still good performance)
- **Cloud deployment**: Use GPU instances (T4, A10, etc.) for best ROI

## Troubleshooting

**GPU not detected in production:**
```bash
# Check NVIDIA driver
nvidia-smi

# Check Docker can access GPU
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi

# Check container logs
docker logs rag-backend-dotnet 2>&1 | grep -i "gpu\|cuda\|provider"
```

**Still shows CPU in production:**
- Verify GPU is enabled in docker-compose or K8s manifest
- Check NVIDIA Container Toolkit is installed
- Verify GPU drivers are installed on host
- Check CUDA version compatibility (requires CUDA 11.x or 12.x)
