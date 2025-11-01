### Multi-stage Dockerfile for smaller, hardened image
FROM python:3.10-slim AS builder
WORKDIR /app

# Install build deps and pinned requirements
COPY requirements-lock.txt ./requirements-lock.txt
RUN python -m pip install --upgrade pip setuptools wheel && \
		pip install --no-cache-dir -r requirements-lock.txt --prefix=/install

FROM python:3.10-slim AS runtime
WORKDIR /app

# Create non-root user
RUN useradd --create-home --shell /bin/bash appuser && \
		mkdir /app/logs && chown -R appuser:appuser /app

# Copy installed site-packages from builder
COPY --from=builder /install /usr/local

# Copy app sources
COPY . /app

ENV PYTHONUNBUFFERED=1
ENV PATH="/usr/local/bin:$PATH"

# Switch to non-root user
USER appuser

# Healthcheck: probe the /health endpoint started by the app
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD curl -f http://localhost:8080/health || exit 1

CMD ["python", "app.py"]
