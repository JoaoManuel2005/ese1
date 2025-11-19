import os
import json
from app import DocumentIngestionPipeline, MinimalMultiFormatParser

def test_chunk_saving(tmp_path):
    # Setup: create a dummy txt file in a temp data dir
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    test_file = data_dir / "sample.txt"
    test_text = "This is a test chunk."
    test_file.write_text(test_text)

    # Run pipeline
    pipeline = DocumentIngestionPipeline(data_dir=str(data_dir), parser_cls=MinimalMultiFormatParser)
    docs = pipeline.parse_documents([str(test_file)])

    # Check that chunk file is saved in ../chunks (relative to CWD)
    chunks_dir = os.path.abspath(os.path.join(os.getcwd(), "chunks"))
    chunk_files = [f for f in os.listdir(chunks_dir) if f.startswith("sample_chunk")]
    assert len(chunk_files) > 0, "No chunk files saved in /chunks directory."
    # Validate contents
    for fname in chunk_files:
        with open(os.path.join(chunks_dir, fname), "r", encoding="utf-8") as f:
            data = json.load(f)
            assert "text" in data and data["text"] == test_text
            assert "metadata" in data and "file_name" in data["metadata"]
