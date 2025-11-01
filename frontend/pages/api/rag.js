
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { query } = req.body;
  // 1. Check backend connectivity
  try {
    await axios.get('http://localhost:8000/docs');
  } catch (connError) {
    return res.status(500).json({ error: 'Backend not reachable at http://localhost:8000. Is it running?' });
  }

  // 2. Stepwise RAG inference
  try {
    // Call backend with stepwise flag (assume backend supports this, or mock for demo)
    const response = await axios.post('http://localhost:8000/rag', { query, stepwise: true });
    // If backend returns all steps, pass them through
    if (response.data && response.data.steps) {
      res.status(200).json({ steps: response.data.steps, answer: response.data.answer });
    } else if (response.data && response.data.answer) {
      // Fallback: only answer
      res.status(200).json({ answer: response.data.answer });
    } else {
      res.status(500).json({ error: 'Backend returned no answer. Check ingestion and retriever.' });
    }
  } catch (error) {
    let detail = error?.response?.data?.detail || error?.message || 'Unknown error';
    res.status(500).json({ error: `Error fetching augmented answer: ${detail}` });
  }
}
