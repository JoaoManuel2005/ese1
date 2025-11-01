import os
import json
import chromadb
from sentence_transformers import SentenceTransformer
import sys

model = SentenceTransformer('all-MiniLM-L6-v2')
def st_embed(text):
    return model.encode(text).tolist()

def main():
    chunks_dir = os.path.abspath(os.path.join(os.getcwd(), "chunks"))
    chunk_files = [f for f in os.listdir(chunks_dir) if f.endswith('.txt')]
    client = chromadb.PersistentClient(path="./chroma_db")
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
