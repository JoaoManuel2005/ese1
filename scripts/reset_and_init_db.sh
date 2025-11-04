#!/bin/bash
# Reset and initialize ChromaDB for the RAG system

set -e

echo "🗑️  Cleaning up old database..."
rm -rf chroma_db/

echo "📁 Creating fresh ChromaDB..."
source .venv/bin/activate
python -c "import chromadb; client = chromadb.PersistentClient(path='./chroma_db'); collection = client.get_or_create_collection(name='rag_collection'); print('✅ ChromaDB initialized successfully')"

echo ""
echo "✅ Database reset complete!"
echo "You can now upload and process documents through the frontend."
