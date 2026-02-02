from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Tuple, Dict, Any
from threading import Lock
import os
import json
import tempfile
import shutil
import zipfile
from pac_parser import PacParser
from rag_pipeline import RAGPipeline
from full_rag_pipeline import FullRAGPipeline
from dotenv import load_dotenv
from llm_client import chat_complete, resolve_model, resolve_provider
from conversation_memory import conversation_memory
from preference_extractor import extract_preferences_from_chat
from smart_preference_extractor import extract_preferences_with_llm

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

DATASETS: Dict[str, Dict[str, Any]] = {}
DATASET_LOCK = Lock()

DOC_EXTS = {".txt", ".md", ".json", ".pdf"}
SOLUTION_MARKERS = {"solution.xml", "[content_types].xml"}

def classify_upload(filenames: Optional[List[str]] = None, zip_path: Optional[str] = None) -> Tuple[str, str]:
    if zip_path:
        try:
            with zipfile.ZipFile(zip_path, "r") as zip_ref:
                names = [name.lower() for name in zip_ref.namelist()]
            if any(name.endswith(marker) for name in names for marker in SOLUTION_MARKERS):
                return "solution_zip", "solution marker found in zip"
            return "unknown", "zip missing solution markers"
        except Exception:
            return "unknown", "invalid zip for classification"

    filenames = filenames or []
    for name in filenames:
        _, ext = os.path.splitext(name.lower())
        if ext in DOC_EXTS:
            return "docs", "document extensions detected"

    return "unknown", "unsupported file types"

def set_dataset_info(dataset_id: str, mode: str, reason: str, files: Optional[List[str]] = None) -> None:
    with DATASET_LOCK:
        existing = DATASETS.get(dataset_id, {})
        combined_files = list(set((existing.get("files") or []) + (files or [])))
        DATASETS[dataset_id] = {
            "mode": mode,
            "reason": reason,
            "files": combined_files,
        }

def get_dataset_info(dataset_id: str) -> Dict[str, Any]:
    with DATASET_LOCK:
        return DATASETS.get(dataset_id, {"mode": "unknown", "reason": "Dataset not registered", "files": []})

def json_error(code: str, message: str, hint: Optional[str] = None, status: int = 400):
    payload = {"ok": False, "error": {"code": code, "message": message}}
    if hint:
        payload["error"]["hint"] = hint
    return JSONResponse(status_code=status, content=payload)

def sources_match_dataset(chunks: List["RetrievedChunk"], dataset_files: List[str]) -> bool:
    if not dataset_files:
        return True
    lowered_files = [f.lower() for f in dataset_files if f]
    for chunk in chunks:
        source = (chunk.source or "").lower()
        if any(name in source for name in lowered_files):
            return True
    return False

# Optional: clear all persisted data on startup (dev safety)
if os.getenv("CLEAR_DB_ON_START", "").lower() == "true":
    full_rag.clear_all_collections()

# Optional demo ingestion (disabled by default)
if os.getenv("AUTO_INGEST_DEMO", "").lower() == "true":
    demo_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "chunks")
    if os.path.exists(demo_dir):
        demo_dataset = "demo"
        full_rag.clear_collection(demo_dataset)
        demo_result = full_rag.ingest_text_chunks(demo_dir, dataset_id=demo_dataset)
        set_dataset_info(demo_dataset, "generic", "demo auto-ingest", files=[demo_dir])

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
    provider: Optional[str] = None
    model: Optional[str] = None
    dataset_id: Optional[str] = None  # For accessing chat context
    user_preferences: Optional[str] = None  # User's document preferences from chat

class GenerateDocResponse(BaseModel):
    documentation: str
    format: str

# RAG-specific models
class RAGQueryRequest(BaseModel):
    question: str
    n_results: int = 5
    api_key: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    dataset_id: Optional[str] = None

class RAGQueryResponse(BaseModel):
    answer: str
    sources: List[dict]
    chunks_found: int

class IngestResponse(BaseModel):
    success: bool
    message: str
    details: dict
    corpus_type: Optional[str] = None
    corpus_reason: Optional[str] = None

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
        return json_error(
            "INVALID_SOLUTION_ZIP",
            "File must be a .zip Power Platform solution export.",
            "Upload a solution.zip exported from Power Platform.",
        )
    
    temp_dir = tempfile.mkdtemp()
    zip_path = os.path.join(temp_dir, file.filename)
    
    try:
        # Save uploaded file
        with open(zip_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        corpus_type, corpus_reason = classify_upload(zip_path=zip_path)
        if corpus_type != "solution_zip":
            return json_error(
                "INVALID_SOLUTION_ZIP",
                "Zip does not look like a Power Platform solution export.",
                "Ensure the zip contains solution.xml or [Content_Types].xml.",
            )
        
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
        return json_error(
            "SERVER_ERROR",
            f"Failed to parse solution: {str(e)}",
            status=500,
        )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

@app.post("/generate-documentation", response_model=GenerateDocResponse)
async def generate_documentation(request: GenerateDocRequest):
    """Generate documentation using RAG pipeline with configured provider"""

    provider = resolve_provider(request.provider)
    model = resolve_model(provider, request.model)

    if provider == "cloud" and not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY not configured in backend .env file for cloud provider",
        )

    try:
        # Get user preferences from chat history - use FULL chat context
        # ALWAYS prioritize conversation memory if dataset_id is available
        user_preferences = None

        if request.dataset_id:
            # Use conversation memory first (this has the cumulative history)
            chat_history = conversation_memory.get_history(request.dataset_id, max_messages=50)
            print(f"[DEBUG] Found {len(chat_history)} messages in conversation memory for dataset {request.dataset_id}")
            if chat_history:
                # Use ONLY smart LLM-based extraction for natural ChatGPT-like conversation
                user_preferences = extract_preferences_with_llm(chat_history)
                print(f"[DEBUG] Extracted preferences: {user_preferences[:200] if user_preferences else 'None'}")

        # Fallback: If no conversation memory, parse from request
        if not user_preferences and request.user_preferences:
            # Parse the user preferences string into structured format
            # Convert "user: message\nassistant: response" format to list of dicts
            lines = request.user_preferences.split('\n')
            chat_messages = []
            for line in lines:
                if ': ' in line:
                    role, content = line.split(': ', 1)
                    if role.lower() in ['user', 'assistant']:
                        chat_messages.append({'role': role.lower(), 'content': content})

            if chat_messages:
                # Use ONLY smart LLM-based extraction for natural ChatGPT-like conversation
                user_preferences = extract_preferences_with_llm(chat_messages)

        documentation = await rag_pipeline.generate(
            solution=request.solution,
            doc_type=request.doc_type,
            provider_override=provider,
            model_override=model,
            user_preferences=user_preferences,
        )

        return GenerateDocResponse(
            documentation=documentation,
            format=request.doc_type
        )
    except Exception as e:
        import traceback
        error_traceback = traceback.format_exc()
        print(f"[ERROR] Documentation generation failed: {str(e)}")
        print(f"[ERROR] Traceback:\n{error_traceback}")
        raise HTTPException(
            status_code=500,
            detail={"message": "Failed to generate documentation", "error": str(e)},
        )

# ==================== RAG ENDPOINTS ====================

@app.get("/rag/status")
async def rag_status(dataset_id: Optional[str] = None):
    """Get RAG pipeline status"""
    try:
        count = full_rag.get_collection_count(dataset_id) if dataset_id else 0
        provider = resolve_provider()
        model = resolve_model(provider)
        return {
            "status": "ready",
            "backend_online": True,
            "provider": provider,
            "model": model,
            "chunks_indexed": count,
            "collection_name": full_rag._get_collection_name(dataset_id) if dataset_id else None,
            "embedding_model": "all-MiniLM-L6-v2 (Sentence-BERT, FREE)",
        }
    except Exception as e:
        return {
            "status": "error",
            "backend_online": False,
            "error": str(e)
        }

@app.post("/rag/ingest-solution", response_model=IngestResponse)
async def ingest_solution(
    file: UploadFile = File(...),
    api_key: str = Form(None),  # API key is optional - Sentence-BERT is FREE
    dataset_id: str = Form(None),
):
    """Ingest a Power Platform solution ZIP into the RAG pipeline (FREE - uses Sentence-BERT)"""

    dataset_id = dataset_id or "default"
    
    if not file.filename.endswith('.zip'):
        return json_error(
            "INVALID_SOLUTION_ZIP",
            "File must be a .zip Power Platform solution export.",
            "Upload a solution.zip exported from Power Platform.",
        )
    
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

        corpus_type, corpus_reason = classify_upload(zip_path=zip_path)
        if corpus_type != "solution_zip":
            return json_error(
                "INVALID_SOLUTION_ZIP",
                "Zip does not look like a Power Platform solution export.",
                "Ensure the zip contains solution.xml or [Content_Types].xml.",
            )
        existing_mode = get_dataset_info(dataset_id).get("mode", "unknown")
        dataset_mode = "solution" if existing_mode in ("unknown", "solution") else "mixed"
        set_dataset_info(dataset_id, dataset_mode, corpus_reason, files=[file.filename])
        
        # Clear existing collection for this dataset before re-ingesting
        full_rag.clear_collection(dataset_id)
        
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
                                "file_name": os.path.basename(rel_path),
                                "kind": "solution",
                                "solution_name": solution_name,
                                "file_type": os.path.splitext(fname)[1],
                                "chunk_id": chunk_count
                            }
                        })
                except Exception as e:
                    print(f"Error reading {file_path}: {e}")
        
        # Store chunks in ChromaDB
        stored_count = full_rag.store_chunks(chunks, dataset_id=dataset_id)
        
        return IngestResponse(
            success=True,
            message=f"Successfully ingested solution '{solution_name}' with {stored_count} chunks",
            details={
                "solution_name": solution_name,
                "version": parsed_data.get("version", "1.0.0"),
                "publisher": parsed_data.get("publisher", "Unknown"),
                "chunks_stored": stored_count,
                "chunks_folder": chunks_dir
            },
            corpus_type=corpus_type,
            corpus_reason=corpus_reason,
        )
    except Exception as e:
        return json_error(
            "SERVER_ERROR",
            f"Failed to ingest solution: {str(e)}",
            status=500,
        )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

class ChunkData(BaseModel):
    content: str
    metadata: dict = {}

class IngestChunksRequest(BaseModel):
    chunks: List[ChunkData]
    dataset_id: Optional[str] = None
    dataset_mode: Optional[str] = None
    focus_files: Optional[List[str]] = None

@app.post("/rag/ingest-chunks", response_model=IngestResponse)
async def ingest_chunks(request: IngestChunksRequest):
    """Ingest chunks directly (FREE - uses Sentence-BERT for embeddings)"""
    
    if not request.chunks:
        return json_error(
            "NO_CHUNKS",
            "No chunks provided.",
            "Attach files and try again.",
        )

    dataset_id = request.dataset_id or "default"
    
    try:
        # Convert to the format expected by store_chunks
        chunks_list = []
        for chunk in request.chunks:
            metadata = chunk.metadata or {}
            if "file_name" not in metadata and metadata.get("source"):
                metadata["file_name"] = os.path.basename(str(metadata.get("source")))
            chunks_list.append({
                "content": chunk.content,
                "metadata": metadata
            })

        sources = []
        for chunk in chunks_list:
            metadata = chunk.get("metadata") or {}
            if metadata.get("source"):
                sources.append(str(metadata.get("source")))
            if metadata.get("path"):
                sources.append(str(metadata.get("path")))

        corpus_type, corpus_reason = classify_upload(filenames=sources)
        incoming_mode = request.dataset_mode or ("solution" if corpus_type == "solution_zip" else "generic")
        existing_mode = get_dataset_info(dataset_id).get("mode", "unknown")
        dataset_mode = (
            incoming_mode
            if existing_mode in ("unknown", incoming_mode)
            else "mixed"
        )
        set_dataset_info(dataset_id, dataset_mode, corpus_reason, files=sources)
        
        # Store chunks (FREE - uses Sentence-BERT)
        stored_count = full_rag.store_chunks(chunks_list, dataset_id=dataset_id)
        
        return IngestResponse(
            success=True,
            message=f"Successfully ingested {stored_count} chunks",
            details={
                "chunks_received": len(request.chunks),
                "chunks_stored": stored_count,
                "total_in_db": full_rag.get_collection_count(dataset_id),
            },
            corpus_type=corpus_type,
            corpus_reason=corpus_reason,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to ingest chunks: {str(e)}")

class RAGRetrieveRequest(BaseModel):
    question: str
    n_results: int = 5
    provider: Optional[str] = None
    model: Optional[str] = None
    dataset_id: Optional[str] = None
    focus_files: Optional[List[str]] = None
    conversation_history: Optional[List[Dict[str, str]]] = None  # Chat history for context

class RetrievedChunk(BaseModel):
    source: str
    content: str
    relevance: float

class RAGRetrieveResponse(BaseModel):
    chunks: List[RetrievedChunk]
    chunks_found: int
    answer: Optional[str] = None  # Natural language answer

class LocalModelsResponse(BaseModel):
    models: List[str]
    error: Optional[str] = None

@app.post("/rag/retrieve", response_model=RAGRetrieveResponse)
async def rag_retrieve(request: RAGRetrieveRequest):
    """
    Retrieve relevant chunks AND generate a natural language answer.
    Uses configured provider (cloud/local).
    """
    dataset_id = request.dataset_id or "default"
    dataset_info = get_dataset_info(dataset_id)
    dataset_mode = dataset_info.get("mode", "unknown")
    provider = resolve_provider(request.provider)
    model = resolve_model(provider, request.model)
    if provider == "cloud" and not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(
            status_code=500,
            detail="Cloud provider selected but OPENAI_API_KEY is not configured. Switch to local or set the key.",
        )
    if dataset_mode == "unknown" or full_rag.get_collection_count(dataset_id) == 0:
        return RAGRetrieveResponse(
            chunks=[],
            chunks_found=0,
            answer="No documents ingested yet. Upload files for this dataset first.",
        )
    try:
        dataset_files = dataset_info.get("files", [])
        retrieved_chunks = full_rag.retrieve(
            query=request.question,
            n_results=request.n_results,
            dataset_id=dataset_id,
            focus_files=request.focus_files,
        )

        if request.focus_files:
            focus_set = {f.lower() for f in request.focus_files}
            retrieved_chunks = [
                chunk
                for chunk in retrieved_chunks
                if (chunk.get("metadata", {}).get("file_name") or "").lower() in focus_set
            ]

        answer = None
        if retrieved_chunks:
            # Store user question in conversation memory
            conversation_memory.add_message(dataset_id, "user", request.question)

            if dataset_mode == "solution":
                system_prompt = """You are a helpful assistant that answers questions about Power Platform solutions.
Answer questions clearly and naturally based on the provided context and conversation history.
Be concise but thorough. If the context contains technical XML data, explain it in plain English.
Always mention what you found (e.g., "The bot uses authentication mode 2" or "I found 5 Power Automate flows").
If you can't find the answer in the context, say so.
Do not include sections labeled Sources, Evidence, or Citations, and do not list file paths.
Use previous conversation context when relevant to provide better answers."""
            else:
                system_prompt = """You are a general document assistant.
Answer only from the uploaded documents and conversation history.
Do not assume any domain, product, company, or vendor unless it appears in the context.
If you cannot find the answer in the documents, say so.
Do not include sections labeled Sources, Evidence, or Citations, and do not list file paths.
Use previous conversation context when relevant to provide better answers."""

            context_parts = []
            for i, chunk in enumerate(retrieved_chunks):
                source = chunk.get("metadata", {}).get("source", f"Source {i+1}")
                content = chunk.get("content", "")[:1500]
                context_parts.append(f"[{source}]\n{content}")
            context = "\n\n---\n\n".join(context_parts)

            # Add conversation history to context
            conversation_context = ""
            if request.conversation_history:
                # Use provided history (from frontend)
                history_parts = []
                for msg in request.conversation_history[-5:]:  # Last 5 messages
                    history_parts.append(f"{msg.get('role', 'user')}: {msg.get('content', '')}")
                if history_parts:
                    conversation_context = "\n\nPrevious conversation:\n" + "\n".join(history_parts) + "\n"
            else:
                # Use server-side memory
                conv_summary = conversation_memory.get_context_summary(dataset_id, max_chars=1000)
                if conv_summary:
                    conversation_context = f"\n\nPrevious conversation:\n{conv_summary}\n"

            file_hint = ""
            if dataset_mode == "generic":
                files_list = ", ".join(sorted(set(dataset_files))) if dataset_files else ""
                if files_list:
                    file_hint = f"Available files: {files_list}\n\n"

            user_prompt = f"{file_hint}Context:\n{context}{conversation_context}\n\n---\n\nCurrent Question: {request.question}"

            try:
                answer = chat_complete(
                    system_prompt,
                    user_prompt,
                    provider_override=provider,
                    model_override=model,
                )

                # Store assistant answer in conversation memory
                if answer:
                    conversation_memory.add_message(dataset_id, "assistant", answer)
            except Exception as llm_error:  # noqa: BLE001
                print(f"LLM error: {llm_error}")
                answer = None

            if answer is None:
                answer = "No answer generated."
        
        chunks = []
        for chunk in retrieved_chunks:
            chunks.append(RetrievedChunk(
                source=chunk.get("metadata", {}).get("source", "Unknown"),
                content=chunk.get("content", ""),
                relevance=round(chunk.get("relevance_score", 0), 1)
            ))
        
        if dataset_mode == "generic" and not sources_match_dataset(chunks, dataset_files):
            answer = "I couldn't find anything in your uploaded files related to that. Try uploading or re-ingesting."

        return RAGRetrieveResponse(
            chunks=chunks,
            chunks_found=len(chunks),
            answer=answer
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"message": "RAG retrieval failed", "error": str(e)},
        )

@app.post("/rag/query", response_model=RAGQueryResponse)
async def rag_query(request: RAGQueryRequest):
    """Query the RAG pipeline - retrieve relevant chunks and generate answer (requires OpenAI API key)"""
    provider = resolve_provider(request.provider)
    model = resolve_model(provider, request.model)
    api_key = request.api_key or os.getenv("OPENAI_API_KEY")

    if provider == "cloud" and not api_key:
        raise HTTPException(
            status_code=400,
            detail="Valid OpenAI API key required for cloud provider",
        )

    try:
        dataset_id = request.dataset_id or "default"
        dataset_mode = get_dataset_info(dataset_id).get("mode", "generic")
        result = full_rag.query(
            question=request.question,
            n_results=request.n_results,
            dataset_id=dataset_id,
            dataset_mode=dataset_mode,
            api_key=api_key,
            provider_override=provider,
            model_override=model,
        )
        
        return RAGQueryResponse(
            answer=result["answer"],
            sources=result["sources"],
            chunks_found=result["chunks_found"]
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"message": "RAG query failed", "error": str(e)},
        )

class ResetDatasetRequest(BaseModel):
    dataset_id: str

class DeleteDocsRequest(BaseModel):
    dataset_id: str
    file_names: List[str]

class ListDocsResponse(BaseModel):
    ok: bool
    files: List[str]

@app.post("/rag/reset")
async def reset_dataset(request: ResetDatasetRequest):
    """Clear all documents for a dataset"""
    try:
        full_rag.clear_collection(request.dataset_id)
        with DATASET_LOCK:
            DATASETS.pop(request.dataset_id, None)
        return {"ok": True, "message": "Dataset cleared"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear dataset: {str(e)}")

@app.get("/rag/list-docs", response_model=ListDocsResponse)
async def list_docs(dataset_id: str):
    try:
        files = full_rag.list_files(dataset_id)
        return ListDocsResponse(ok=True, files=files)
    except Exception as e:
        return json_error(
            "LIST_FAILED",
            f"Failed to list documents: {str(e)}",
            status=500,
        )

@app.post("/rag/delete-docs")
async def delete_docs(request: DeleteDocsRequest):
    try:
        full_rag.delete_files(request.dataset_id, request.file_names)
        with DATASET_LOCK:
            info = DATASETS.get(request.dataset_id)
            if info:
                info["files"] = [f for f in info.get("files", []) if f not in request.file_names]
        return {"ok": True}
    except Exception as e:
        return json_error(
            "DELETE_FAILED",
            f"Failed to delete documents: {str(e)}",
            status=500,
        )

@app.get("/local/models", response_model=LocalModelsResponse)
async def list_local_models():
    """List installed local (Ollama) models"""
    import requests

    base_url = os.getenv("LOCAL_LLM_BASE_URL", "http://localhost:11434").rstrip("/")
    tags_url = f"{base_url}/api/tags"
    try:
        resp = requests.get(tags_url, timeout=3)
        resp.raise_for_status()
        data = resp.json()
        models = [m.get("name") for m in data.get("models", []) if m.get("name")]
        return LocalModelsResponse(models=models or [])
    except requests.RequestException as exc:
        # Graceful fallback: return empty list with error detail
        return LocalModelsResponse(models=[], error=f"Local LLM not reachable at {base_url}: {exc}")
    except Exception as exc:  # noqa: BLE001
        return LocalModelsResponse(models=[], error=str(exc))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
