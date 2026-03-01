# Integration Tests

This directory contains integration tests for the Docker Compose setup.

## test_docker_compose.sh

Basic integration test that verifies:
1. Docker Compose build works (`docker compose build`)
2. Docker Compose up works (`docker compose up`)
3. All containers start successfully
4. Services are healthy and responding

### Running locally

```bash
./tests/test_docker_compose.sh
```

### Prerequisites

- Docker and Docker Compose installed
- Ports 3000 and 8000 available
- curl installed (for health checks)

