import sys
import os
import json
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app import DocumentIngestionPipeline, MinimalMultiFormatParser

def industry_standard_chunking(text, chunk_size=256, overlap=128):
    # Sentence-based chunking with overlap
    import re
    sentences = re.split(r'(?<=[.!?]) +', text)
    chunks = []
    current = []
    current_len = 0
    for sent in sentences:
        if current_len + len(sent) > chunk_size and current:
            chunks.append(' '.join(current))
            # Overlap: keep last N chars
            overlap_text = ' '.join(current)[-overlap:]
            current = [overlap_text] if overlap else []
            current_len = len(overlap_text)
        current.append(sent)
        current_len += len(sent)
    if current:
        chunks.append(' '.join(current))
    return chunks

def main():
    if len(sys.argv) < 2:
        print("Usage: python chunk_doc.py <file_path>")
        sys.exit(1)
    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        sys.exit(1)
    parser = MinimalMultiFormatParser()
    docs = parser.load_data(file_path)
    if not docs:
        print(f"No text extracted from {file_path}")
        sys.exit(1)
    text = docs[0].text
    chunks = industry_standard_chunking(text)
    # Save chunks to /chunks
    chunks_dir = os.path.abspath(os.path.join(os.getcwd(), "chunks"))
    os.makedirs(chunks_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(file_path))[0]
    for idx, chunk in enumerate(chunks):
        chunk_filename = f"{base}_chunk{idx+1:03d}.txt"
        chunk_path = os.path.join(chunks_dir, chunk_filename)
        with open(chunk_path, "w", encoding="utf-8") as f:
            json.dump({"text": chunk, "metadata": {"file_name": os.path.basename(file_path)}}, f, ensure_ascii=False, indent=2)
    print(f"Chunked {len(chunks)} segments for {file_path} into {chunks_dir}")

if __name__ == "__main__":
    main()
