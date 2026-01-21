import chromadb

client = chromadb.PersistentClient(path="./chroma_db")
collection = client.get_or_create_collection(name="rag_collection")

print("Collection name:", collection.name)
print("Number of documents:", collection.count())

# List all document IDs
results = collection.get()
print("Document IDs:", results.get("ids", []))

# Print first 3 documents and their metadata
for i, doc in enumerate(results.get("documents", [])):
    print(f"\nDocument {i+1}:")
    print(doc)
    if "metadatas" in results:
        print("Metadata:", results["metadatas"][i])
    if i >= 2:
        break
