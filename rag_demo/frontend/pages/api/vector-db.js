
// Use chromadb Node.js client (ensure chromadb is installed and available)
import chromadb from 'chromadb';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { fileName } = req.query;
  try {
    // Connect to ChromaDB and fetch all docs in the collection
    const client = new chromadb.Client();
    const coll = client.get_or_create_collection({ name: 'rag_collection' });
    // Query all docs (optionally filter by fileName in metadata)
    const results = await coll.get();
    let docs = results.documents || [];
    // Optionally filter by fileName if metadata is present
    if (fileName) {
      docs = docs.filter(doc => doc.metadata && doc.metadata.file_name === fileName);
    }
    res.status(200).json({ docs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch vector DB docs.' });
  }
}
