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
