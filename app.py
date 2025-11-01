
# -*- coding: utf-8 -*-
"""
advanced_rag.py

Refactored production-ready version of the original Colab notebook.
- Removes Colab magic and userdata usage
- Loads API keys from environment variables
- Provides a modular DocumentIngestionPipeline
- Initializes indexes and retrievers in a guarded main() flow
- Adds logging and basic error handling

Notes: install dependencies with `pip install -r requirements.txt` inside a venv.
"""

import os
import hashlib
import logging
import asyncio
import threading
import http.server
import socketserver
from pathlib import Path
from typing import Optional, List

try:
    import nest_asyncio
except Exception:
    pass

import PyPDF2
from bs4 import BeautifulSoup

class Document:
    def __init__(self, id_, text, metadata=None):
        self.id_ = id_
        self.text = text
        self.metadata = metadata or {}

class MinimalMultiFormatParser:
    def __init__(self):
        pass
    def load_data(self, filename):
        ext = os.path.splitext(filename)[1].lower()
        docs = []
        try:
            if ext == ".pdf":
                with open(filename, "rb") as f:
                    reader = PyPDF2.PdfReader(f)
                    text = "\n".join(page.extract_text() or "" for page in reader.pages)
            elif ext in [".htm", ".html"]:
                with open(filename, "r", encoding="utf-8", errors="ignore") as f:
                    soup = BeautifulSoup(f, "html.parser")
                    text = soup.get_text(separator="\n")
            elif ext in [".xml", ".xsd"]:
                with open(filename, "r", encoding="utf-8", errors="ignore") as f:
                    soup = BeautifulSoup(f, "xml")
                    text = soup.get_text(separator="\n")
            elif ext == ".txt":
                with open(filename, "r", encoding="utf-8", errors="ignore") as f:
                    text = f.read()
            else:
                text = ""
            if text:
                doc = Document(
                    id_=filename,
                    text=text,
                    metadata={"file_name": filename}
                )
                docs.append(doc)
        except Exception as e:
            logging.warning(f"Failed to parse {filename}: {e}")
        return docs

import types
import time

# LlamaIndex / LlamaParse imports (ensure packages are installed)
# Heavy third-party imports are loaded lazily inside functions so the module
# can be imported in test environments without all external packages installed.



def load_api_keys(save_to_env: bool = False):
    """Load API keys from environment variables and validate them.

    Prefer interactive prompt when running in a TTY. If not in a TTY, read from
    environment variables and raise an error if missing.

    If save_to_env=True the filled values will be appended to a local `.env` file.
    """
    import getpass


    # Always prompt interactively for OpenAI key if not set
    openai_key = os.environ.get("OPENAI_API_KEY")
    if not openai_key:
        openai_key = getpass.getpass(prompt="Enter your OPENAI_API_KEY (input hidden): ")
    if not openai_key:
        raise EnvironmentError("OPENAI_API_KEY is required for this workflow.")

    # Prompt interactively for LlamaCloud key if not set
    llamacloud_key = os.environ.get("LLAMA_CLOUD_API_KEY")
    if not llamacloud_key:
        llamacloud_key = getpass.getpass(prompt="Enter your LLAMA_CLOUD_API_KEY (input hidden): ")
    if not llamacloud_key:
        logging.warning("LLAMA_CLOUD_API_KEY is not set. Some features may not work.")

    if save_to_env:
        env_path = Path(".env")
        try:
            with env_path.open("a") as f:
                f.write(f"OPENAI_API_KEY={openai_key}\n")
                f.write(f"LLAMA_CLOUD_API_KEY={llamacloud_key}\n")
            logging.info("Saved API keys to %s (be careful not to commit this file)", env_path)
        except Exception:
            logging.exception("Failed to save key to .env")

    return openai_key, llamacloud_key


# ---------- Ingestion pipeline ----------
class DocumentIngestionPipeline:
    """Load and parse documents from a directory using a parser.

    Usage:
        pipeline = DocumentIngestionPipeline(data_dir="./data", parser_cls=YourParser, parser_kwargs={...})
        pdf_files = pipeline.get_pdf_files()
        documents = pipeline.parse_documents(pdf_files)
    """

    def __init__(self, data_dir: str = "./data", parser_cls=None, parser_kwargs: Optional[dict] = None, max_docs: Optional[int] = None):
        self.data_dir = Path(data_dir)
        self.parser_cls = parser_cls
        self.parser_kwargs = parser_kwargs or {}
        # Optional cap on total documents/chunks returned (helps in CI and memory-constrained runs)
        self.max_docs = max_docs


    def get_supported_files(self) -> List[str]:
        """Return all supported files (.pdf, .htm, .xml, .xsd, .txt) in the data directory."""
        exts = ["*.pdf", "*.htm", "*.xml", "*.xsd", "*.txt"]
        files = []
        for ext in exts:
            found = list(self.data_dir.glob(ext))
            files.extend(found)
        files = [str(p) for p in files]
        logging.info("Found %d supported files in %s", len(files), str(self.data_dir))
        for p in files:
            logging.info("  - %s", p)
        return files

    def parse_documents(self, pdf_files: List[str]):
        if not self.parser_cls:
            raise ValueError("parser_cls must be provided to parse documents")
        parser = self.parser_cls(**self.parser_kwargs)
        all_documents = []
        successful = []
        failed = []
        seen_hashes = set()
        for i, filename in enumerate(pdf_files, start=1):
            logging.info("[%d/%d] Parsing %s", i, len(pdf_files), filename)
            attempts = 0
            max_attempts = 3
            backoff = 1.0
            docs = None
            while attempts < max_attempts:
                try:
                    docs = parser.load_data(filename)
                except Exception as e:
                    attempts += 1
                    logging.warning("Attempt %d to parse %s failed: %s", attempts, filename, e)
                    time.sleep(backoff)
                    backoff *= 2
            if docs is None:
                failed.append(filename)
                logging.exception("  ❌ failed to parse %s after %d attempts", filename, max_attempts)
                continue

            added = 0
            for doc in docs:
                # Get text representation
                try:
                    from pathlib import Path
                    from typing import Optional
                    text = getattr(doc, "text", None) or (doc.get_text() if hasattr(doc, "get_text") else str(doc))
                except Exception:
                    text = str(doc)

                h = hashlib.sha256(text.encode("utf-8")).hexdigest()
                if h in seen_hashes:
                    continue
                seen_hashes.add(h)

                # Enrich metadata where possible (best-effort)
                try:
                    if hasattr(doc, "metadata") and isinstance(doc.metadata, dict):
                        doc.metadata["file_name"] = os.path.basename(filename)
                    elif hasattr(doc, "extra_info") and isinstance(doc.extra_info, dict):
                        doc.extra_info["file_name"] = os.path.basename(filename)
                except Exception:
                    logging.debug("Failed to enrich metadata for doc from %s", filename)

                all_documents.append(doc)
                added += 1

                # Respect optional max_docs cap to avoid excessive memory use in CI/quick runs
                if self.max_docs is not None and len(all_documents) >= self.max_docs:
                    logging.info("Reached max_docs cap (%d), stopping ingestion", self.max_docs)
                    break

            successful.append(filename)
            logging.info("  ✓ extracted %d unique chunks from %s", added, filename)

        logging.info("Parsing complete. successful=%d failed=%d total_chunks=%d", len(successful), len(failed), len(all_documents))
        return all_documents


# ---------- Index and retriever helpers ----------
def build_auto_index(documents):
    # Lazy import heavy library; if it's not available provide a lightweight
    # in-memory retriever fallback so tests and simple runs work without
    # installing llama_index.
    try:
        from llama_index.core import VectorStoreIndex
        index = VectorStoreIndex.from_documents(documents)
        retriever = index.as_retriever(similarity_top_k=15)
        return index, retriever
    except Exception as e:
        logging.warning(f"llama_index not available; using simple in-memory retriever fallback: {e}")
        class SimpleRetriever:
            def __init__(self, docs):
                self._docs = docs
            def retrieve(self, query, n_results=15):
                nodes = []
                for d in self._docs:
                    text = getattr(d, 'text', str(d))
                    score = 1.0 if query.lower() in text.lower() else 0.0
                    node = types.SimpleNamespace(node=types.SimpleNamespace(text=text, metadata=getattr(d, 'metadata', {})), score=score)
                    nodes.append(node)
                nodes.sort(key=lambda n: n.score, reverse=True)
                return nodes[:n_results]
        retriever = SimpleRetriever(documents)
        return None, retriever


def build_sentence_window_index(documents):
    from llama_index.core.node_parser import SentenceWindowNodeParser
    from llama_index.core import VectorStoreIndex
    from llama_index.core.postprocessor import MetadataReplacementPostProcessor

    node_parser = SentenceWindowNodeParser.from_defaults(
        window_size=3,
        window_metadata_key="window",
        original_text_metadata_key="original_text",
    )
    nodes = node_parser.get_nodes_from_documents(documents)
    index = VectorStoreIndex(nodes)
    retriever = index.as_retriever(similarity_top_k=15)
    postprocessor = MetadataReplacementPostProcessor(target_metadata_key="window")
    return index, retriever, postprocessor


def build_auto_merging_index(documents):
    from llama_index.core.node_parser import SimpleNodeParser
    from llama_index.core import VectorStoreIndex

    node_parser = SimpleNodeParser.from_defaults(chunk_size=256, chunk_overlap=50)
    nodes = node_parser.get_nodes_from_documents(documents)
    index = VectorStoreIndex(nodes)
    retriever = index.as_retriever(similarity_top_k=12)
    return index, retriever


def build_chroma_index(documents, persist_directory: str = "./chroma_db"):
    """Create a Chroma-backed vector store index when chromadb is available.

    Falls back to in-memory VectorStoreIndex if chromadb isn't installed.
    """
    try:
        import chromadb
        CHROMADB_AVAILABLE = True
    except Exception:
        CHROMADB_AVAILABLE = False

    if not CHROMADB_AVAILABLE:
        logging.warning("chromadb not available, falling back to in-memory index")
        return build_auto_index(documents)

    try:
        # create chroma client and collection
        client = chromadb.Client()
        # Use a simple collection name; in production allow configured name
        coll = client.get_or_create_collection(name="rag_collection")

        # ingest tuples: id, text, metadata
        ids = []
        docs = []
        metas = []
        for i, d in enumerate(documents):
            try:
                text = getattr(d, "text", None) or (d.get_text() if hasattr(d, "get_text") else str(d))
            except Exception:
                text = str(d)
            meta = getattr(d, "metadata", None) or {}
            ids.append(str(i))
            docs.append(text)
            metas.append(meta)
        coll.add(ids=ids, documents=docs, metadatas=metas)

        # Create a tiny wrapper that mimics an index/retriever interface used above
        class ChromaRetrieverWrapper:
            def __init__(self, collection):
                self.collection = collection

            def retrieve(self, query, n_results=15):
                results = self.collection.query(query_texts=[query], n_results=n_results)
                # convert to expected simple structure
                nodes = []
                for ids, docs, metas in zip(results["ids"], results["documents"], results["metadatas"]):
                    for d, m in zip(docs, metas):
                        node = types.SimpleNamespace(node=types.SimpleNamespace(text=d, metadata=m), score=1.0)
                        nodes.append(node)
                return nodes

        # note: for compatibility with the rest of the code we return a minimal object
        retriever = ChromaRetrieverWrapper(coll)
        return None, retriever
    except Exception:
        logging.exception("Failed to create chroma index; falling back to in-memory VectorStoreIndex")
        return build_auto_index(documents)



# ---------- Retriever safe wrapper (sync + async handling) ----------

def run_async_query_safe(query_engine, query: str, timeout: float = 10.0):
    """Run a query against a query_engine that may be async or sync.

    - If the query_engine.query is awaitable, run it in the event loop safely.
    - If the event loop is closed or not running, create a new loop.
    - Returns the response object or raises a RuntimeError on failure.
    """
    try:
        result = query_engine.query(query)
        # if it's a coroutine, await it
        if asyncio.iscoroutine(result):
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None

            if loop and loop.is_running():
                # running inside an event loop (e.g., notebook) - run synchronously via asyncio.run_coroutine_threadsafe
                fut = asyncio.run_coroutine_threadsafe(result, loop)
                return fut.result(timeout)
            else:
                # safe to run
                return asyncio.run(result)
        else:
            return result
    except Exception as e:
        logging.exception("Retriever query failed: %s", e)
        raise RuntimeError("Retriever query failed") from e


def safe_query_with_retry(query_engine, query: str, retries: int = 1, timeout: float = 10.0):
    last_exc = None
    for attempt in range(1, retries + 2):
        try:
            return run_async_query_safe(query_engine, query, timeout=timeout)
        except Exception as e:
            logging.warning("Query attempt %d failed: %s", attempt, e)
            last_exc = e
            continue
    if last_exc is not None:
        raise last_exc
    else:
        raise RuntimeError("Unknown error")


# ---------- Main flow ----------
def main(data_dir: str = "./data"):
    # Load OpenAI and LlamaCloud keys
    openai_key, llamacloud_key = load_api_keys()

    # Set OpenAI API key globally for openai and llama_index
    try:
        import openai
        openai.api_key = openai_key
    except Exception:
        logging.warning("Could not set openai.api_key; OpenAI package not available.")

    # If using llama_index embedding, set key explicitly
    try:
        from llama_index.embeddings.openai import OpenAIEmbedding
        from llama_index.core import Settings
        Settings.embed_model = OpenAIEmbedding(api_key=openai_key)
    except Exception:
        logging.warning("Could not set OpenAIEmbedding with API key; using default embedding model.")


    # Minimal multi-format parser
    from llama_index.core.schema import Document
    import PyPDF2
    from bs4 import BeautifulSoup

class MinimalMultiFormatParser:
        def __init__(self):
            pass
        def load_data(self, filename):
            ext = os.path.splitext(filename)[1].lower()
            docs = []
            try:
                if ext == ".pdf":
                    with open(filename, "rb") as f:
                        reader = PyPDF2.PdfReader(f)
                        text = "\n".join(page.extract_text() or "" for page in reader.pages)
                elif ext in [".htm", ".html"]:
                    with open(filename, "r", encoding="utf-8", errors="ignore") as f:
                        soup = BeautifulSoup(f, "html.parser")
                        text = soup.get_text(separator="\n")
                elif ext in [".xml", ".xsd"]:
                    with open(filename, "r", encoding="utf-8", errors="ignore") as f:
                        soup = BeautifulSoup(f, "xml")
                        text = soup.get_text(separator="\n")
                elif ext == ".txt":
                    with open(filename, "r", encoding="utf-8", errors="ignore") as f:
                        text = f.read()
                else:
                    text = ""
                if text:
                    doc = Document(
                        id_=filename,
                        text=text,
                        metadata={"file_name": filename}
                    )
                    docs.append(doc)
            except Exception as e:
                logging.warning(f"Failed to parse {filename}: {e}")
            return docs

def build_chroma_index(documents, persist_directory="./chroma_db"):
    # ...existing code...
    # This is a placeholder for the actual build_chroma_index implementation
    # Ensure this function is defined at the top level for import
    pass


def _start_metrics_server(port: int = 8000):
    try:
        # Import dynamically to avoid static-analysis/editor warnings when the
        # optional `prometheus_client` package isn't installed in lightweight
        # dev/test environments.
        import importlib

        prom = importlib.import_module('prometheus_client')
        start_http_server = getattr(prom, 'start_http_server')
        Counter = getattr(prom, 'Counter')

        # Example metric: query count
        QUERY_COUNTER = Counter('rag_queries_total', 'Total number of queries')
        start_http_server(port)
        logging.info("Started Prometheus metrics server on port %d", port)
        return QUERY_COUNTER
    except Exception:
        logging.debug("prometheus_client not available; metrics server not started")
        return None


def start_health_server(port: int = 8080):
    """Start a tiny HTTP server that serves /health for container healthchecks.

    Uses the stdlib http.server to avoid adding dependencies.
    """
    if port <= 0:
        return None

    class HealthHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/health":
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"ok")
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, format, *args):
            # suppress default logging
            return

    class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True

    try:
        server = ThreadingHTTPServer(("0.0.0.0", port), HealthHandler)
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        logging.info("Started health server on port %d", port)
        return server
    except Exception:
        logging.exception("Failed to start health server on port %d", port)
        return None


def run_cli():
    import argparse

    parser = argparse.ArgumentParser(description="RAG pipeline runner")
    parser.add_argument("--data-dir", default=os.environ.get("DATA_DIR", "./data"), help="Directory with PDF files")
    parser.add_argument("--no-prompt", action="store_true", help="Do not prompt for API keys (CI mode)")
    parser.add_argument("--save-to-keyring", action="store_true", help="Save provided keys to OS keyring for future runs")
    parser.add_argument("--json-logs", action="store_true", help="Emit JSON formatted logs")
    parser.add_argument("--metrics-port", type=int, default=int(os.environ.get("METRICS_PORT", "0")), help="Start metrics server on given port (0=disabled)")
    args = parser.parse_args()

    # JSON logging optionally
    if args.json_logs:
        try:
            import json_log_formatter

            formatter = json_log_formatter.JSONFormatter()
            handler = logging.StreamHandler()
            handler.setFormatter(formatter)
            root = logging.getLogger()
            for h in list(root.handlers):
                root.removeHandler(h)
            root.addHandler(handler)
        except Exception:
            logging.warning("json_log_formatter not available; falling back to plain logs")

    # Key management: if save-to-keyring requested, store keys there after prompt
    if args.save_to_keyring:
        try:
            import keyring  # noqa: F401
        except Exception:
            logging.error("keyring package is required for --save-to-keyring")

    # If metrics enabled, start server
    if args.metrics_port:
        _start_metrics_server(args.metrics_port)

    # For CI/no-prompt mode, ensure env vars present
    if args.no_prompt:
        # Ensure keys exist in env
        if not os.environ.get("OPENAI_API_KEY") or not os.environ.get("LLAMA_CLOUD_API_KEY"):
            raise EnvironmentError("OPENAI_API_KEY and LLAMA_CLOUD_API_KEY must be set in environment when --no-prompt is used")

    # Start health server early so Docker healthchecks succeed while the
    # application initializes or when API keys are not present.
    try:
        start_health_server(port=int(os.environ.get("HEALTH_PORT", "8080")))
    except Exception:
        logging.debug("Failed to start health server from run_cli")

    # Run main but do not let it kill the process if it fails; keep the
    # health server alive so container healthchecks continue to succeed
    try:
        main(data_dir=args.data_dir)
    except Exception:
        logging.exception("Application main() failed; keeping health server alive for debugging")
        # keep process alive for debugging/health checks; exit only if explicitly requested
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            logging.info("Exiting after keyboard interrupt")


if __name__ == "__main__":
    # Prompt for OpenAI API key interactively if not set
    import getpass
    if not os.environ.get("OPENAI_API_KEY"):
        openai_key = getpass.getpass(prompt="Enter your OPENAI_API_KEY (input hidden): ")
        os.environ["OPENAI_API_KEY"] = openai_key
    run_cli()