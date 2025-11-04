from fastapi import FastAPI, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from rag_pipeline import RAGPipeline
from pathlib import Path
import os
import stat
import logging
import chromadb
import httpx

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

rag_pipeline = RAGPipeline()

def ensure_chroma_db_writable():
    """Ensure ChromaDB directory has proper write permissions."""
    db_path = Path("./chroma_db").absolute()
    db_path.mkdir(parents=True, exist_ok=True)
    
    try:
        # Set directory permissions to 755 (rwxr-xr-x)
        os.chmod(db_path, stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP | stat.S_IROTH | stat.S_IXOTH)
        
        # Set all files and subdirectories to writable
        for root, dirs, files in os.walk(db_path):
            for d in dirs:
                dir_path = Path(root) / d
                try:
                    os.chmod(dir_path, stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP | stat.S_IROTH | stat.S_IXOTH)
                except:
                    pass
            for f in files:
                file_path = Path(root) / f
                try:
                    os.chmod(file_path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
                except:
                    pass
    except Exception as e:
        logging.warning(f"Could not set ChromaDB permissions: {e}")
    
    return db_path

@app.post("/upload")
async def upload_endpoint(file: UploadFile = File(...)):
    """Step 1: Upload document to /data directory"""
    try:
        data_dir = Path("./data")
        data_dir.mkdir(exist_ok=True)
        
        file_path = data_dir / file.filename
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)
        
        logging.info(f"File uploaded to {file_path}")
        
        return {
            "message": f"✅ File '{file.filename}' uploaded successfully.",
            "filename": file.filename,
            "size": len(content)
        }
    except Exception as e:
        logging.error(f"Upload error: {e}")
        return {"message": f"❌ Error during upload: {str(e)}", "error": True}

@app.post("/chunk")
async def chunk_endpoint(request: Request):
    """Step 2: Parse and chunk document, save chunks to /chunks directory"""
    try:
        body = await request.json()
        filename = body.get("filename")
        
        if not filename:
            return {"message": "❌ No filename provided", "error": True}
        
        data_dir = Path("./data")
        file_path = data_dir / filename
        
        if not file_path.exists():
            return {"message": f"❌ File '{filename}' not found", "error": True}
        
        # Use MinimalMultiFormatParser to parse and chunk
        import PyPDF2
        from bs4 import BeautifulSoup
        from llama_index.core.schema import Document
        
        ext = os.path.splitext(filename)[1].lower()
        text = ""
        
        if ext == ".pdf":
            with open(file_path, "rb") as f:
                reader = PyPDF2.PdfReader(f)
                text = "\n".join(page.extract_text() or "" for page in reader.pages)
        elif ext in [".htm", ".html"]:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                soup = BeautifulSoup(f, "html.parser")
                text = soup.get_text(separator="\n")
        elif ext in [".xml", ".xsd"]:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                soup = BeautifulSoup(f, "xml")
                text = soup.get_text(separator="\n")
        elif ext == ".txt":
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
        
        if not text:
            return {"message": "❌ Could not extract text from document", "error": True}
        
        # Create document and use llama_index to chunk it
        from llama_index.core.node_parser import SentenceSplitter
        
        document = Document(text=text, metadata={"file_name": filename})
        splitter = SentenceSplitter(chunk_size=512, chunk_overlap=50)
        chunks = splitter.get_nodes_from_documents([document])
        
        # Save chunks to files
        chunks_dir = Path("./chunks")
        chunks_dir.mkdir(exist_ok=True)
        
        base_name = os.path.splitext(filename)[0]
        for idx, chunk in enumerate(chunks, start=1):
            chunk_filename = f"{base_name}_chunk{idx:03d}.txt"
            chunk_path = chunks_dir / chunk_filename
            with open(chunk_path, "w", encoding="utf-8") as f:
                f.write(chunk.get_content())
        
        logging.info(f"Document chunked: {len(chunks)} chunks created")
        
        return {
            "message": f"✅ Document chunked successfully. {len(chunks)} chunks saved.",
            "chunks_count": len(chunks),
            "filename": filename
        }
    except Exception as e:
        logging.error(f"Chunking error: {e}")
        import traceback
        traceback.print_exc()
        return {"message": f"❌ Error during chunking: {str(e)}", "error": True}

@app.post("/embed")
async def embed_endpoint(request: Request):
    """Step 3: Generate embeddings from chunks using selected model"""
    try:
        body = await request.json()
        model = body.get("model", "sentence-transformers")
        
        chunks_dir = Path("./chunks")
        if not chunks_dir.exists():
            return {"message": "❌ No chunks directory found", "error": True}
        
        chunk_files = list(chunks_dir.glob("*.txt"))
        if not chunk_files:
            return {"message": "❌ No chunks found", "error": True}
        
        # Import necessary components
        from llama_index.core import Document, VectorStoreIndex
        from llama_index.core import Settings
        
        # Load chunks as documents
        documents = []
        for chunk_file in chunk_files:
            with open(chunk_file, 'r', encoding='utf-8') as f:
                text = f.read()
                documents.append(Document(text=text, metadata={"source": chunk_file.name}))
        
        logging.info(f"Generating embeddings for {len(documents)} documents using model: {model}")
        
        # Configure embedding model based on selection
        if model == "openai":
            from llama_index.embeddings.openai import OpenAIEmbedding
            Settings.embed_model = OpenAIEmbedding(model="text-embedding-3-small")
        elif model == "bedrock":
            # AWS Bedrock Titan embeddings
            logging.warning("Bedrock embeddings require AWS credentials")
        else:
            # Free models: sentence-transformers, bge-small, instructor, e5-small
            from llama_index.core.embeddings import BaseEmbedding
            from sentence_transformers import SentenceTransformer
            
            model_map = {
                "sentence-transformers": "sentence-transformers/all-MiniLM-L6-v2",
                "bge-small": "BAAI/bge-small-en-v1.5",
                "instructor": "hkunlp/instructor-base",
                "e5-small": "intfloat/e5-small-v2"
            }
            model_name = model_map.get(model, "sentence-transformers/all-MiniLM-L6-v2")
            
            # Create a proper BaseEmbedding wrapper
            class SentenceTransformerEmbedding(BaseEmbedding):
                def __init__(self, model_name: str):
                    super().__init__()
                    self._model = SentenceTransformer(model_name)
                    self.model_name = model_name
                
                def _get_query_embedding(self, query: str):
                    return self._model.encode(query).tolist()
                
                def _get_text_embedding(self, text: str):
                    return self._model.encode(text).tolist()
                
                async def _aget_query_embedding(self, query: str):
                    return self._get_query_embedding(query)
                
                async def _aget_text_embedding(self, text: str):
                    return self._get_text_embedding(text)
            
            Settings.embed_model = SentenceTransformerEmbedding(model_name)
            logging.info(f"Using free model with sentence-transformers: {model_name}")
        
        # Build vector index with ChromaDB persistence directly
        import chromadb
        
        # Ensure chroma_db directory is writable
        db_path = ensure_chroma_db_writable()
        
        # Initialize ChromaDB
        chroma_client = chromadb.PersistentClient(path=str(db_path))
        chroma_collection = chroma_client.get_or_create_collection("rag_collection")
        
        # Generate embeddings for each document and store in ChromaDB
        embed_model = Settings.embed_model
        ids = []
        embeddings = []
        texts = []
        metadatas = []
        
        for idx, doc in enumerate(documents):
            text = doc.text
            # Generate embedding
            embedding = embed_model._get_text_embedding(text)
            
            ids.append(str(idx))
            embeddings.append(embedding)
            texts.append(text)
            metadatas.append(doc.metadata or {})
        
        # Add to ChromaDB
        chroma_collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=texts,
            metadatas=metadatas
        )
        
        logging.info(f"Successfully created embeddings for {len(documents)} chunks and stored in ChromaDB")
        
        return {
            "message": f"✅ Embeddings generated successfully using {model}.",
            "embeddings_count": len(documents),
            "model": model
        }
    except Exception as e:
        logging.error(f"Embedding error: {e}")
        import traceback
        traceback.print_exc()
        return {"message": f"❌ Error during embedding: {str(e)}", "error": True}

@app.post("/validate")
async def validate_endpoint():
    """Validate chunks and retrieve embeddings from ChromaDB"""
    try:
        chunks_dir = Path("./chunks")
        if not chunks_dir.exists():
            return {"message": "❌ No chunks directory found.", "error": True}
        
        chunk_files = sorted(chunks_dir.glob("*.txt"))
        if not chunk_files:
            return {"message": "❌ No chunk files found in /chunks directory.", "error": True}
        
        # Read chunk contents
        chunks_data = []
        for chunk_file in chunk_files:
            with open(chunk_file, "r", encoding="utf-8") as f:
                content = f.read()
                chunks_data.append({
                    "id": chunk_file.stem,
                    "filename": chunk_file.name,
                    "content": content,
                    "size": len(content)
                })
        
        # Get embeddings from ChromaDB
        try:
            # Ensure database is readable
            db_path = ensure_chroma_db_writable()
            chroma_client = chromadb.PersistentClient(path=str(db_path))
            
            # Try to get collection, if it doesn't exist, return chunks without embeddings
            try:
                collection = chroma_client.get_collection(name="rag_collection")
                
                # Get all items from collection
                results = collection.get(include=["embeddings", "documents", "metadatas"])
                
                # Check if collection is empty
                if not results['ids'] or len(results['ids']) == 0:
                    logging.warning("ChromaDB collection exists but is empty")
                    return {
                        "message": f"⚠️ Found {len(chunks_data)} chunks but no embeddings yet. Run embedding step first.",
                        "chunks_count": len(chunks_data),
                        "chunks": chunks_data
                    }
                
                # Match embeddings to chunks
                for i, chunk in enumerate(chunks_data):
                    # Find matching embedding by document content
                    for j, doc in enumerate(results['documents']):
                        if doc and doc.strip() == chunk['content'].strip():
                            # Convert to list for JSON serialization
                            embedding_vec = results['embeddings'][j]
                            chunk['embedding'] = [float(x) for x in embedding_vec[:10]]  # First 10 dims for display
                            chunk['embedding_dim'] = len(embedding_vec)
                            chunk['metadata'] = results['metadatas'][j] if results['metadatas'] else {}
                            break
                
                return {
                    "message": f"✅ Validation successful: {len(chunks_data)} chunks with embeddings",
                    "chunks_count": len(chunks_data),
                    "chunks": chunks_data
                }
                
            except Exception as collection_error:
                logging.warning(f"Collection not found or empty: {collection_error}")
                return {
                    "message": f"⚠️ Found {len(chunks_data)} chunks but no embeddings yet. Run embedding step first.",
                    "chunks_count": len(chunks_data),
                    "chunks": chunks_data
                }
                
        except Exception as db_error:
            logging.error(f"ChromaDB error: {db_error}")
            return {
                "message": f"⚠️ Found {len(chunks_data)} chunks but could not access embeddings database.",
                "chunks_count": len(chunks_data),
                "chunks": chunks_data
            }
    except Exception as e:
        logging.error(f"Validation error: {e}")
        return {"message": f"❌ Error during validation: {str(e)}", "error": True}

@app.post("/rag")
async def rag_endpoint(request: Request):
    """Query the RAG pipeline with a question using selected LLM model"""
    try:
        body = await request.json()
        query = body.get("query", "")
        model = body.get("model", "llama3")  # Default to free model
        openai_api_key = body.get("openai_api_key")
        
        if not query:
            return {"answer": "❌ Please provide a query.", "error": True}
        
        # Retrieve relevant chunks from ChromaDB
        chroma_client = chromadb.PersistentClient(path="./chroma_db")
        collection = chroma_client.get_collection(name="rag_collection")
        
        # Generate query embedding using the same model as ingestion
        from sentence_transformers import SentenceTransformer
        embed_model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
        query_embedding = embed_model.encode(query).tolist()
        
        # Query ChromaDB for relevant chunks
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=3  # Top 3 relevant chunks
        )
        
        # Build context from retrieved chunks
        context = "\n\n".join(results['documents'][0]) if results['documents'] else "No relevant context found."
        
        # Prepare citations
        citations = []
        if results['documents'] and results['metadatas']:
            for i, (doc, metadata) in enumerate(zip(results['documents'][0], results['metadatas'][0])):
                citations.append({
                    "chunk_id": i + 1,
                    "content": doc,
                    "metadata": metadata,
                    "relevance_score": results['distances'][0][i] if results.get('distances') else None
                })
        
        # Generate answer using selected model
        answer_data = await generate_answer(query, context, model, openai_api_key)
        
        return {
            "answer": answer_data.get("answer", ""),
            "ai_mode": answer_data.get("mode", "retrieval"),
            "model": answer_data.get("model_name", model),
            "retrieved_chunks": citations,
            "context": context
        }
    except Exception as e:
        logging.error(f"RAG error: {e}")
        return {"answer": f"❌ Error during RAG: {str(e)}", "error": True}


async def generate_answer(query: str, context: str, model: str, openai_api_key: str = None):
    """Generate answer using selected LLM model - returns structured data"""
    
    prompt = f"""Based on the following context, answer the question accurately and concisely.

Context:
{context}

Question: {query}

Answer:"""
    
    if model == 'openai':
        # Use OpenAI GPT-4
        if not openai_api_key:
            return {
                "answer": "❌ OpenAI API key is required for GPT-4 model.",
                "mode": "error",
                "model_name": "GPT-4 (OpenAI)"
            }
        
        try:
            from openai import OpenAI
            
            client = OpenAI(api_key=openai_api_key)
            
            response = client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that answers questions based on provided context. Be concise and accurate."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=500
            )
            ai_answer = response.choices[0].message.content
            
            return {
                "answer": ai_answer,
                "mode": "ai",
                "model_name": "GPT-4 (OpenAI)"
            }
        except Exception as e:
            return {
                "answer": f"❌ OpenAI API Error: {str(e)}",
                "mode": "error",
                "model_name": "GPT-4 (OpenAI)"
            }
    
    else:
        # Use free local/API models (Llama, Mistral, Gemma)
        # Try Ollama first, fallback to simple extraction if not available
        try:
            import httpx
            
            # Map model IDs to Ollama model names
            model_map = {
                'llama3': 'llama3',
                'mistral': 'mistral',
                'gemma': 'gemma:7b'
            }
            
            ollama_model = model_map.get(model, 'llama3')
            
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    'http://localhost:11434/api/generate',
                    json={
                        'model': ollama_model,
                        'prompt': prompt,
                        'stream': False
                    }
                )
                
                if response.status_code == 200:
                    result = response.json()
                    ai_answer = result.get('response', 'No response generated.')
                    
                    model_names = {'llama3': 'Llama 3', 'mistral': 'Mistral', 'gemma': 'Gemma'}
                    model_display = model_names.get(model, model.upper())
                    
                    return {
                        "answer": ai_answer,
                        "mode": "ai",
                        "model_name": f"{model_display} (Free, Local)"
                    }
                else:
                    # Fallback to context-based answer
                    return generate_fallback_answer(query, context, model)
        except Exception as e:
            # Fallback to context-based answer if Ollama is not available
            return generate_fallback_answer(query, context, model)


def generate_fallback_answer(query: str, context: str, model: str):
    """Generate a simple answer when LLM is not available - returns dict"""
    
    model_names = {'llama3': 'Llama 3', 'mistral': 'Mistral', 'gemma': 'Gemma'}
    model_display = model_names.get(model, model.upper())
    
    fallback_message = f"""⚡ **AI Mode Not Available**

To get AI-generated natural language answers, install:

**Option 1: Free Local Models** ({model_display})
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull {model}
ollama serve
```

**Option 2: OpenAI GPT-4** (Paid - Instant)
- Select "⚡ GPT-4" model above
- Enter your OpenAI API key

**Your Question**: {query}

View the retrieved context and citations below for relevant information from your documents."""
    
    return {
        "answer": fallback_message,
        "mode": "retrieval",
        "model_name": f"{model_display} (Not Available)"
    }


