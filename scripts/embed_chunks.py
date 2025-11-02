import os
import json
import chromadb
from sentence_transformers import SentenceTransformer
import sys
import stat

model = SentenceTransformer('all-MiniLM-L6-v2')
def st_embed(text):
    return model.encode(text).tolist()

def ensure_writable_db(db_path):
    """Ensure the database directory and files have write permissions."""
    # Create directory if it doesn't exist
    os.makedirs(db_path, exist_ok=True)
    
    # Set directory permissions to 755 (rwxr-xr-x)
    os.chmod(db_path, stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP | stat.S_IROTH | stat.S_IXOTH)
    
    # Set all existing files in the directory to 644 (rw-r--r--)
    for root, dirs, files in os.walk(db_path):
        for d in dirs:
            dir_path = os.path.join(root, d)
            try:
                os.chmod(dir_path, stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP | stat.S_IROTH | stat.S_IXOTH)
            except:
                pass
        for f in files:
            file_path = os.path.join(root, f)
            try:
                os.chmod(file_path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
            except:
                pass

def main():
    chunks_dir = os.path.abspath(os.path.join(os.getcwd(), "chunks"))
    chunk_files = [f for f in os.listdir(chunks_dir) if f.endswith('.txt')]
    
    # Ensure chroma_db is writable before accessing
    db_path = os.path.abspath("./chroma_db")
    ensure_writable_db(db_path)
    
    client = chromadb.PersistentClient(path=db_path)
    collection = client.get_or_create_collection(name="rag_collection")
    for fname in chunk_files:
        with open(os.path.join(chunks_dir, fname), "r", encoding="utf-8") as f:
            data = json.load(f)
            text = data["text"]
            metadata = data["metadata"]
            embedding = st_embed(text)
            doc_id = fname.replace('.txt', '')
            collection.add(ids=[doc_id], documents=[text], metadatas=[metadata], embeddings=[embedding])
            print(f"Embedded and added {fname} to vector DB.")

if __name__ == "__main__":
    main()
