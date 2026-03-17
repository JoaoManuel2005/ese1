# ── Build stage ──────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY RagBackend.csproj .
RUN dotnet restore

COPY . .

# Download bge-base-en-v1.5 ONNX model (768 dims, best quality for RAG)
# Downloads ~176MB model at build time with retry logic for reliability
RUN mkdir -p Models && cd Models && \
    echo "📥 Downloading bge-base-en-v1.5 embedding model (~176MB)..." && \
    for i in 1 2 3; do \
        curl -L --fail --retry 5 --retry-delay 3 --max-time 600 --connect-timeout 30 \
            https://huggingface.co/BAAI/bge-base-en-v1.5/resolve/main/onnx/model.onnx \
            -o bge-base-en-v1.5.onnx && break || \
        { echo "⚠️  Attempt $i failed, retrying..." && sleep 5; }; \
    done && \
    for i in 1 2 3; do \
        curl -L --fail --retry 5 --retry-delay 3 --max-time 60 --connect-timeout 30 \
            https://huggingface.co/BAAI/bge-base-en-v1.5/resolve/main/vocab.txt \
            -o vocab.txt && break || \
        { echo "⚠️  Attempt $i failed, retrying..." && sleep 5; }; \
    done && \
    echo "✓ Model downloaded: $(du -h bge-base-en-v1.5.onnx | cut -f1)" && \
    ls -lh bge-base-en-v1.5.onnx vocab.txt

RUN dotnet publish -c Release -o /app/publish

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

# Install latest Docker CLI from official repo (needed for PAC parsing via docker exec)
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/publish .
COPY --from=build /src/Models ./Models

EXPOSE 8001
ENV ASPNETCORE_URLS=http://0.0.0.0:8001

ENTRYPOINT ["dotnet", "RagBackend.dll"]
