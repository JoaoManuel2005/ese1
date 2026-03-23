#!/bin/bash
# Basic Docker Compose integration tests
# Tests that docker compose build and up work correctly

set -e

echo "🧪 Running Docker Compose integration tests..."

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Docker Compose Build
echo -e "${YELLOW}Test 1: Building Docker containers...${NC}"
if docker compose build --no-cache; then
    echo -e "${GREEN}✅ Docker compose build passed${NC}"
else
    echo -e "${RED}❌ Docker compose build failed${NC}"
    exit 1
fi

# Test 2: Docker Compose Up
echo -e "${YELLOW}Test 2: Starting containers...${NC}"
if docker compose up -d; then
    echo -e "${GREEN}✅ Docker compose up passed${NC}"
else
    echo -e "${RED}❌ Docker compose up failed${NC}"
    docker compose down -v || true
    exit 1
fi

# Test 3: Wait for services to be ready
echo -e "${YELLOW}Test 3: Waiting for services to be ready...${NC}"
sleep 10

# Test 4: Check container status
echo -e "${YELLOW}Test 4: Checking container status...${NC}"
if docker compose ps | grep -q "Up"; then
    echo -e "${GREEN}✅ Containers are running${NC}"
else
    echo -e "${RED}❌ Containers are not running${NC}"
    docker compose ps
    docker compose logs
    docker compose down -v || true
    exit 1
fi

# Test 5: Health check - RAG Backend
echo -e "${YELLOW}Test 5: Checking RAG backend health...${NC}"
MAX_RETRIES=30
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -f http://localhost:8000/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ RAG backend is healthy${NC}"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        echo -e "${RED}❌ RAG backend health check failed after $MAX_RETRIES retries${NC}"
        docker compose logs rag-backend
        docker compose down -v || true
        exit 1
    fi
    echo "  Waiting for RAG backend... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done

# Test 6: Health check - Documentation Generator
echo -e "${YELLOW}Test 6: Checking documentation generator...${NC}"
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -f http://localhost:3000 > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Documentation generator is responding${NC}"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        echo -e "${RED}❌ Documentation generator health check failed after $MAX_RETRIES retries${NC}"
        docker compose logs documentation-generator
        docker compose down -v || true
        exit 1
    fi
    echo "  Waiting for documentation generator... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done

# Test 7: Verify all expected containers are running
echo -e "${YELLOW}Test 7: Verifying all containers are running...${NC}"
EXPECTED_CONTAINERS=("rag-backend" "documentation-generator" "pac-cli")
for container in "${EXPECTED_CONTAINERS[@]}"; do
    if docker compose ps | grep -q "$container.*Up"; then
        echo -e "${GREEN}✅ Container $container is running${NC}"
    else
        echo -e "${RED}❌ Container $container is not running${NC}"
        docker compose ps
        docker compose down -v || true
        exit 1
    fi
done

# Cleanup
echo -e "${YELLOW}Cleaning up...${NC}"
docker compose down -v || true

echo -e "${GREEN}🎉 All Docker Compose tests passed!${NC}"

