import os
import sys
import json
import chromadb
import openai
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('all-MiniLM-L6-v2')
def st_embed(text):
    return model.encode(text).tolist()

def get_openai_key():
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        try:
            import getpass
            key = getpass.getpass("Enter your OPENAI_API_KEY (input hidden): ")
        except Exception:
            key = input("Enter your OPENAI_API_KEY: ")
        os.environ["OPENAI_API_KEY"] = key
    return key

def rewrite_query(query):
    key = get_openai_key()
    openai.api_key = key
    try:
        resp = openai.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a helpful assistant that rewrites questions for clarity."},
                {"role": "user", "content": f"Rewrite this question for clarity: {query}"}
            ],
            max_tokens=32
        )
        return resp.choices[0].message.content.strip()
    except Exception:
        return query

def augment_answer(matches, query):
    key = get_openai_key()
    openai.api_key = key
    context = "\n".join([m.get("text", "") for m in matches])
    prompt = f"Answer the following question using only the provided context.\n\nContext:\n{context}\n\nQuestion: {query}\n\nAnswer:"
    try:
        resp = openai.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a helpful assistant that answers questions using only the provided context."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=128
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        return f"Error from OpenAI: {e}"

def main():
    if len(sys.argv) < 2:
        print("Usage: .venv/bin/python scripts/query_rag.py '<your question>'")
        sys.exit(1)
    query = sys.argv[1]
    rewritten = rewrite_query(query)
    embedding = st_embed(rewritten)
    client = chromadb.PersistentClient(path="./chroma_db")
    collection = client.get_or_create_collection(name="rag_collection")
    results = collection.query(query_embeddings=[embedding], n_results=10)
    matches = []
    for ids, docs, metas in zip(results["ids"], results["documents"], results["metadatas"]):
        for doc, meta in zip(docs, metas):
            matches.append({"text": doc, "metadata": meta})
    print("\n--- RAG Pipeline Results ---")
    print(f"Rewritten Query: {rewritten}")
    print(f"Top Matches:")
    if not matches:
        print("No matches retrieved.")
    for i, m in enumerate(matches, 1):
        print(f"[{i}]\n{m['text']}\n---")
    answer = augment_answer(matches, rewritten)
    print(f"\nAugmented Answer:\n{answer}")

if __name__ == "__main__":
    main()
