"""
Full RAG Pipeline with:
1. Document parsing (ZIP solutions, text files)
2. Chunking with overlap
3. Embedding generation (Sentence-BERT - FREE, local)
4. ChromaDB vector storage
5. HYBRID Retrieval (BM25 + Semantic Search)
6. LLM answer generation with context (OpenAI)
"""

import os
import json
import zipfile
import tempfile
import shutil
from typing import List, Dict, Any, Optional
from openai import OpenAI
import chromadb
from sentence_transformers import SentenceTransformer
from rank_bm25 import BM25Okapi
import re
from dotenv import load_dotenv

load_dotenv()

class FullRAGPipeline:
    """Complete RAG Pipeline for Power Platform solutions with HYBRID retrieval"""
    
    def __init__(self, db_path: str = "./chroma_db"):
        self.db_path = db_path
        self.collection_name = "power_platform_docs"
        
        # Initialize ChromaDB
        self.chroma_client = chromadb.PersistentClient(path=db_path)
        self.collection = self.chroma_client.get_or_create_collection(
            name=self.collection_name,
            metadata={"hnsw:space": "cosine"}
        )
        
        # Initialize Sentence-BERT for FREE local embeddings
        print("🔄 Loading Sentence-BERT model (free, local)...")
        self.embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
        print("✓ Sentence-BERT model loaded")
        
        # BM25 index for keyword search (hybrid retrieval)
        self.bm25_index = None
        self.bm25_documents = []  # Store documents for BM25
        self.bm25_ids = []  # Store IDs to match with ChromaDB
        self._rebuild_bm25_index()
        
        # OpenAI client (only needed for LLM answers, not embeddings)
        self.openai_client = None
        self.llm_model = os.getenv("OPENAI_MODEL", "gpt-4")
    
    def _tokenize(self, text: str) -> List[str]:
        """Simple tokenizer for BM25"""
        # Lowercase and split on non-alphanumeric
        text = text.lower()
        tokens = re.findall(r'\b\w+\b', text)
        return tokens
    
    def _rebuild_bm25_index(self):
        """Rebuild BM25 index from ChromaDB collection"""
        try:
            # Get all documents from ChromaDB
            results = self.collection.get(include=["documents"])
            if results["documents"]:
                self.bm25_documents = results["documents"]
                self.bm25_ids = results["ids"]
                
                # Tokenize documents for BM25
                tokenized_docs = [self._tokenize(doc) for doc in self.bm25_documents]
                self.bm25_index = BM25Okapi(tokenized_docs)
                print(f"✓ BM25 index built with {len(self.bm25_documents)} documents")
            else:
                self.bm25_index = None
                self.bm25_documents = []
                self.bm25_ids = []
        except Exception as e:
            print(f"Warning: Could not build BM25 index: {e}")
            self.bm25_index = None
    
    def set_api_key(self, api_key: str):
        """Set OpenAI API key for LLM answers"""
        self.openai_client = OpenAI(api_key=api_key)
    
    # ==================== PARSING ====================
    
    def parse_solution_zip(self, zip_path: str) -> Dict[str, Any]:
        """Parse a Power Platform solution ZIP file"""
        temp_dir = tempfile.mkdtemp()
        chunks = []
        solution_info = {
            "name": "Unknown",
            "version": "1.0.0",
            "publisher": "Unknown"
        }
        
        try:
            # Extract ZIP
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(temp_dir)
            
            # Parse solution.xml for metadata
            solution_xml = os.path.join(temp_dir, "solution.xml")
            if os.path.exists(solution_xml):
                solution_info = self._parse_solution_xml(solution_xml)
            
            # Walk through extracted files and create chunks
            for root, dirs, files in os.walk(temp_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, temp_dir)
                    
                    # Skip binary files
                    if file.endswith(('.png', '.jpg', '.jpeg', '.gif', '.ico', '.dll')):
                        continue
                    
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                        
                        if content.strip():
                            chunk = {
                                "content": content[:10000],  # Limit chunk size
                                "metadata": {
                                    "source": rel_path,
                                    "solution_name": solution_info["name"],
                                    "file_type": os.path.splitext(file)[1],
                                    "component_type": self._detect_component_type(rel_path)
                                }
                            }
                            chunks.append(chunk)
                    except Exception as e:
                        print(f"Error reading {file_path}: {e}")
            
            return {
                "solution_info": solution_info,
                "chunks": chunks,
                "total_files": len(chunks)
            }
            
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)
    
    def _parse_solution_xml(self, xml_path: str) -> Dict[str, str]:
        """Parse solution.xml for metadata"""
        import xml.etree.ElementTree as ET
        try:
            tree = ET.parse(xml_path)
            root = tree.getroot()
            
            # Handle namespace
            ns = {'': root.tag.split('}')[0] + '}'} if '}' in root.tag else {}
            
            return {
                "name": root.findtext('.//UniqueName', 'Unknown'),
                "version": root.findtext('.//Version', '1.0.0'),
                "publisher": root.findtext('.//Publisher/UniqueName', 'Unknown')
            }
        except:
            return {"name": "Unknown", "version": "1.0.0", "publisher": "Unknown"}
    
    def _detect_component_type(self, path: str) -> str:
        """Detect component type from file path"""
        path_lower = path.lower()
        if 'workflow' in path_lower:
            return 'workflow'
        elif 'canvasapp' in path_lower:
            return 'canvas_app'
        elif 'entity' in path_lower or 'entities' in path_lower:
            return 'entity'
        elif 'webresource' in path_lower:
            return 'web_resource'
        elif 'plugin' in path_lower:
            return 'plugin'
        elif 'customcontrol' in path_lower:
            return 'custom_control'
        else:
            return 'other'
    
    def parse_text_file(self, file_path: str) -> Dict[str, Any]:
        """Parse a text file"""
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        return {
            "solution_info": {"name": os.path.basename(file_path)},
            "chunks": [{
                "content": content,
                "metadata": {
                    "source": file_path,
                    "file_type": os.path.splitext(file_path)[1]
                }
            }],
            "total_files": 1
        }
    
    # ==================== CHUNKING ====================
    
    def chunk_text(self, text: str, chunk_size: int = 1000, overlap: int = 200) -> List[str]:
        """Split text into overlapping chunks"""
        if len(text) <= chunk_size:
            return [text]
        
        chunks = []
        start = 0
        
        while start < len(text):
            end = start + chunk_size
            chunk = text[start:end]
            
            # Try to break at sentence boundary
            if end < len(text):
                last_period = chunk.rfind('.')
                last_newline = chunk.rfind('\n')
                break_point = max(last_period, last_newline)
                if break_point > chunk_size // 2:
                    chunk = text[start:start + break_point + 1]
                    end = start + break_point + 1
            
            chunks.append(chunk.strip())
            start = end - overlap
        
        return [c for c in chunks if c]
    
    # ==================== EMBEDDINGS (FREE with Sentence-BERT) ====================
    
    def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for text using Sentence-BERT (FREE, local)"""
        # Truncate text if too long (SBERT max ~512 tokens)
        text = text[:2000]
        embedding = self.embedding_model.encode(text, convert_to_numpy=True)
        return embedding.tolist()
    
    def generate_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for multiple texts using Sentence-BERT (FREE, local)"""
        # Truncate each text
        texts = [t[:2000] for t in texts]
        embeddings = self.embedding_model.encode(texts, convert_to_numpy=True, show_progress_bar=True)
        return embeddings.tolist()
    
    # ==================== VECTOR STORAGE ====================
    
    def store_chunks(self, chunks: List[Dict], api_key: Optional[str] = None) -> int:
        """Store chunks with embeddings in ChromaDB (NO API key needed for embeddings!)"""
        if not chunks:
            return 0
        
        # Prepare data
        documents = []
        metadatas = []
        ids = []
        
        for i, chunk in enumerate(chunks):
            content = chunk.get("content", "")
            if not content.strip():
                continue
            
            documents.append(content)
            metadatas.append(chunk.get("metadata", {}))
            ids.append(f"chunk_{i}_{hash(content) % 10000}")
        
        if not documents:
            return 0
        
        # Generate embeddings using FREE Sentence-BERT
        print(f"📊 Generating embeddings for {len(documents)} chunks...")
        embeddings = self.generate_embeddings_batch(documents)
        
        # Store in ChromaDB
        self.collection.add(
            documents=documents,
            embeddings=embeddings,
            metadatas=metadatas,
            ids=ids
        )
        
        # Rebuild BM25 index for hybrid search
        self._rebuild_bm25_index()
        
        return len(documents)
    
    def get_collection_count(self) -> int:
        """Get number of documents in collection"""
        return self.collection.count()
    
    def clear_collection(self):
        """Clear all documents from collection"""
        # Delete and recreate collection
        self.chroma_client.delete_collection(self.collection_name)
        self.collection = self.chroma_client.get_or_create_collection(
            name=self.collection_name,
            metadata={"hnsw:space": "cosine"}
        )
        # Clear BM25 index
        self.bm25_index = None
        self.bm25_documents = []
        self.bm25_ids = []
    
    # ==================== HYBRID RETRIEVAL (BM25 + Vector Search) ====================
    
    def retrieve_bm25(self, query: str, n_results: int = 10) -> List[Dict]:
        """Retrieve using BM25 keyword search"""
        if not self.bm25_index or not self.bm25_documents:
            return []
        
        query_tokens = self._tokenize(query)
        scores = self.bm25_index.get_scores(query_tokens)
        
        # Get top results
        top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:n_results]
        
        results = []
        for idx in top_indices:
            if scores[idx] > 0:  # Only include if there's some match
                results.append({
                    "content": self.bm25_documents[idx],
                    "bm25_score": float(scores[idx]),
                    "id": self.bm25_ids[idx]
                })
        
        return results
    
    def retrieve_vector(self, query: str, n_results: int = 10) -> List[Dict]:
        """Retrieve using vector/semantic search"""
        query_embedding = self.generate_embedding(query)
        
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            include=["documents", "metadatas", "distances"]
        )
        
        retrieved = []
        if results["documents"] and results["documents"][0]:
            for i, doc in enumerate(results["documents"][0]):
                retrieved.append({
                    "content": doc,
                    "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                    "distance": results["distances"][0][i] if results["distances"] else None,
                    "vector_score": 1 - (results["distances"][0][i] if results["distances"] else 0),
                    "id": results["ids"][0][i] if results["ids"] else None
                })
        
        return retrieved
    
    def retrieve(self, query: str, n_results: int = 5, hybrid_weight: float = 0.5) -> List[Dict]:
        """
        HYBRID Retrieval: Combines BM25 (keyword) + Vector (semantic) search
        
        hybrid_weight: 0.0 = pure BM25, 1.0 = pure vector, 0.5 = balanced
        """
        # Get more results from each method, then combine
        n_each = n_results * 2
        
        # BM25 keyword search
        bm25_results = self.retrieve_bm25(query, n_each)
        
        # Vector semantic search
        vector_results = self.retrieve_vector(query, n_each)
        
        # Combine using Reciprocal Rank Fusion (RRF)
        doc_scores = {}
        doc_content = {}
        doc_metadata = {}
        
        # Score BM25 results (weight: 1 - hybrid_weight)
        bm25_weight = 1 - hybrid_weight
        for rank, result in enumerate(bm25_results):
            doc_id = result.get("id") or hash(result["content"])
            rrf_score = bm25_weight * (1 / (rank + 60))  # RRF constant k=60
            doc_scores[doc_id] = doc_scores.get(doc_id, 0) + rrf_score
            doc_content[doc_id] = result["content"]
            doc_metadata[doc_id] = result.get("metadata", {})
        
        # Score vector results (weight: hybrid_weight)
        for rank, result in enumerate(vector_results):
            doc_id = result.get("id") or hash(result["content"])
            rrf_score = hybrid_weight * (1 / (rank + 60))  # RRF constant k=60
            doc_scores[doc_id] = doc_scores.get(doc_id, 0) + rrf_score
            doc_content[doc_id] = result["content"]
            doc_metadata[doc_id] = result.get("metadata", {})
        
        # Sort by combined score
        sorted_docs = sorted(doc_scores.items(), key=lambda x: x[1], reverse=True)[:n_results]
        
        # Normalize scores to 0-100% for better readability
        if sorted_docs:
            max_score = sorted_docs[0][1] if sorted_docs[0][1] > 0 else 1
            
        # Format results
        retrieved = []
        for doc_id, score in sorted_docs:
            # Normalize to percentage (0-100)
            normalized_score = (score / max_score) * 100 if max_score > 0 else 0
            retrieved.append({
                "content": doc_content[doc_id],
                "metadata": doc_metadata.get(doc_id, {}),
                "relevance_score": round(normalized_score, 1),
                "retrieval_method": "hybrid"
            })
        
        return retrieved
    
    # ==================== LLM GENERATION (requires OpenAI API key) ====================
    
    def generate_answer(self, query: str, context_chunks: List[Dict], api_key: Optional[str] = None) -> str:
        """Generate answer using LLM with retrieved context"""
        client = OpenAI(api_key=api_key) if api_key else self.openai_client
        
        if not client:
            raise ValueError("OpenAI API key required for answer generation")
        
        # Build context from retrieved chunks
        context_parts = []
        for i, chunk in enumerate(context_chunks):
            source = chunk.get("metadata", {}).get("source", f"Document {i+1}")
            content = chunk.get("content", "")[:2000]  # Limit each chunk
            context_parts.append(f"[Source: {source}]\n{content}")
        
        context = "\n\n---\n\n".join(context_parts)
        
        # Create prompt
        system_prompt = """You are a helpful assistant that answers questions about Power Platform solutions.
Use the provided context to answer questions accurately.
If the context doesn't contain enough information, say so.
Always cite which source document your answer is based on."""
        
        user_prompt = f"""Context from knowledge base:

{context}

---

Question: {query}

Please provide a detailed answer based on the context above."""
        
        response = client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.3,
            max_tokens=2000
        )
        
        return response.choices[0].message.content
    
    # ==================== FULL RAG QUERY ====================
    
    def query(self, question: str, n_results: int = 5, api_key: Optional[str] = None) -> Dict[str, Any]:
        """
        Full RAG query pipeline:
        1. Retrieve relevant chunks (FREE - Sentence-BERT)
        2. Generate answer with context (requires OpenAI API key)
        """
        # Step 1: Retrieve (FREE)
        retrieved_chunks = self.retrieve(question, n_results)
        
        if not retrieved_chunks:
            return {
                "answer": "No relevant documents found in the knowledge base. Please upload and index documents first.",
                "sources": [],
                "chunks_found": 0
            }
        
        # Step 2: Generate answer (requires API key)
        answer = self.generate_answer(question, retrieved_chunks, api_key)
        
        # Step 3: Format response
        sources = []
        for chunk in retrieved_chunks:
            sources.append({
                "source": chunk.get("metadata", {}).get("source", "Unknown"),
                "relevance": round(chunk.get("relevance_score", 0), 1),  # Already normalized to 0-100
                "preview": chunk.get("content", "")[:200] + "..."
            })
        
        return {
            "answer": answer,
            "sources": sources,
            "chunks_found": len(retrieved_chunks)
        }
    
    # ==================== INGEST PIPELINE ====================
    
    def ingest_solution(self, zip_path: str, api_key: Optional[str] = None) -> Dict[str, Any]:
        """
        Full ingestion pipeline (NO API key needed - uses FREE Sentence-BERT):
        1. Parse solution ZIP
        2. Chunk content
        3. Generate embeddings (FREE)
        4. Store in vector DB
        """
        # Step 1: Parse
        parsed = self.parse_solution_zip(zip_path)
        
        # Step 2: Further chunk large content
        all_chunks = []
        for chunk in parsed["chunks"]:
            content = chunk["content"]
            if len(content) > 1500:
                sub_chunks = self.chunk_text(content, chunk_size=1000, overlap=100)
                for i, sub_chunk in enumerate(sub_chunks):
                    all_chunks.append({
                        "content": sub_chunk,
                        "metadata": {
                            **chunk["metadata"],
                            "chunk_index": i
                        }
                    })
            else:
                all_chunks.append(chunk)
        
        # Step 3 & 4: Generate embeddings (FREE) and store
        stored_count = self.store_chunks(all_chunks)
        
        return {
            "solution_name": parsed["solution_info"]["name"],
            "total_files_parsed": parsed["total_files"],
            "chunks_created": len(all_chunks),
            "chunks_stored": stored_count,
            "collection_total": self.get_collection_count()
        }
    
    def ingest_text_chunks(self, chunks_dir: str, api_key: Optional[str] = None) -> Dict[str, Any]:
        """Ingest pre-chunked text files from a directory (NO API key needed!)"""
        chunks = []
        
        for filename in os.listdir(chunks_dir):
            if filename.endswith('.txt'):
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
                        # Plain text
                        chunks.append({
                            "content": content,
                            "metadata": {"source": filename}
                        })
                except Exception as e:
                    print(f"Error reading {filename}: {e}")
        
        # Store chunks (FREE - no API key needed)
        stored_count = self.store_chunks(chunks)
        
        return {
            "files_processed": len(chunks),
            "chunks_stored": stored_count,
            "collection_total": self.get_collection_count()
        }
