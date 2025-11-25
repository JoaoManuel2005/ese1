import subprocess
import sys

# Pipeline orchestrator: calls working scripts

def run_chunking(file_path):
    subprocess.run([sys.executable, "scripts/chunk_doc.py", file_path], check=True)

def run_embedding():
    subprocess.run([sys.executable, "scripts/embed_chunks.py"], check=True)

def run_query(query):
    result = subprocess.run(
        [sys.executable, "scripts/query_rag.py", query],
        check=True,
        capture_output=True,
        text=True
    )
    print(result.stdout)
    return result.stdout

def run_pipeline(file_path, query):
    run_chunking(file_path)
    run_embedding()
    return run_query(query)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python pipeline.py <file_path> <query>")
        sys.exit(1)
    file_path = sys.argv[1]
    query = sys.argv[2]
    run_pipeline(file_path, query)
