"""
Full RAG Pipeline with:
1. Document parsing (ZIP solutions, text files)
2. Chunking with overlap
3. Embedding generation (Sentence-BERT - FREE, local)
4. ChromaDB vector storage
5. HYBRID Retrieval (BM25 + Semantic Search)
6. LLM answer generation with context (provider-aware)
"""

import json
import os
import re
import shutil
import tempfile
import uuid
import zipfile
from typing import Any, Dict, List, Optional

import chromadb
from chromadb.config import Settings
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

from llm_client import chat_complete, resolve_model, resolve_provider

load_dotenv()


class FullRAGPipeline:
    """Complete RAG Pipeline for Power Platform solutions with HYBRID retrieval"""

    def __init__(self, db_path: str = "./chroma_db"):
        self.db_path = db_path

        # Initialize ChromaDB
        self.chroma_client = chromadb.PersistentClient(
            path=db_path,
            settings=Settings(anonymized_telemetry=False),
        )

        # Initialize BGE embeddings for better retrieval accuracy
        print("[chroma] Loading BGE embedding model (free, local)...")
        self.embedding_model = SentenceTransformer("BAAI/bge-small-en-v1.5")
        print("[chroma] BGE embedding model loaded")

        # BM25 index for keyword search (hybrid retrieval)
        self.bm25_index: Dict[str, Optional[BM25Okapi]] = {}
        self.bm25_documents: Dict[str, List[str]] = {}
        self.bm25_ids: Dict[str, List[str]] = {}
        self.bm25_metadatas: Dict[str, List[Dict[str, Any]]] = {}

        self.default_provider = resolve_provider()
        self.default_model = resolve_model(self.default_provider)
        self.api_key_override: Optional[str] = None

    def _tokenize(self, text: str) -> List[str]:
        """Simple tokenizer for BM25"""
        text = text.lower()
        tokens = re.findall(r"\b\w+\b", text)
        return tokens

    def _rebuild_bm25_index(self, dataset_id: str):
        """Rebuild BM25 index from ChromaDB collection"""
        try:
            collection = self._get_collection(dataset_id)
            results = collection.get(include=["documents", "metadatas"])
            if results["documents"]:
                self.bm25_documents[dataset_id] = results["documents"]
                self.bm25_ids[dataset_id] = results["ids"]
                self.bm25_metadatas[dataset_id] = results.get("metadatas") or []

                tokenized_docs = [self._tokenize(doc) for doc in self.bm25_documents[dataset_id]]
                self.bm25_index[dataset_id] = BM25Okapi(tokenized_docs)
                print(f"[bm25] Index built with {len(self.bm25_documents[dataset_id])} documents")
            else:
                self.bm25_index[dataset_id] = None
                self.bm25_documents[dataset_id] = []
                self.bm25_ids[dataset_id] = []
                self.bm25_metadatas[dataset_id] = []
        except Exception as e:  # noqa: BLE001
            print(f"Warning: Could not build BM25 index: {e}")
            self.bm25_index[dataset_id] = None
            self.bm25_metadatas[dataset_id] = []

    def _get_collection_name(self, dataset_id: str) -> str:
        safe = re.sub(r"[^a-zA-Z0-9_-]", "-", dataset_id)
        return f"kb_{safe}"

    def _get_collection(self, dataset_id: str):
        name = self._get_collection_name(dataset_id)
        return self.chroma_client.get_or_create_collection(
            name=name,
            metadata={"hnsw:space": "cosine"},
        )

    def set_api_key(self, api_key: str):
        """Set API key override for cloud provider"""
        self.api_key_override = api_key

    # ==================== PARSING ====================

    def parse_solution_zip(self, zip_path: str) -> Dict[str, Any]:
        """Parse a Power Platform solution ZIP file"""
        temp_dir = tempfile.mkdtemp()
        chunks = []
        solution_info = {
            "name": "Unknown",
            "version": "1.0.0",
            "publisher": "Unknown",
        }

        try:
            with zipfile.ZipFile(zip_path, "r") as zip_ref:
                zip_ref.extractall(temp_dir)

            solution_xml = os.path.join(temp_dir, "solution.xml")
            if os.path.exists(solution_xml):
                solution_info = self._parse_solution_xml(solution_xml)

            for root, _, files in os.walk(temp_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, temp_dir)

                    if file.endswith((".png", ".jpg", ".jpeg", ".gif", ".ico", ".dll")):
                        continue

                    try:
                        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                            content = f.read()

                        if content.strip():
                            chunk = {
                                "content": content[:10000],
                                "metadata": {
                                    "source": rel_path,
                                    "solution_name": solution_info["name"],
                                    "file_type": os.path.splitext(file)[1],
                                    "component_type": self._detect_component_type(rel_path),
                                },
                            }
                            chunks.append(chunk)
                    except Exception as exc:  # noqa: BLE001
                        print(f"Error reading {file_path}: {exc}")

            return {
                "solution_info": solution_info,
                "chunks": chunks,
                "total_files": len(chunks),
            }

        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def _parse_solution_xml(self, xml_path: str) -> Dict[str, str]:
        """Parse solution.xml for metadata"""
        import xml.etree.ElementTree as ET

        try:
            tree = ET.parse(xml_path)
            root = tree.getroot()

            ns = {"": root.tag.split("}")[0] + "}"} if "}" in root.tag else {}

            return {
                "name": root.findtext(".//UniqueName", "Unknown", ns),
                "version": root.findtext(".//Version", "1.0.0", ns),
                "publisher": root.findtext(".//Publisher/UniqueName", "Unknown", ns),
            }
        except Exception:  # noqa: BLE001
            return {"name": "Unknown", "version": "1.0.0", "publisher": "Unknown"}

    def _detect_component_type(self, path: str) -> str:
        """Detect component type from file path"""
        path_lower = path.lower()
        if "workflow" in path_lower:
            return "workflow"
        if "canvasapp" in path_lower:
            return "canvas_app"
        if "entity" in path_lower or "entities" in path_lower:
            return "entity"
        if "webresource" in path_lower:
            return "web_resource"
        if "plugin" in path_lower:
            return "plugin"
        if "customcontrol" in path_lower:
            return "custom_control"
        return "other"

    def parse_text_file(self, file_path: str) -> Dict[str, Any]:
        """Parse a text file"""
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        return {
            "solution_info": {"name": os.path.basename(file_path)},
            "chunks": [
                {
                    "content": content,
                    "metadata": {
                        "source": file_path,
                        "file_type": os.path.splitext(file_path)[1],
                    },
                }
            ],
            "total_files": 1,
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

            if end < len(text):
                last_period = chunk.rfind(".")
                last_newline = chunk.rfind("\n")
                break_point = max(last_period, last_newline)
                if break_point > chunk_size // 2:
                    chunk = text[start : start + break_point + 1]
                    end = start + break_point + 1

            chunks.append(chunk.strip())
            start = end - overlap

        return [c for c in chunks if c]

    # ==================== EMBEDDINGS (FREE with Sentence-BERT) ====================

    def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for text using Sentence-BERT (FREE, local)"""
        text = text[:2000]
        embedding = self.embedding_model.encode(text, convert_to_numpy=True)
        return embedding.tolist()

    def generate_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for multiple texts using Sentence-BERT (FREE, local)"""
        texts = [t[:2000] for t in texts]
        embeddings = self.embedding_model.encode(texts, convert_to_numpy=True, show_progress_bar=True)
        return embeddings.tolist()

    # ==================== VECTOR STORAGE ====================

    def store_chunks(self, chunks: List[Dict], dataset_id: str, api_key: Optional[str] = None) -> int:
        """Store chunks with embeddings in ChromaDB (NO API key needed for embeddings!)"""
        if not chunks:
            return 0

        documents = []
        metadatas = []
        ids = []

        for i, chunk in enumerate(chunks):
            content = chunk.get("content", "")
            if not content.strip():
                continue

            documents.append(content)
            metadata = chunk.get("metadata", {})
            metadata["dataset_id"] = dataset_id
            metadatas.append(metadata)
            ids.append(f"{dataset_id}_{uuid.uuid4().hex}")

        if not documents:
            return 0

        print(f"[embeddings] Generating embeddings for {len(documents)} chunks...")
        embeddings = self.generate_embeddings_batch(documents)

        collection = self._get_collection(dataset_id)
        collection.add(
            documents=documents,
            embeddings=embeddings,
            metadatas=metadatas,
            ids=ids,
        )

        self._rebuild_bm25_index(dataset_id)

        return len(documents)

    def get_collection_count(self, dataset_id: str) -> int:
        """Get number of documents in collection"""
        collection = self._get_collection(dataset_id)
        return collection.count()

    def clear_collection(self, dataset_id: str):
        """Clear all documents from collection"""
        name = self._get_collection_name(dataset_id)
        self.chroma_client.delete_collection(name)
        self.bm25_index.pop(dataset_id, None)
        self.bm25_documents.pop(dataset_id, None)
        self.bm25_ids.pop(dataset_id, None)
        self.bm25_metadatas.pop(dataset_id, None)

    def clear_all_collections(self):
        for collection in self.chroma_client.list_collections():
            self.chroma_client.delete_collection(collection.name)
        self.bm25_index = {}
        self.bm25_documents = {}
        self.bm25_ids = {}
        self.bm25_metadatas = {}

    def list_files(self, dataset_id: str) -> List[str]:
        collection = self._get_collection(dataset_id)
        results = collection.get(include=["metadatas"])
        files = []
        for metadata in results.get("metadatas") or []:
            file_name = (metadata or {}).get("file_name")
            if file_name:
                files.append(file_name)
        return sorted(set(files))

    def delete_files(self, dataset_id: str, file_names: List[str]) -> None:
        if not file_names:
            return
        collection = self._get_collection(dataset_id)
        collection.delete(where={"file_name": {"$in": file_names}})
        self._rebuild_bm25_index(dataset_id)

    # ==================== HYBRID RETRIEVAL (BM25 + Vector Search) ====================

    def retrieve_bm25(
        self,
        query: str,
        n_results: int = 10,
        dataset_id: str = "",
        focus_files: Optional[List[str]] = None,
    ) -> List[Dict]:
        """Retrieve using BM25 keyword search"""
        bm25_index = self.bm25_index.get(dataset_id)
        bm25_docs = self.bm25_documents.get(dataset_id, [])
        bm25_ids = self.bm25_ids.get(dataset_id, [])
        bm25_meta = self.bm25_metadatas.get(dataset_id, [])
        if not bm25_index or not bm25_docs:
            return []

        query_tokens = self._tokenize(query)
        scores = bm25_index.get_scores(query_tokens)

        candidate_indices = list(range(len(scores)))
        if focus_files:
            focus_set = {f.lower() for f in focus_files}
            candidate_indices = [
                idx
                for idx in candidate_indices
                if (bm25_meta[idx] or {}).get("file_name", "").lower() in focus_set
            ]

        top_indices = sorted(candidate_indices, key=lambda i: scores[i], reverse=True)[:n_results]

        results = []
        for idx in top_indices:
            if scores[idx] > 0:
                results.append(
                    {
                        "content": bm25_docs[idx],
                        "bm25_score": float(scores[idx]),
                        "id": bm25_ids[idx],
                    }
                )

        return results

    def retrieve_vector(
        self,
        query: str,
        n_results: int = 10,
        dataset_id: str = "",
        focus_files: Optional[List[str]] = None,
    ) -> List[Dict]:
        """Retrieve using vector/semantic search"""
        query_embedding = self.generate_embedding(query)

        collection = self._get_collection(dataset_id)
        query_kwargs = {
            "query_embeddings": [query_embedding],
            "n_results": n_results,
            "include": ["documents", "metadatas", "distances"],
        }
        if focus_files:
            query_kwargs["where"] = {"file_name": {"$in": focus_files}}

        results = collection.query(
            **query_kwargs,
        )

        retrieved = []
        if results["documents"] and results["documents"][0]:
            for i, doc in enumerate(results["documents"][0]):
                retrieved.append(
                    {
                        "content": doc,
                        "metadata": results["metadatas"][0][i] if results.get("metadatas") else {},
                        "distance": results["distances"][0][i] if results.get("distances") else None,
                        "vector_score": 1 - (results["distances"][0][i] if results.get("distances") else 0),
                        "id": results["ids"][0][i] if results.get("ids") else None,
                    }
                )

        return retrieved

    def retrieve(
        self,
        query: str,
        n_results: int = 5,
        hybrid_weight: float = 0.5,
        dataset_id: str = "",
        focus_files: Optional[List[str]] = None,
    ) -> List[Dict]:
        """
        HYBRID Retrieval: Combines BM25 (keyword) + Vector (semantic) search

        hybrid_weight: 0.0 = pure BM25, 1.0 = pure vector, 0.5 = balanced
        """
        if not dataset_id:
            return []

        if dataset_id not in self.bm25_index:
            self._rebuild_bm25_index(dataset_id)

        n_each = n_results * 2

        bm25_results = self.retrieve_bm25(query, n_each, dataset_id=dataset_id, focus_files=focus_files)
        vector_results = self.retrieve_vector(query, n_each, dataset_id=dataset_id, focus_files=focus_files)

        doc_scores: Dict[str, float] = {}
        doc_content: Dict[str, str] = {}
        doc_metadata: Dict[str, Dict[str, Any]] = {}

        bm25_weight = 1 - hybrid_weight
        for rank, result in enumerate(bm25_results):
            doc_id = result.get("id") or str(hash(result["content"]))
            rrf_score = bm25_weight * (1 / (rank + 60))
            doc_scores[doc_id] = doc_scores.get(doc_id, 0) + rrf_score
            doc_content[doc_id] = result["content"]
            doc_metadata[doc_id] = result.get("metadata", {})

        for rank, result in enumerate(vector_results):
            doc_id = result.get("id") or str(hash(result["content"]))
            rrf_score = hybrid_weight * (1 / (rank + 60))
            doc_scores[doc_id] = doc_scores.get(doc_id, 0) + rrf_score
            doc_content[doc_id] = result["content"]
            doc_metadata[doc_id] = result.get("metadata", {})

        sorted_docs = sorted(doc_scores.items(), key=lambda x: x[1], reverse=True)[:n_results]

        if sorted_docs:
            max_score = sorted_docs[0][1] if sorted_docs[0][1] > 0 else 1
        else:
            max_score = 1

        retrieved = []
        for doc_id, score in sorted_docs:
            normalized_score = (score / max_score) * 100 if max_score > 0 else 0
            retrieved.append(
                {
                    "content": doc_content[doc_id],
                    "metadata": doc_metadata.get(doc_id, {}),
                    "relevance_score": round(normalized_score, 1),
                    "retrieval_method": "hybrid",
                }
            )

        return retrieved

    # ==================== LLM GENERATION (provider-aware) ====================

    def generate_answer(
        self,
        query: str,
        context_chunks: List[Dict],
        api_key: Optional[str] = None,
        dataset_mode: str = "generic",
        provider_override: Optional[str] = None,
        model_override: Optional[str] = None,
    ) -> str:
        """Generate answer using LLM with retrieved context"""
        provider = resolve_provider(provider_override or self.default_provider)
        base_model = model_override
        if not base_model and provider == self.default_provider:
            base_model = self.default_model
        model = resolve_model(provider, base_model)

        context_parts = []
        for i, chunk in enumerate(context_chunks):
            source = chunk.get("metadata", {}).get("source", f"Document {i+1}")
            content = chunk.get("content", "")[:2000]
            context_parts.append(f"[Source: {source}]\n{content}")

        context = "\n\n---\n\n".join(context_parts)

        if dataset_mode == "solution":
            system_prompt = """You are a helpful assistant that answers questions about Power Platform solutions.
Use the provided context to answer questions accurately.
If the context doesn't contain enough information, say so.
Do not include sections labeled Sources, Evidence, or Citations, and do not list file paths."""
        else:
            system_prompt = """You are a general document assistant.
Answer only from the provided context.
Do not assume any domain or organization unless it appears in the sources.
If the context doesn't contain enough information, say so.
Do not include sections labeled Sources, Evidence, or Citations, and do not list file paths."""

        user_prompt = f"""Context from knowledge base:

{context}

---

Question: {query}

Please provide a detailed answer based on the context above."""

        return chat_complete(
            system_prompt,
            user_prompt,
            provider_override=provider,
            model_override=model,
            api_key_override=api_key or self.api_key_override,
        )

    # ==================== FULL RAG QUERY ====================

    def query(
        self,
        question: str,
        n_results: int = 5,
        dataset_id: str = "",
        dataset_mode: str = "generic",
        api_key: Optional[str] = None,
        provider_override: Optional[str] = None,
        model_override: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Full RAG query pipeline:
        1. Retrieve relevant chunks (FREE - Sentence-BERT)
        2. Generate answer with context
        """
        retrieved_chunks = self.retrieve(question, n_results, dataset_id=dataset_id)

        if not retrieved_chunks:
            return {
                "answer": "No relevant documents found in the knowledge base. Please upload and index documents first.",
                "sources": [],
                "chunks_found": 0,
                "provider": resolve_provider(provider_override or self.default_provider),
                "model": resolve_model(
                    resolve_provider(provider_override or self.default_provider),
                    model_override or self.default_model,
                ),
            }

        answer = self.generate_answer(
            question,
            retrieved_chunks,
            api_key=api_key,
            dataset_mode=dataset_mode,
            provider_override=provider_override,
            model_override=model_override,
        )

        sources = []
        for chunk in retrieved_chunks:
            sources.append(
                {
                    "source": chunk.get("metadata", {}).get("source", "Unknown"),
                    "relevance": round(chunk.get("relevance_score", 0), 1),
                    "preview": chunk.get("content", "")[:200] + "...",
                }
            )

        provider = resolve_provider(provider_override or self.default_provider)
        base_model = model_override
        if not base_model and provider == self.default_provider:
            base_model = self.default_model
        model = resolve_model(provider, base_model)

        return {
            "answer": answer,
            "sources": sources,
            "chunks_found": len(retrieved_chunks),
            "provider": provider,
            "model": model,
        }

    # ==================== INGEST PIPELINE ====================

    def ingest_solution(self, zip_path: str, dataset_id: str, api_key: Optional[str] = None) -> Dict[str, Any]:
        """
        Full ingestion pipeline (NO API key needed - uses FREE Sentence-BERT):
        1. Parse solution ZIP
        2. Chunk content
        3. Generate embeddings (FREE)
        4. Store in vector DB
        """
        parsed = self.parse_solution_zip(zip_path)

        all_chunks = []
        for chunk in parsed["chunks"]:
            content = chunk["content"]
            if len(content) > 1500:
                sub_chunks = self.chunk_text(content, chunk_size=1000, overlap=100)
                for i, sub_chunk in enumerate(sub_chunks):
                    all_chunks.append(
                        {
                            "content": sub_chunk,
                            "metadata": {**chunk["metadata"], "chunk_index": i},
                        }
                    )
            else:
                all_chunks.append(chunk)

        stored_count = self.store_chunks(all_chunks, dataset_id=dataset_id)

        return {
            "solution_name": parsed["solution_info"]["name"],
            "total_files_parsed": parsed["total_files"],
            "chunks_created": len(all_chunks),
            "chunks_stored": stored_count,
            "collection_total": self.get_collection_count(dataset_id),
        }

    def ingest_text_chunks(self, chunks_dir: str, dataset_id: str, api_key: Optional[str] = None) -> Dict[str, Any]:
        """Ingest pre-chunked text files from a directory (NO API key needed!)"""
        chunks = []

        for filename in os.listdir(chunks_dir):
            if filename.endswith(".txt"):
                file_path = os.path.join(chunks_dir, filename)
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        content = f.read()

                    try:
                        data = json.loads(content)
                        chunks.append(
                            {
                                "content": data.get("text", content),
                                "metadata": data.get("metadata", {"source": filename}),
                            }
                        )
                    except json.JSONDecodeError:
                        chunks.append(
                            {
                                "content": content,
                                "metadata": {"source": filename},
                            }
                        )
                except Exception as exc:  # noqa: BLE001
                    print(f"Error reading {filename}: {exc}")

        stored_count = self.store_chunks(chunks, dataset_id=dataset_id)

        return {
            "files_processed": len(chunks),
            "chunks_stored": stored_count,
            "collection_total": self.get_collection_count(dataset_id),
        }
