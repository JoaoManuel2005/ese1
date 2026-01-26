#!/bin/bash

# =============================================================================
# Clean Chunks & ChromaDB Script
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/rag_backend"
CHUNKS_DIR="$PROJECT_DIR/chunks"

echo -e "${BLUE}==============================================================================${NC}"
echo -e "${BLUE}     Cleaning Chunks & ChromaDB${NC}"
echo -e "${BLUE}==============================================================================${NC}"
echo ""

# Delete chunk files
if [ -d "$CHUNKS_DIR" ]; then
    echo -e "${YELLOW}Removing chunk files...${NC}"
    rm -f "$CHUNKS_DIR"/*.txt "$CHUNKS_DIR"/*.json 2>/dev/null
    echo -e "${GREEN}✓ Chunks folder cleared${NC}"
else
    echo -e "${YELLOW}⚠ Chunks folder not found${NC}"
fi

# Clear ChromaDB via API (if server is running)
echo -e "${YELLOW}Clearing ChromaDB...${NC}"
RESPONSE=$(curl -s -X POST http://localhost:8000/rag/clear 2>/dev/null)
if [ $? -eq 0 ] && echo "$RESPONSE" | grep -q "success"; then
    echo -e "${GREEN}✓ ChromaDB cleared via API${NC}"
else
    echo -e "${YELLOW}Backend not running. Deleting ChromaDB folder directly...${NC}"
    rm -rf "$BACKEND_DIR/rag_chroma_db" 2>/dev/null
    echo -e "${GREEN}✓ ChromaDB folder deleted${NC}"
fi

echo ""
echo -e "${GREEN}==============================================================================${NC}"
echo -e "${GREEN}     All data cleared! Ready for fresh start.${NC}"
echo -e "${GREEN}==============================================================================${NC}"
echo ""
