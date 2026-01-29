# Docker Setup for Documentation Generator

This project includes Docker configuration for deploying the Documentation Generator frontend and RAG Backend as containerized services that work together seamlessly.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Docker Network                          │
│                    (docgen-network)                          │
│                                                              │
│  ┌─────────────────────┐     ┌─────────────────────────┐   │
│  │  Documentation      │     │    RAG Backend          │   │
│  │  Generator          │────▶│    (FastAPI/Python)     │   │
│  │  (Next.js)          │     │                         │   │
│  │  Port: 3000         │     │    Port: 8000           │   │
│  └─────────────────────┘     └─────────────────────────┘   │
│                                        │                     │
│                              ┌─────────▼─────────┐          │
│                              │   ChromaDB        │          │
│                              │   (Volume)        │          │
│                              └───────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- API keys for LLM providers (OpenAI, Anthropic, etc.)

### 1. Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your API keys
nano .env
```

### 2. Build and Start

```bash
# Using the helper script
./docker-build.sh build   # Build images
./docker-build.sh up      # Start services

# Or using docker-compose directly
docker-compose build
docker-compose up -d
```

### 3. Access the Application

- **Documentation Generator**: http://localhost:3000
- **RAG Backend API**: http://localhost:8000
- **RAG Backend Docs**: http://localhost:8000/docs

## Docker Commands

### Using the Helper Script

```bash
./docker-build.sh build         # Build Docker images
./docker-build.sh up            # Start production services
./docker-build.sh dev           # Start development services (with hot-reload)
./docker-build.sh down          # Stop all services
./docker-build.sh restart       # Restart all services
./docker-build.sh logs          # View logs from all services
./docker-build.sh logs-backend  # View RAG backend logs only
./docker-build.sh logs-frontend # View frontend logs only
./docker-build.sh status        # Show container status
./docker-build.sh clean         # Remove all containers, images, and volumes
```

### Using Docker Compose Directly

```bash
# Production
docker-compose build
docker-compose up -d
docker-compose down
docker-compose logs -f

# Development (with hot-reload)
docker-compose -f docker-compose.dev.yml up --build
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for GPT models | - |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude models | - |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key | - |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint URL | - |
| `DEFAULT_PROVIDER` | Default LLM provider | `openai` |
| `DEFAULT_MODEL` | Default model to use | `gpt-4o-mini` |
| `CLEAR_DB_ON_START` | Clear vector DB on startup | `false` |
| `RAG_BACKEND_URL` | RAG backend URL (auto-configured in Docker) | `http://rag-backend:8000` |

### Volumes

- `rag_chroma_data`: Persists the ChromaDB vector database between container restarts

### Networks

- `docgen-network`: Internal Docker network for service communication

## Files Structure

```
├── docker-compose.yml          # Production compose configuration
├── docker-compose.dev.yml      # Development compose configuration
├── docker-build.sh             # Helper script for common Docker operations
├── .env.example                # Example environment configuration
├── .env                        # Your local environment (not in git)
├── documentation_generator/
│   ├── Dockerfile              # Production Dockerfile (multi-stage)
│   ├── Dockerfile.dev          # Development Dockerfile
│   └── .dockerignore           # Files to exclude from Docker build
└── rag_backend/
    ├── Dockerfile              # Python FastAPI Dockerfile
    └── .dockerignore           # Files to exclude from Docker build
```

## Development

### Hot-Reload Development

For development with hot-reload, use the development compose file:

```bash
docker-compose -f docker-compose.dev.yml up --build
```

This mounts the source code as volumes, enabling live code changes without rebuilding.

### Rebuilding After Changes

If you modify dependencies (package.json or requirements.txt):

```bash
docker-compose build --no-cache
docker-compose up -d
```

## Troubleshooting

### Container Health Checks

```bash
# Check container health status
docker-compose ps

# View health check logs
docker inspect --format='{{json .State.Health}}' rag-backend | jq
```

### Common Issues

1. **Port already in use**: Stop any local development servers running on ports 3000 or 8000
2. **Build fails**: Ensure Docker has enough resources allocated
3. **API errors**: Verify your API keys are correctly set in `.env`

### Viewing Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f rag-backend
docker-compose logs -f documentation-generator
```

## Production Considerations

1. **Security**: 
   - Never commit `.env` files with API keys
   - Use Docker secrets or environment variable injection in production
   
2. **Scaling**:
   - The RAG backend can be scaled horizontally
   - Consider adding a reverse proxy (nginx, traefik) for load balancing

3. **Persistence**:
   - ChromaDB data is persisted in a Docker volume
   - For production, consider external database storage

4. **Monitoring**:
   - Health check endpoints are configured for both services
   - Add container monitoring (Prometheus, Grafana) for production
