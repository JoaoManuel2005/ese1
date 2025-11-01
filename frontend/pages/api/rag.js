
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { query } = req.body;

  // 1. Check backend connectivity
  try {
    await axios.get('http://localhost:8000/docs');
  } catch (connError) {
    return res.status(500).json({ answer: 'Backend not reachable at http://localhost:8000. Is it running?' });
  }

  // 2. Check ingestion status (optional: could add a health endpoint in backend)
  // For now, just try the query
  try {
  const response = await axios.post('http://localhost:8000/rag', { query }); // No change needed if port stays the same
    if (!response.data || typeof response.data.answer === 'undefined') {
      return res.status(500).json({ answer: 'Backend returned no answer. Check ingestion and retriever.' });
    }
    res.status(200).json({ answer: response.data.answer });
  } catch (error) {
    let detail = error?.response?.data?.detail || error?.message || 'Unknown error';
    res.status(500).json({ answer: `Error fetching augmented answer: ${detail}` });
  }
}
