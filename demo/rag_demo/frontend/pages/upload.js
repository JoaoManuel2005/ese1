import React, { useState } from 'react';
import axios from 'axios';

export default function UploadPage() {
  const [file, setFile] = useState(null);
  const [model, setModel] = useState('dummy');
  const [status, setStatus] = useState('');

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleModelChange = (e) => {
    setModel(e.target.value);
  };

  const handleUpload = async () => {
    if (!file) {
      setStatus('Please select a file.');
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', model);
    try {
      const res = await axios.post('/api/upload', formData);
      setStatus(res.data.message || 'Upload successful!');
    } catch (err) {
      setStatus('Upload failed.');
    }
  };

  return (
    <div style={{ maxWidth: 500, margin: 'auto', padding: 32 }}>
      <h2>Upload Document & Select Embedding Model</h2>
      <input type="file" onChange={handleFileChange} />
      <div style={{ margin: '16px 0' }}>
        <label>Select Model:&nbsp;</label>
        <select value={model} onChange={handleModelChange}>
          <option value="dummy">Dummy (Demo)</option>
          <option value="openai">OpenAI</option>
          <option value="sentence-transformers">Sentence Transformers</option>
        </select>
      </div>
      <button onClick={handleUpload}>Upload & Embed</button>
      <div style={{ marginTop: 16 }}>{status}</div>
    </div>
  );
}
