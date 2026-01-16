from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os
import json
import tempfile
import shutil
from pac_parser import PacParser
from rag_pipeline import RAGPipeline
from full_rag_pipeline import FullRAGPipeline
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Power Platform Doc Generator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize components
pac_parser = PacParser()
rag_pipeline = RAGPipeline()

# Full RAG pipeline - use a new DB path to avoid schema conflicts
CHROMA_DB_PATH = os.path.join(os.path.dirname(__file__), "rag_chroma_db")
full_rag = FullRAGPipeline(db_path=CHROMA_DB_PATH)

# Auto-ingest chunks on startup if collection is empty
def auto_ingest_chunks():
    """Automatically ingest chunks from the chunks directory on startup (FREE - no API key needed!)"""
    try:
        count = full_rag.get_collection_count()
        if count > 0:
            print(f"✓ ChromaDB already has {count} documents indexed")
            return
        
        # Find chunks directory
        chunks_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "chunks")
        if not os.path.exists(chunks_dir):
            print(f"⚠ Chunks directory not found: {chunks_dir}")
            return
        
        # Count chunk files
        chunk_files = [f for f in os.listdir(chunks_dir) if f.endswith('.txt')]
        if not chunk_files:
            print("⚠ No chunk files found in chunks directory")
            return
        
        print(f"📥 Auto-ingesting {len(chunk_files)} chunk files (FREE with Sentence-BERT)...")
        
        # Ingest chunks
        chunks = []
        for filename in chunk_files:
            file_path = os.path.join(chunks_dir, filename)
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Try to parse as JSON (structured chunk)
                try:
                    data = json.loads(content)
                    chunks.append({
                        "content": data.get("text", content),
                        "metadata": data.get("metadata", {"source": filename})
                    })
                except json.JSONDecodeError:
                    chunks.append({
                        "content": content,
                        "metadata": {"source": filename}
                    })
            except Exception as e:
                print(f"  Error reading {filename}: {e}")
        
        if chunks:
            stored = full_rag.store_chunks(chunks)  # No API key needed!
            print(f"✓ Successfully indexed {stored} chunks into ChromaDB")
        
    except Exception as e:
        print(f"⚠ Auto-ingest failed: {e}")

# Run auto-ingest on startup
auto_ingest_chunks()

# Pydantic models
class SolutionComponent(BaseModel):
    name: str
    type: str
    description: Optional[str] = None
    metadata: Optional[dict] = None

class ParsedSolution(BaseModel):
    solution_name: str
    version: str
    publisher: str
    components: List[SolutionComponent]

class GenerateDocRequest(BaseModel):
    solution: ParsedSolution
    doc_type: str = "markdown"

class GenerateDocResponse(BaseModel):
    documentation: str
    format: str

# RAG-specific models
class RAGQueryRequest(BaseModel):
    question: str
    n_results: int = 5
    api_key: Optional[str] = None

class RAGQueryResponse(BaseModel):
    answer: str
    sources: List[dict]
    chunks_found: int

class IngestResponse(BaseModel):
    success: bool
    message: str
    details: dict

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "pac_cli_available": pac_parser.pac_available
    }

@app.post("/parse-solution", response_model=ParsedSolution)
async def parse_solution(file: UploadFile = File(...)):
    """Parse a Power Platform solution using PAC CLI"""
    
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="File must be a .zip solution file")
    
    temp_dir = tempfile.mkdtemp()
    zip_path = os.path.join(temp_dir, file.filename)
    
    try:
        # Save uploaded file
        with open(zip_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Parse solution using PAC CLI
        parsed_data = pac_parser.parse_solution(zip_path, temp_dir)
        
        return ParsedSolution(
            solution_name=parsed_data.get("name", "Unknown"),
            version=parsed_data.get("version", "1.0.0"),
            publisher=parsed_data.get("publisher", "Unknown"),
            components=[
                SolutionComponent(
                    name=comp.get("name"),
                    type=comp.get("type"),
                    description=comp.get("description"),
                    metadata=comp.get("metadata") if isinstance(comp.get("metadata"), dict) else {}
                )
                for comp in parsed_data.get("components", [])
            ]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse solution: {str(e)}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

@app.post("/generate-documentation", response_model=GenerateDocResponse)
async def generate_documentation(request: GenerateDocRequest):
    """Generate documentation using RAG pipeline with OpenAI (API key from .env)"""
    
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured in backend .env file")
    
    try:
        documentation = await rag_pipeline.generate(
            solution=request.solution,
            doc_type=request.doc_type
        )
        
        return GenerateDocResponse(
            documentation=documentation,
            format=request.doc_type
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate documentation: {str(e)}")

# ==================== RAG ENDPOINTS ====================

@app.get("/rag/status")
async def rag_status():
    """Get RAG pipeline status"""
    try:
        count = full_rag.get_collection_count()
        return {
            "status": "ready",
            "chunks_indexed": count,
            "collection_name": full_rag.collection_name,
            "embedding_model": "all-MiniLM-L6-v2 (Sentence-BERT, FREE)"
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e)
        }

@app.post("/rag/ingest-solution", response_model=IngestResponse)
async def ingest_solution(
    file: UploadFile = File(...),
    api_key: str = Form(None)  # API key is optional - Sentence-BERT is FREE
):
    """Ingest a Power Platform solution ZIP into the RAG pipeline (FREE - uses Sentence-BERT)"""
    
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="File must be a .zip solution file")
    
    temp_dir = tempfile.mkdtemp()
    zip_path = os.path.join(temp_dir, file.filename)
    
    # Create chunks directory
    chunks_dir = os.path.join(os.path.dirname(__file__), "..", "chunks")
    os.makedirs(chunks_dir, exist_ok=True)
    
    # Clear old chunks
    for f in os.listdir(chunks_dir):
        if f.endswith('.txt'):
            os.remove(os.path.join(chunks_dir, f))
    
    try:
        # Save uploaded file
        with open(zip_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Clear existing collection before re-ingesting
        full_rag.clear_collection()
        
        # Use PAC CLI to parse and extract (like before)
        parsed_data = pac_parser.parse_solution(zip_path, temp_dir)
        solution_name = parsed_data.get("name", "Unknown")
        
        # Extract ZIP to get file contents
        extract_dir = os.path.join(temp_dir, "extracted_for_chunks")
        os.makedirs(extract_dir, exist_ok=True)
        
        import zipfile as zf
        with zf.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_dir)
        
        # Create chunks from important files only (like the old approach - ~37 chunks)
        chunks = []
        chunk_count = 0
        processed_files = set()  # Avoid duplicates
        
        # Important directories to process (more selective)
        important_dirs = ['Workflows', 'botcomponents', 'bots']
        # Important root-level files
        root_files = ['solution.xml', 'customizations.xml', '[Content_Types].xml', 'bot.xml', 'configuration.json']
        # File extensions to include
        important_extensions = ['.xml', '.json']
        # Skip these patterns
        skip_patterns = ['identity.json', 'BackgroundImageUri', 'AdditionalUris']
        
        for root, dirs, files in os.walk(extract_dir):
            rel_root = os.path.relpath(root, extract_dir)
            
            for fname in files:
                # Skip binary files
                if fname.endswith(('.png', '.jpg', '.jpeg', '.gif', '.ico', '.dll', '.msapp', '.zip')):
                    continue
                
                file_path = os.path.join(root, fname)
                rel_path = os.path.relpath(file_path, extract_dir)
                
                # Skip if already processed
                if rel_path in processed_files:
                    continue
                
                # Skip small identity/uri files
                if any(skip in rel_path for skip in skip_patterns):
                    continue
                
                # Determine if file should be included
                should_include = False
                
                # Include root-level important files
                if rel_root == '.' and fname in root_files:
                    should_include = True
                # Include files in important directories
                elif any(d in rel_root for d in important_dirs):
                    # Only xml and json files from these dirs
                    if fname.endswith(tuple(important_extensions)):
                        should_include = True
                
                if not should_include:
                    continue
                
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                    
                    if content.strip() and len(content) > 50:  # Skip empty/tiny files
                        chunk_count += 1
                        processed_files.add(rel_path)
                        chunk_content = f"File: {rel_path}\nSolution: {solution_name}\n\n{content[:8000]}"
                        
                        # Save to chunks folder
                        chunk_filename = f"chunk_{chunk_count:03d}_{fname.replace('/', '_').replace(' ', '_')}.txt"
                        with open(os.path.join(chunks_dir, chunk_filename), 'w', encoding='utf-8') as cf:
                            cf.write(chunk_content)
                        
                        chunks.append({
                            "content": chunk_content,
                            "metadata": {
                                "source": rel_path,
                                "solution_name": solution_name,
                                "file_type": os.path.splitext(fname)[1],
                                "chunk_id": chunk_count
                            }
                        })
                except Exception as e:
                    print(f"Error reading {file_path}: {e}")
        
        # Store chunks in ChromaDB
        stored_count = full_rag.store_chunks(chunks)
        
        return IngestResponse(
            success=True,
            message=f"Successfully ingested solution '{solution_name}' with {stored_count} chunks",
            details={
                "solution_name": solution_name,
                "version": parsed_data.get("version", "1.0.0"),
                "publisher": parsed_data.get("publisher", "Unknown"),
                "chunks_stored": stored_count,
                "chunks_folder": chunks_dir
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to ingest solution: {str(e)}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

class ChunkData(BaseModel):
    content: str
    metadata: dict = {}

class IngestChunksRequest(BaseModel):
    chunks: List[ChunkData]

@app.post("/rag/ingest-chunks", response_model=IngestResponse)
async def ingest_chunks(request: IngestChunksRequest):
    """Ingest chunks directly (FREE - uses Sentence-BERT for embeddings)"""
    
    if not request.chunks:
        raise HTTPException(status_code=400, detail="No chunks provided")
    
    try:
        # Convert to the format expected by store_chunks
        chunks_list = []
        for chunk in request.chunks:
            chunks_list.append({
                "content": chunk.content,
                "metadata": chunk.metadata
            })
        
        # Store chunks (FREE - uses Sentence-BERT)
        stored_count = full_rag.store_chunks(chunks_list)
        
        return IngestResponse(
            success=True,
            message=f"Successfully ingested {stored_count} chunks",
            details={
                "chunks_received": len(request.chunks),
                "chunks_stored": stored_count,
                "total_in_db": full_rag.get_collection_count()
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to ingest chunks: {str(e)}")

class RAGRetrieveRequest(BaseModel):
    question: str
    n_results: int = 5

class RetrievedChunk(BaseModel):
    source: str
    content: str
    relevance: float

class RAGRetrieveResponse(BaseModel):
    chunks: List[RetrievedChunk]
    chunks_found: int
    answer: Optional[str] = None  # Natural language answer

@app.post("/rag/retrieve", response_model=RAGRetrieveResponse)
async def rag_retrieve(request: RAGRetrieveRequest):
    """
    Retrieve relevant chunks AND generate a natural language answer.
    Uses backend API key from .env for OpenAI.
    """
    try:
        # Use the retrieve method (FREE hybrid search)
        retrieved_chunks = full_rag.retrieve(
            query=request.question,
            n_results=request.n_results
        )
        
        # Generate natural language answer using OpenAI
        answer = None
        api_key = os.getenv("OPENAI_API_KEY")
        if api_key and retrieved_chunks:
            try:
                from openai import OpenAI
                client = OpenAI(api_key=api_key)
                
                # Build context from chunks
                context_parts = []
                for i, chunk in enumerate(retrieved_chunks):
                    source = chunk.get("metadata", {}).get("source", f"Source {i+1}")
                    content = chunk.get("content", "")[:1500]
                    context_parts.append(f"[{source}]\n{content}")
                
                context = "\n\n---\n\n".join(context_parts)
                
                response = client.chat.completions.create(
                    model=os.getenv("OPENAI_MODEL", "gpt-4"),
                    messages=[
                        {"role": "system", "content": """You are a helpful assistant that answers questions about Power Platform solutions.
Answer questions clearly and naturally based on the provided context.
Be concise but thorough. If the context contains technical XML data, explain it in plain English.
Always mention what you found (e.g., "The bot uses authentication mode 2" or "I found 5 Power Automate flows").
If you can't find the answer in the context, say so."""},
                        {"role": "user", "content": f"Context:\n{context}\n\n---\n\nQuestion: {request.question}"}
                    ],
                    temperature=0.3,
                    max_tokens=500
                )
                answer = response.choices[0].message.content
            except Exception as e:
                print(f"OpenAI error: {e}")
                answer = None
        
        # Format response
        chunks = []
        for chunk in retrieved_chunks:
            chunks.append(RetrievedChunk(
                source=chunk.get("metadata", {}).get("source", "Unknown"),
                content=chunk.get("content", ""),
                relevance=round(chunk.get("relevance_score", 0), 1)
            ))
        
        return RAGRetrieveResponse(
            chunks=chunks,
            chunks_found=len(chunks),
            answer=answer
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG retrieval failed: {str(e)}")

@app.post("/rag/query", response_model=RAGQueryResponse)
async def rag_query(request: RAGQueryRequest):
    """Query the RAG pipeline - retrieve relevant chunks and generate answer (requires OpenAI API key)"""
    
    if not request.api_key or not request.api_key.startswith("sk-"):
        raise HTTPException(status_code=400, detail="Valid OpenAI API key required")
    
    try:
        result = full_rag.query(
            question=request.question,
            n_results=request.n_results,
            api_key=request.api_key
        )
        
        return RAGQueryResponse(
            answer=result["answer"],
            sources=result["sources"],
            chunks_found=result["chunks_found"]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG query failed: {str(e)}")

@app.post("/rag/clear")
async def clear_rag_collection():
    """Clear all documents from the RAG collection"""
    try:
        full_rag.clear_collection()
        return {"success": True, "message": "Collection cleared"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear collection: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
