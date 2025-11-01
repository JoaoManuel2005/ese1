import React, { useState, useRef } from 'react';
import axios from 'axios';
import {
  Box,
  Container,
  Typography,
  TextField,
  Button,
  Paper,
  Avatar,
  CircularProgress,
  Fade,
  Chip,
  Stack,
  Card,
  CardContent,
  CardHeader,
  Grid,
  Divider,
  MenuItem,
} from '@mui/material';
import { AutoAwesome, Person, CloudUpload, Settings } from '@mui/icons-material';
import Confetti from 'react-confetti';

const TUSSHAR_NAME = 'Tusshar Lingagiri';

function HomePage() {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [engagement, setEngagement] = useState(false);
  // Upload UI state
  const [file, setFile] = useState(null);
  const fileInputRef = useRef();
  const [model, setModel] = useState('dummy');
  const [status, setStatus] = useState('');
  const [chunkStatus, setChunkStatus] = useState('');
  const [embedStatus, setEmbedStatus] = useState('');

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleModelChange = (e) => {
    setModel(e.target.value);
  };

  // Stepwise ingestion handlers
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [chunking, setChunking] = useState(false);
  const [embedding, setEmbedding] = useState(false);

  const handleUploadStep = async () => {
    setStatus(''); setChunkStatus(''); setEmbedStatus('');
    setUploading(true);
    if (!file) {
      setStatus('Please select a file.'); setUploading(false); return;
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', model);
    try {
  const res = await axios.post('/api/upload', formData);
      setStatus(res.data.message || 'Upload successful!');
      setUploadedFileName(file.name);
      setChunkStatus('Ready to chunk.');
      setFile(null); // Clear file after upload
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      let errorMsg = 'Upload failed.';
      if (err.response && err.response.data && err.response.data.message) {
        errorMsg += ' ' + err.response.data.message;
        if (err.response.data.error) errorMsg += ' ' + err.response.data.error;
      }
      setStatus(errorMsg);
      setChunkStatus('');
      setEmbedStatus('');
    }
    setUploading(false);
  };

  const handleChunkStep = async () => {
    setChunking(true);
    setChunkStatus('Chunking...');
    try {
      // Call chunk API (reuse upload API with chunk only)
      const res = await axios.post('/api/upload', { step: 'chunk', fileName: uploadedFileName });
      setChunkStatus(res.data.chunkStatus ? `Chunking: ${res.data.chunkStatus}` : 'Chunked!');
    } catch (err) {
      setChunkStatus('Chunking failed.');
    }
    setChunking(false);
  };

  const handleEmbedStep = async () => {
    setEmbedding(true);
    setEmbedStatus('Embedding...');
    try {
      // Call embed API (reuse upload API with embed only)
      const res = await axios.post('/api/upload', { step: 'embed', fileName: uploadedFileName, model });
      setEmbedStatus(res.data.embedStatus ? `Embedding: ${res.data.embedStatus} (Model: ${res.data.model})` : 'Embedded!');
    } catch (err) {
      setEmbedStatus('Embedding failed.');
    }
    setEmbedding(false);
  };

  const handleQuery = async () => {
    setLoading(true);
    setEngagement(true);
    setAnswer('');
    // Simulate magical engagement
    setTimeout(async () => {
      // Replace with actual backend call
      const response = await fetch('/api/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await response.json();
      setAnswer(data.answer);
      setLoading(false);
      setTimeout(() => setEngagement(false), 2000);
    }, 1200);
  };

  return (
    <Container maxWidth="lg" sx={{ pt: 8, pb: 8 }}>
      {engagement && <Confetti numberOfPieces={120} recycle={false} />}
      <Grid container spacing={4} alignItems="flex-start">
        <Grid item xs={12} md={7}>
          <Card elevation={6} sx={{ borderRadius: 4, background: 'linear-gradient(135deg,#f5f7fa 0%,#c3cfe2 100%)' }}>
            <CardHeader
              avatar={<Avatar sx={{ bgcolor: 'primary.main', width: 56, height: 56 }}><Person fontSize="large" /></Avatar>}
              title={<Typography variant="h4" fontWeight={700} color="primary.main">RAG Professional Q&A</Typography>}
              subheader={<Chip label={TUSSHAR_NAME} color="secondary" variant="filled" sx={{ fontWeight: 600, fontSize: 16, ml: 1 }} />}
            />
            <Divider />
            <CardContent>
              <Typography variant="subtitle1" color="text.secondary" mb={3}>
                Ask any question and experience magical, global-grade RAG augmentation.
              </Typography>
              <Box component="form" onSubmit={e => { e.preventDefault(); handleQuery(); }}>
                <TextField
                  fullWidth
                  label="Type your question..."
                  variant="outlined"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  sx={{ mb: 3, fontSize: 18 }}
                  InputProps={{ style: { fontSize: 18 } }}
                />
                <Button
                  variant="contained"
                  color="primary"
                  size="large"
                  endIcon={<AutoAwesome />}
                  disabled={loading || !query.trim()}
                  onClick={handleQuery}
                  sx={{ fontWeight: 700, fontSize: 18 }}
                >
                  Get Augmented Answer
                </Button>
              </Box>
              <Fade in={loading} unmountOnExit>
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                  <CircularProgress color="secondary" size={48} />
                </Box>
              </Fade>
              {answer && (
                <Box mt={5} p={3} bgcolor="#f9fafb" borderRadius={3}>
                  <Typography variant="h6" color="primary" fontWeight={700} mb={2}>
                    Augmented Answer
                  </Typography>
                  <Typography variant="body1" color="text.primary" sx={{ fontSize: 18 }}>
                    {answer}
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={5}>
          <Card elevation={6} sx={{ borderRadius: 4, background: 'linear-gradient(135deg,#e0eafc 0%,#cfdef3 100%)', p: 2 }}>
            <CardHeader
              avatar={<Avatar sx={{ bgcolor: 'secondary.main', width: 48, height: 48 }}><CloudUpload fontSize="large" /></Avatar>}
              title={<Typography variant="h6" fontWeight={700} color="secondary.main">Ingestion</Typography>}
              subheader={null}
            />
            <Divider />
            <CardContent>
              <Stack spacing={2} direction="column" alignItems="stretch" mt={2}>
                <Button
                  variant="contained"
                  color="secondary"
                  startIcon={<CloudUpload />}
                  sx={{ fontWeight: 700, fontSize: 16, textTransform: 'none' }}
                  disabled={uploading}
                  component="label"
                >
                  1. Choose Document
                  <input type="file" ref={fileInputRef} onChange={handleFileChange} hidden />
                </Button>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {file ? file.name : uploadedFileName ? uploadedFileName : 'No file chosen'}
                </Typography>
                {file && (
                  <Button
                    variant="outlined"
                    color="primary"
                    sx={{ fontWeight: 700, fontSize: 16, textTransform: 'none', mt: 1 }}
                    disabled={uploading}
                    onClick={handleUploadStep}
                  >
                    Upload
                  </Button>
                )}
                {status && (
                  <Typography variant="body2" color={status.includes('success') ? 'success.main' : 'error'} sx={{ mt: 1 }}>
                    {status}
                  </Typography>
                )}
                <Button variant="contained" color="primary" onClick={handleChunkStep} sx={{ fontWeight: 700, fontSize: 16 }} disabled={!uploadedFileName || chunking}>
                  2. Chunk Document
                </Button>
                <Box display="flex" alignItems="center" gap={2}>
                  <Button variant="contained" color="success" onClick={handleEmbedStep} sx={{ fontWeight: 700, fontSize: 16 }} disabled={!uploadedFileName || embedding}>
                    3. Embed Chunks
                  </Button>
                  <TextField
                    select
                    label="Model"
                    value={model}
                    onChange={handleModelChange}
                    size="small"
                    sx={{ minWidth: 160 }}
                    InputProps={{ startAdornment: <Settings sx={{ mr: 1 }} /> }}
                  >
                    <MenuItem value="dummy">Dummy (Demo)</MenuItem>
                    <MenuItem value="openai">OpenAI</MenuItem>
                    <MenuItem value="sentence-transformers">Sentence Transformers</MenuItem>
                  </TextField>
                </Box>
              </Stack>
              <Typography variant="body2" color="primary" mt={2}>{status}</Typography>
              {chunkStatus && <Typography variant="body2" color="secondary" mt={1}>{chunkStatus}</Typography>}
              {embedStatus && <Typography variant="body2" color="success.main" mt={1}>{embedStatus}</Typography>}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Box mt={6} textAlign="center">
        <Typography variant="body2" color="text.secondary" fontWeight={500}>
          Powered by <span style={{ color: '#1976d2', fontWeight: 700 }}>{TUSSHAR_NAME}</span> | RAG Pipeline Demo for LinkedIn Global Audience
        </Typography>
      </Box>
    </Container>
  );
}

export default HomePage;
