
import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Avatar from '@mui/material/Avatar';
import EmojiObjectsIcon from '@mui/icons-material/EmojiObjects';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PsychologyIcon from '@mui/icons-material/Psychology';
import ExpandMore from '@mui/icons-material/ExpandMore';
import {
  Box,
  Button,
  Container,
  Typography,
  TextField,
  Card,
  CardContent,
  Tabs,
  Tab,
  Divider,
  Grid,
  Alert,
  LinearProgress,
  Fade,
  Grow,
  Chip,
  Paper,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import CircularProgress from '@mui/material/CircularProgress';
import Confetti from 'react-confetti';

const bgColor = '#0f172a';
const cardColor = '#1e293b';
const accentColor = '#3b82f6';
const accentHover = '#2563eb';
const borderColor = '#334155';
const textPrimary = '#f1f5f9';
const textSecondary = '#94a3b8';
const successColor = '#10b981';
const warningColor = '#f59e0b';

export default function Home() {
  const [tab, setTab] = useState(0);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const [ingestStatus, setIngestStatus] = useState('');
  const [validateStatus, setValidateStatus] = useState('');
  const [loadingIngest, setLoadingIngest] = useState(false);
  const [loadingValidate, setLoadingValidate] = useState(false);
  const [loadingAsk, setLoadingAsk] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [progress, setProgress] = useState(0);
  const [typingText, setTypingText] = useState('');
  const [completedSteps, setCompletedSteps] = useState([]);
  
  // Ingestion pipeline states
  const [ingestionStep, setIngestionStep] = useState(0); // 0=Upload, 1=Chunk, 2=Embed
  const [uploadedFile, setUploadedFile] = useState(null);
  const [chunksCount, setChunksCount] = useState(0);
  const [selectedModel, setSelectedModel] = useState('sentence-transformers'); // Free model by default
  const [embeddingStatus, setEmbeddingStatus] = useState('');
  
  // Validation states
  const [validationData, setValidationData] = useState(null);
  const [expandedChunk, setExpandedChunk] = useState(null);
  
  // Inference states
  const [inferenceModel, setInferenceModel] = useState('llama3'); // Free model by default
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [parsedAnswer, setParsedAnswer] = useState(null);
  const [expandContext, setExpandContext] = useState(true);
  const [expandCitations, setExpandCitations] = useState(false);

  const handleTabChange = (event, newValue) => {
    setTab(newValue);
  };

  useEffect(() => {
    if (loadingIngest || loadingValidate || loadingAsk) {
      const interval = setInterval(() => {
        setProgress((prev) => (prev >= 100 ? 0 : prev + 10));
      }, 200);
      return () => clearInterval(interval);
    } else {
      setProgress(0);
    }
  }, [loadingIngest, loadingValidate, loadingAsk]);

  useEffect(() => {
    if (answer) {
      let index = 0;
      const fullText = answer;
      setTypingText('');
      const interval = setInterval(() => {
        if (index < fullText.length) {
          setTypingText(fullText.slice(0, index + 1));
          index++;
        } else {
          clearInterval(interval);
        }
      }, 30);
      return () => clearInterval(interval);
    }
  }, [answer]);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setFileName(selectedFile ? selectedFile.name : '');
  };

  // Step 1: Upload Document
  const handleUpload = async () => {
    if (!file) return;
    setLoadingIngest(true);
    setIngestStatus('📤 Uploading document...');
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('http://localhost:8000/upload', {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      setIngestStatus(data.message || '✅ Document uploaded successfully.');
      setUploadedFile(data.filename);
      setIngestionStep(1); // Move to chunk step
    } catch (error) {
      setIngestStatus('❌ Error: ' + error.message);
    } finally {
      setLoadingIngest(false);
    }
  };

  // Step 2: Chunk Document
  const handleChunk = async () => {
    setLoadingIngest(true);
    setIngestStatus('✂️ Chunking document...');
    
    try {
      const response = await fetch('http://localhost:8000/chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: uploadedFile }),
      });
      
      const data = await response.json();
      setIngestStatus(data.message || '✅ Document chunked successfully.');
      setChunksCount(data.chunks_count || 0);
      setIngestionStep(2); // Move to embed step
    } catch (error) {
      setIngestStatus('❌ Error: ' + error.message);
    } finally {
      setLoadingIngest(false);
    }
  };

  // Step 3: Embed Chunks
  const handleEmbed = async () => {
    setLoadingIngest(true);
    setEmbeddingStatus('🧠 Generating embeddings...');
    
    try {
      const response = await fetch('http://localhost:8000/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel }),
      });
      
      const data = await response.json();
      setEmbeddingStatus(data.message || '✅ Embeddings generated successfully.');
      setCompletedSteps([...completedSteps, 0]);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
    } catch (error) {
      setEmbeddingStatus('❌ Error: ' + error.message);
    } finally {
      setLoadingIngest(false);
    }
  };

  const handleValidate = async () => {
    setLoadingValidate(true);
    setValidateStatus('🔍 Scanning chunks and embeddings...');
    setValidationData(null);
    
    try {
      setValidateStatus('📊 Loading from ChromaDB...');
      const response = await fetch('http://localhost:8000/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      const data = await response.json();
      setValidateStatus(data.message || '✅ Chunks validated successfully.');
      setValidationData(data);
      setCompletedSteps([...completedSteps, 1]);
    } catch (error) {
      setValidateStatus('❌ Error: ' + error.message);
      setValidationData(null);
    } finally {
      setLoadingValidate(false);
    }
  };

  const handleAsk = async () => {
    if (!question.trim()) return;
    
    // Validate API key for OpenAI
    if (inferenceModel === 'openai' && !openaiApiKey.trim()) {
      setAnswer('❌ Please provide OpenAI API key for GPT-4 model.');
      return;
    }
    
    setLoadingAsk(true);
    setAnswer('');
    setTypingText('');
    
    try {
      const response = await fetch('http://localhost:8000/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          query: question,
          model: inferenceModel,
          openai_api_key: inferenceModel === 'openai' ? openaiApiKey : null
        }),
      });
      
      const data = await response.json();
      
      // Store structured data if available
      if (data.ai_mode !== undefined && data.retrieved_chunks !== undefined) {
        setParsedAnswer({
          answer: data.answer || 'No answer received.',
          mode: data.ai_mode,
          model: data.model,
          chunks: data.retrieved_chunks || [],
          context: data.context || ''
        });
      } else {
        // Fallback to old format
        setParsedAnswer(null);
      }
      
      setAnswer(data.answer || 'No answer received.');
      setShowConfetti(true);
      setCompletedSteps([...completedSteps, 2]);
      setTimeout(() => setShowConfetti(false), 3000);
    } catch (error) {
      setAnswer('❌ Error: ' + error.message);
    } finally {
      setLoadingAsk(false);
    }
  };

  return (
    <Box sx={{ height: '100vh', background: bgColor, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {showConfetti && <Confetti width={typeof window !== 'undefined' ? window.innerWidth : 1200} height={typeof window !== 'undefined' ? window.innerHeight : 800} numberOfPieces={200} recycle={false} />}
      <Container maxWidth="lg" sx={{ flex: 1, display: 'flex', flexDirection: 'column', py: 2 }}>
        <Head>
          <title>RAG Professional Q&A - Next-Gen AI Pipeline</title>
          <meta name="description" content="Experience the future of document intelligence with RAG" />
        </Head>
        
        {/* Compact Header with Sparkle Effect */}
        <Fade in timeout={800}>
          <Box sx={{ textAlign: 'center', mb: 2, position: 'relative' }}>
            <Box sx={{ 
              display: 'inline-flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: 2,
              position: 'relative',
              '&::before': {
                content: '"✨"',
                position: 'absolute',
                left: -20,
                top: -5,
                fontSize: '1.2rem',
                animation: 'sparkle 2s ease-in-out infinite',
                '@keyframes sparkle': {
                  '0%, 100%': { opacity: 0.3, transform: 'rotate(0deg)' },
                  '50%': { opacity: 1, transform: 'rotate(20deg)' }
                }
              },
              '&::after': {
                content: '"✨"',
                position: 'absolute',
                right: -20,
                bottom: -5,
                fontSize: '1.2rem',
                animation: 'sparkle 2s ease-in-out infinite 1s',
                '@keyframes sparkle': {
                  '0%, 100%': { opacity: 0.3, transform: 'rotate(0deg)' },
                  '50%': { opacity: 1, transform: 'rotate(-20deg)' }
                }
              }
            }}>
              <Avatar sx={{ 
                bgcolor: accentColor, 
                width: 48, 
                height: 48, 
                boxShadow: `0 0 20px ${accentColor}80`,
                animation: 'pulse 2s ease-in-out infinite',
                position: 'relative',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  inset: -4,
                  borderRadius: '50%',
                  padding: 2,
                  background: `linear-gradient(45deg, ${accentColor}, ${warningColor}, ${successColor})`,
                  WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                  WebkitMaskComposite: 'xor',
                  maskComposite: 'exclude',
                  animation: 'rotate 3s linear infinite',
                },
                '@keyframes pulse': {
                  '0%, 100%': { transform: 'scale(1)' },
                  '50%': { transform: 'scale(1.05)' }
                },
                '@keyframes rotate': {
                  '0%': { transform: 'rotate(0deg)' },
                  '100%': { transform: 'rotate(360deg)' }
                }
              }}>
                <EmojiObjectsIcon sx={{ fontSize: 28 }} />
              </Avatar>
              <Box sx={{ textAlign: 'left' }}>
                <Typography 
                  variant="h4" 
                  fontWeight={800} 
                  sx={{ 
                    color: textPrimary,
                    background: `linear-gradient(135deg, ${accentColor} 0%, ${warningColor} 50%, #8b5cf6 100%)`,
                    backgroundSize: '200% 200%',
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    lineHeight: 1.2,
                    animation: 'gradientShift 3s ease infinite',
                    '@keyframes gradientShift': {
                      '0%, 100%': { backgroundPosition: '0% 50%' },
                      '50%': { backgroundPosition: '100% 50%' }
                    }
                  }}
                >
                  AI-Augmented Intelligence Platform
                </Typography>
                <Typography 
                  variant="body1" 
                  fontWeight={600}
                  sx={{ 
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.8,
                    background: `linear-gradient(135deg, ${accentColor} 0%, ${warningColor} 100%)`,
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    letterSpacing: '0.5px'
                  }}
                >
                  <Box component="span" sx={{ 
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: successColor,
                    boxShadow: `0 0 8px ${successColor}`,
                    animation: 'blink 2s ease-in-out infinite',
                    '@keyframes blink': {
                      '0%, 100%': { opacity: 1 },
                      '50%': { opacity: 0.3 }
                    }
                  }} />
                  ⚡ Powered by Tusshar Lingagiri
                </Typography>
              </Box>
            </Box>
          </Box>
        </Fade>

        {/* Progress Indicator */}
        {(loadingIngest || loadingValidate || loadingAsk) && (
          <Box sx={{ mb: 1 }}>
            <LinearProgress 
              variant="determinate" 
              value={progress} 
              sx={{ 
                height: 4, 
                borderRadius: 2,
                bgcolor: borderColor,
                '& .MuiLinearProgress-bar': {
                  bgcolor: accentColor,
                  boxShadow: `0 0 10px ${accentColor}`
                }
              }} 
            />
          </Box>
        )}

        {/* Magical Status Pills */}
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1.5, mb: 2 }}>
          <Chip
            icon={<CloudUploadIcon sx={{ fontSize: 18 }} />}
            label="Ingestion"
            onClick={() => setTab(0)}
            size="small"
            sx={{ 
              bgcolor: tab === 0 ? accentColor : cardColor,
              color: tab === 0 ? textPrimary : textSecondary,
              fontWeight: 600,
              px: 1.5,
              py: 2,
              fontSize: '0.85rem',
              border: `1px solid ${tab === 0 ? accentColor : borderColor}`,
              cursor: 'pointer',
              transition: 'all 0.3s',
              boxShadow: tab === 0 ? `0 0 20px ${accentColor}80, 0 0 40px ${accentColor}40` : 'none',
              position: 'relative',
              overflow: 'hidden',
              '&:hover': {
                bgcolor: tab === 0 ? accentHover : borderColor,
                transform: 'translateY(-2px) scale(1.05)',
                boxShadow: `0 0 25px ${accentColor}90`
              },
              '&::before': tab === 0 ? {
                content: '""',
                position: 'absolute',
                top: 0,
                left: '-100%',
                width: '100%',
                height: '100%',
                background: `linear-gradient(90deg, transparent, ${textPrimary}30, transparent)`,
                animation: 'shimmer 2s infinite',
                '@keyframes shimmer': {
                  '0%': { left: '-100%' },
                  '100%': { left: '200%' }
                }
              } : {}
            }}
          />
          <Chip
            icon={<CheckCircleIcon sx={{ fontSize: 18 }} />}
            label="Validation"
            onClick={() => setTab(1)}
            size="small"
            sx={{ 
              bgcolor: tab === 1 ? successColor : cardColor,
              color: tab === 1 ? textPrimary : textSecondary,
              fontWeight: 600,
              px: 1.5,
              py: 2,
              fontSize: '0.85rem',
              border: `1px solid ${tab === 1 ? successColor : borderColor}`,
              cursor: 'pointer',
              transition: 'all 0.3s',
              boxShadow: tab === 1 ? `0 0 20px ${successColor}80, 0 0 40px ${successColor}40` : 'none',
              position: 'relative',
              overflow: 'hidden',
              '&:hover': {
                bgcolor: tab === 1 ? '#059669' : borderColor,
                transform: 'translateY(-2px) scale(1.05)',
                boxShadow: `0 0 25px ${successColor}90`
              },
              '&::before': tab === 1 ? {
                content: '""',
                position: 'absolute',
                top: 0,
                left: '-100%',
                width: '100%',
                height: '100%',
                background: `linear-gradient(90deg, transparent, ${textPrimary}30, transparent)`,
                animation: 'shimmer 2s infinite',
                '@keyframes shimmer': {
                  '0%': { left: '-100%' },
                  '100%': { left: '200%' }
                }
              } : {}
            }}
          />
          <Chip
            icon={<PsychologyIcon sx={{ fontSize: 18 }} />}
            label="Inference"
            onClick={() => setTab(2)}
            size="small"
            sx={{ 
              bgcolor: tab === 2 ? warningColor : cardColor,
              color: tab === 2 ? textPrimary : textSecondary,
              fontWeight: 600,
              px: 1.5,
              py: 2,
              fontSize: '0.85rem',
              border: `1px solid ${tab === 2 ? warningColor : borderColor}`,
              cursor: 'pointer',
              transition: 'all 0.3s',
              boxShadow: tab === 2 ? `0 0 20px ${warningColor}80, 0 0 40px ${warningColor}40` : 'none',
              position: 'relative',
              overflow: 'hidden',
              '&:hover': {
                bgcolor: tab === 2 ? '#d97706' : borderColor,
                transform: 'translateY(-2px) scale(1.05)',
                boxShadow: `0 0 25px ${warningColor}90`
              },
              '&::before': tab === 2 ? {
                content: '""',
                position: 'absolute',
                top: 0,
                left: '-100%',
                width: '100%',
                height: '100%',
                background: `linear-gradient(90deg, transparent, ${textPrimary}30, transparent)`,
                animation: 'shimmer 2s infinite',
                '@keyframes shimmer': {
                  '0%': { left: '-100%' },
                  '100%': { left: '200%' }
                }
              } : {}
            }}
          />
        </Box>
        {/* Content Area - Compact */}
        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {tab === 0 && (
            <Grow in timeout={600} style={{ width: '100%' }}>
              <Paper elevation={6} sx={{ 
                width: '100%',
                background: cardColor, 
                borderRadius: 3, 
                border: `2px solid ${accentColor}40`,
                boxShadow: `0 0 30px ${accentColor}30`,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}>
                <Box sx={{ 
                  background: `linear-gradient(135deg, ${accentColor}20 0%, transparent 100%)`,
                  p: 2.5,
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column'
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <CloudUploadIcon sx={{ fontSize: 32, color: accentColor, mr: 1.5 }} />
                    <Box>
                      <Typography variant="h5" fontWeight={700} sx={{ color: textPrimary, lineHeight: 1.2 }}>
                        Document Ingestion Pipeline
                      </Typography>
                      <Typography variant="body2" sx={{ color: textSecondary }}>
                        3-Step RAG Ingestion: Upload → Chunk → Embed
                      </Typography>
                    </Box>
                  </Box>
                  
                  {/* Step Progress Indicator */}
                  <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                    {['📄 Upload', '✂️ Chunk', '🧠 Embed'].map((label, idx) => (
                      <Box 
                        key={idx}
                        sx={{ 
                          flex: 1, 
                          py: 0.8, 
                          px: 1.5,
                          borderRadius: 2,
                          textAlign: 'center',
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          background: ingestionStep === idx 
                            ? `linear-gradient(135deg, ${accentColor} 0%, ${accentHover} 100%)`
                            : ingestionStep > idx 
                            ? `linear-gradient(135deg, ${successColor} 0%, #059669 100%)`
                            : borderColor,
                          color: ingestionStep >= idx ? textPrimary : textSecondary,
                          border: ingestionStep === idx ? `2px solid ${accentColor}` : 'none',
                          transition: 'all 0.3s',
                          boxShadow: ingestionStep === idx ? `0 0 15px ${accentColor}60` : 'none'
                        }}
                      >
                        {label} {ingestionStep > idx && '✓'}
                      </Box>
                    ))}
                  </Box>
                  
                  {/* Step 0: Upload */}
                  {ingestionStep === 0 && (
                    <Fade in timeout={400}>
                      <Box>
                        <Box sx={{ 
                          border: `2px dashed ${borderColor}`,
                          borderRadius: 2,
                          p: 2.5,
                          textAlign: 'center',
                          bgcolor: `${bgColor}80`,
                          transition: 'all 0.3s',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                          minHeight: 140,
                          position: 'relative',
                          '&:hover': {
                            borderColor: accentColor,
                            bgcolor: `${accentColor}10`
                          }
                        }}>
                          <input 
                            type="file" 
                            onChange={handleFileChange} 
                            style={{ display: 'none' }} 
                            id="file-upload"
                          />
                          <label htmlFor="file-upload" style={{ cursor: 'pointer' }}>
                            <CloudUploadIcon sx={{ fontSize: 48, color: accentColor, mb: 1 }} />
                            <Typography variant="body1" sx={{ color: textPrimary, mb: 0.5, fontWeight: 600 }}>
                              {fileName ? `✓ ${fileName}` : '✨ Drop your file here'}
                            </Typography>
                            <Typography variant="caption" sx={{ color: textSecondary }}>
                              PDF • TXT • DOCX • HTML
                            </Typography>
                          </label>
                        </Box>
                        <Button 
                          variant="contained" 
                          fullWidth
                          sx={{ mt: 2, py: 1.5, background: `linear-gradient(135deg, ${accentColor} 0%, ${accentHover} 100%)`, fontWeight: 700 }} 
                          onClick={handleUpload} 
                          disabled={!file || loadingIngest}
                        >
                          {loadingIngest ? <CircularProgress size={20} /> : '📤 Upload Document'}
                        </Button>
                        {ingestStatus && <Alert severity="info" sx={{ mt: 2 }}>{ingestStatus}</Alert>}
                      </Box>
                    </Fade>
                  )}

                  {/* Step 1: Chunk */}
                  {ingestionStep === 1 && (
                    <Fade in timeout={400}>
                      <Box>
                        <Typography variant="body1" sx={{ color: textPrimary, mb: 2 }}>
                          📄 File: <strong>{uploadedFile}</strong>
                        </Typography>
                        <Typography variant="body2" sx={{ color: textSecondary, mb: 2 }}>
                          Split document into semantic chunks for optimal RAG performance
                        </Typography>
                        <Button 
                          variant="contained" 
                          fullWidth
                          sx={{ py: 1.5, background: `linear-gradient(135deg, ${warningColor} 0%, #f59e0b 100%)`, fontWeight: 700 }} 
                          onClick={handleChunk} 
                          disabled={loadingIngest}
                        >
                          {loadingIngest ? <CircularProgress size={20} /> : '✂️ Chunk Document'}
                        </Button>
                        {ingestStatus && <Alert severity="info" sx={{ mt: 2 }}>{ingestStatus}</Alert>}
                      </Box>
                    </Fade>
                  )}

                  {/* Step 2: Embed */}
                  {ingestionStep === 2 && (
                    <Fade in timeout={400}>
                      <Box>
                        <Box sx={{ maxHeight: '280px', overflowY: 'auto', pr: 1 }}>
                          <Typography variant="body2" sx={{ color: textPrimary, mb: 1 }}>
                            ✂️ <strong>{chunksCount}</strong> chunks ready for embedding
                          </Typography>
                          
                          <Typography variant="caption" sx={{ color: accentColor, fontWeight: 600, mb: 0.5, display: 'block', fontSize: '0.7rem' }}>
                            💰 PAID (API Key)
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 0.5, mb: 1 }}>
                            {[
                              { id: 'openai', label: 'OpenAI', icon: '🤖' },
                              { id: 'bedrock', label: 'Bedrock', icon: '🌩️' },
                            ].map((model) => (
                              <Box 
                                key={model.id}
                                onClick={() => setSelectedModel(model.id)}
                                sx={{ 
                                  flex: 1,
                                  p: 1,
                                  border: `2px solid ${selectedModel === model.id ? accentColor : borderColor}`,
                                  borderRadius: 1.5,
                                  cursor: 'pointer',
                                  bgcolor: selectedModel === model.id ? `${accentColor}15` : 'transparent',
                                  textAlign: 'center',
                                  transition: 'all 0.2s',
                                  '&:hover': { borderColor: accentColor }
                                }}
                              >
                                <Typography variant="body2" sx={{ color: textPrimary, fontSize: '0.75rem' }}>
                                  {model.icon} {model.label}
                                </Typography>
                              </Box>
                            ))}
                          </Box>

                          <Typography variant="caption" sx={{ color: successColor, fontWeight: 600, mb: 0.5, display: 'block', fontSize: '0.7rem' }}>
                            ✨ FREE (No API Key)
                          </Typography>
                          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, mb: 1 }}>
                            {[
                              { id: 'sentence-transformers', label: 'Sentence-BERT', icon: '🤗' },
                              { id: 'bge-small', label: 'BGE-Small', icon: '🇨🇳' },
                              { id: 'instructor', label: 'Instructor', icon: '🎓' },
                              { id: 'e5-small', label: 'E5-Small', icon: '🔬' }
                            ].map((model) => (
                              <Box 
                                key={model.id}
                                onClick={() => setSelectedModel(model.id)}
                                sx={{ 
                                  p: 1,
                                  border: `2px solid ${selectedModel === model.id ? successColor : borderColor}`,
                                  borderRadius: 1.5,
                                  cursor: 'pointer',
                                  bgcolor: selectedModel === model.id ? `${successColor}15` : 'transparent',
                                  textAlign: 'center',
                                  transition: 'all 0.2s',
                                  '&:hover': { borderColor: successColor }
                                }}
                              >
                                <Typography variant="body2" sx={{ color: textPrimary, fontSize: '0.75rem' }}>
                                  {model.icon} {model.label}
                                </Typography>
                              </Box>
                            ))}
                          </Box>
                        </Box>

                        <Button 
                          variant="contained" 
                          fullWidth
                          sx={{ mt: 1, py: 1.5, background: `linear-gradient(135deg, ${successColor} 0%, #059669 100%)`, fontWeight: 700 }} 
                          onClick={handleEmbed} 
                          disabled={loadingIngest}
                        >
                          {loadingIngest ? <CircularProgress size={20} sx={{ color: 'white' }} /> : '🧠 Generate Embeddings'}
                        </Button>
                        {embeddingStatus && (
                          <>
                            <Alert severity="success" sx={{ mt: 1, py: 0.5 }}>{embeddingStatus}</Alert>
                            <Button 
                              variant="outlined" 
                              fullWidth
                              sx={{ 
                                mt: 1.5, 
                                py: 1.5, 
                                borderColor: accentColor,
                                color: accentColor,
                                fontWeight: 700,
                                '&:hover': {
                                  borderColor: accentHover,
                                  bgcolor: `${accentColor}15`
                                }
                              }} 
                              onClick={() => {
                                setIngestionStep(0);
                                setFile(null);
                                setFileName('');
                                setUploadedFile(null);
                                setChunksCount(0);
                                setEmbeddingStatus('');
                                setIngestStatus('');
                              }}
                            >
                              📄 Upload Another Document
                            </Button>
                          </>
                        )}
                      </Box>
                    </Fade>
                  )}
                </Box>
              </Paper>
            </Grow>
          )}
          {tab === 1 && (
            <Grow in timeout={600} style={{ width: '100%' }}>
              <Paper elevation={6} sx={{ 
                width: '100%',
                background: cardColor, 
                borderRadius: 3, 
                border: `2px solid ${successColor}40`,
                boxShadow: `0 0 30px ${successColor}30`,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}>
                <Box sx={{ 
                  background: `linear-gradient(135deg, ${successColor}20 0%, transparent 100%)`,
                  p: 2.5,
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center'
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                    <CheckCircleIcon sx={{ fontSize: 32, color: successColor, mr: 1.5 }} />
                    <Box>
                      <Typography variant="h5" fontWeight={700} sx={{ color: textPrimary, lineHeight: 1.2 }}>
                        Chunk Validation
                      </Typography>
                      <Typography variant="body2" sx={{ color: textSecondary }}>
                        Verify chunk quality and semantic coherence
                      </Typography>
                    </Box>
                  </Box>

                  <Button 
                    variant="contained" 
                    fullWidth
                    sx={{ 
                      py: 1.5,
                      background: `linear-gradient(135deg, ${successColor} 0%, #059669 100%)`,
                      color: textPrimary, 
                      fontWeight: 700,
                      boxShadow: `0 4px 15px ${successColor}60`,
                      transition: 'all 0.3s',
                      '&:hover': { 
                        background: `linear-gradient(135deg, #059669 0%, #047857 100%)`,
                        transform: 'translateY(-1px)',
                        boxShadow: `0 6px 20px ${successColor}80`
                      }
                    }} 
                    onClick={handleValidate}
                    disabled={loadingValidate}
                  >
                    {loadingValidate ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <CircularProgress size={20} sx={{ color: textPrimary }} />
                        <span>Loading...</span>
                      </Box>
                    ) : (
                      '✓ Load Chunks & Embeddings'
                    )}
                  </Button>
                  
                  {validateStatus && (
                    <Fade in timeout={500}>
                      <Alert 
                        severity={loadingValidate ? "info" : (validateStatus.includes('❌') ? "error" : "success")}
                        icon={completedSteps.includes(1) ? <CheckCircleIcon /> : undefined}
                        sx={{ 
                          mt: 2,
                          bgcolor: `${successColor}15`,
                          color: textPrimary,
                          border: `1px solid ${successColor}40`,
                          fontSize: '0.9rem',
                          py: 0.5,
                          '& .MuiAlert-icon': { color: successColor }
                        }}
                      >
                        {validateStatus}
                      </Alert>
                    </Fade>
                  )}
                  
                  {validationData && validationData.chunks && (
                    <Box sx={{ mt: 3, maxHeight: 500, overflowY: 'auto', pr: 1 }}>
                      <Typography variant="h6" sx={{ color: textPrimary, mb: 2, fontWeight: 600 }}>
                        📚 Chunks ({validationData.chunks_count})
                      </Typography>
                      
                      {validationData.chunks.map((chunk, index) => (
                        <Card key={index} sx={{ 
                          mb: 2,
                          bgcolor: bgColor,
                          border: `1px solid ${borderColor}`,
                          borderRadius: 2,
                          overflow: 'hidden',
                          transition: 'all 0.3s',
                          '&:hover': {
                            borderColor: successColor,
                            boxShadow: `0 0 15px ${successColor}40`
                          }
                        }}>
                          <CardContent sx={{ p: 2 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                              <Typography variant="subtitle2" sx={{ color: successColor, fontWeight: 700 }}>
                                {chunk.filename}
                              </Typography>
                              <Chip 
                                label={`${chunk.size} chars`} 
                                size="small" 
                                sx={{ 
                                  bgcolor: `${successColor}20`,
                                  color: successColor,
                                  fontWeight: 600,
                                  fontSize: '0.75rem'
                                }} 
                              />
                            </Box>
                            
                            <Typography 
                              variant="body2" 
                              sx={{ 
                                color: textSecondary,
                                mb: 1.5,
                                maxHeight: expandedChunk === index ? 'none' : 100,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: expandedChunk === index ? 'pre-wrap' : 'nowrap',
                                fontFamily: 'monospace',
                                fontSize: '0.85rem',
                                lineHeight: 1.6
                              }}
                            >
                              {chunk.content}
                            </Typography>
                            
                            <Button 
                              size="small" 
                              onClick={() => setExpandedChunk(expandedChunk === index ? null : index)}
                              sx={{ 
                                color: accentColor, 
                                textTransform: 'none',
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                mb: 1
                              }}
                            >
                              {expandedChunk === index ? '▲ Show Less' : '▼ Show More'}
                            </Button>
                            
                            {chunk.embedding && (
                              <Box sx={{ 
                                mt: 2, 
                                p: 1.5,
                                bgcolor: `${accentColor}10`,
                                borderRadius: 1.5,
                                border: `1px solid ${accentColor}30`
                              }}>
                                <Typography variant="caption" sx={{ color: accentColor, fontWeight: 700, display: 'block', mb: 0.5 }}>
                                  🧠 Embedding Vector ({chunk.embedding_dim} dimensions)
                                </Typography>
                                <Typography variant="caption" sx={{ 
                                  color: textSecondary,
                                  fontFamily: 'monospace',
                                  fontSize: '0.7rem',
                                  display: 'block'
                                }}>
                                  [{chunk.embedding.map(v => v.toFixed(4)).join(', ')}...]
                                </Typography>
                              </Box>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </Box>
                  )}
                </Box>
              </Paper>
            </Grow>
          )}
          {tab === 2 && (
            <Grow in timeout={600} style={{ width: '100%' }}>
              <Paper elevation={6} sx={{ 
                width: '100%',
                background: cardColor, 
                borderRadius: 3, 
                border: `2px solid ${warningColor}40`,
                boxShadow: `0 0 30px ${warningColor}30`,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}>
                <Box sx={{ 
                  background: `linear-gradient(135deg, ${warningColor}20 0%, transparent 100%)`,
                  p: 2.5,
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  maxHeight: '85vh',
                  overflow: 'hidden'
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <PsychologyIcon sx={{ fontSize: 32, color: warningColor, mr: 1.5 }} />
                    <Box>
                      <Typography variant="h5" fontWeight={700} sx={{ color: textPrimary, lineHeight: 1.2 }}>
                        AI Inference
                      </Typography>
                      <Typography variant="body2" sx={{ color: textSecondary }}>
                        Ask anything - Experience magical RAG
                      </Typography>
                    </Box>
                  </Box>

                  {/* Compact Model Selection */}
                  <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="caption" sx={{ color: textSecondary, fontWeight: 600, mr: 0.5 }}>
                      🤖 Model:
                    </Typography>
                    {[
                      { id: 'llama3', name: '🦙 Llama3', free: true },
                      { id: 'mistral', name: '🌊 Mistral', free: true },
                      { id: 'gemma', name: '💎 Gemma', free: true },
                      { id: 'openai', name: '⚡ GPT-4', free: false }
                    ].map(model => (
                      <Chip
                        key={model.id}
                        label={model.name}
                        onClick={() => setInferenceModel(model.id)}
                        sx={{
                          bgcolor: inferenceModel === model.id ? `${warningColor}` : `${bgColor}80`,
                          color: inferenceModel === model.id ? textPrimary : textSecondary,
                          border: `1px solid ${inferenceModel === model.id ? warningColor : borderColor}`,
                          fontWeight: inferenceModel === model.id ? 700 : 500,
                          fontSize: '0.75rem',
                          height: 28,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          '&:hover': {
                            bgcolor: inferenceModel === model.id ? warningColor : `${warningColor}30`,
                            borderColor: warningColor,
                            transform: 'scale(1.05)'
                          }
                        }}
                      />
                    ))}
                  </Box>

                  {/* Compact OpenAI API Key Input */}
                  {inferenceModel === 'openai' && (
                    <Fade in timeout={300}>
                      <TextField
                        label="🔑 API Key"
                        fullWidth
                        size="small"
                        type={showApiKey ? 'text' : 'password'}
                        value={openaiApiKey}
                        onChange={e => setOpenaiApiKey(e.target.value)}
                        placeholder="sk-..."
                        sx={{ 
                          mb: 1.5,
                          '& .MuiOutlinedInput-root': {
                            color: textPrimary,
                            bgcolor: `${bgColor}80`,
                            fontSize: '0.85rem',
                            fontFamily: 'monospace',
                            '& fieldset': {
                              borderColor: borderColor
                            },
                            '&:hover fieldset': {
                              borderColor: warningColor
                            },
                            '&.Mui-focused fieldset': {
                              borderColor: warningColor
                            }
                          },
                          '& .MuiInputLabel-root': {
                            color: textSecondary,
                            fontSize: '0.85rem'
                          }
                        }}
                        InputProps={{
                          endAdornment: (
                            <Button
                              size="small"
                              onClick={() => setShowApiKey(!showApiKey)}
                              sx={{ 
                                minWidth: 'auto',
                                color: textSecondary,
                                fontSize: '0.7rem',
                                textTransform: 'none',
                                p: 0.5
                              }}
                            >
                              {showApiKey ? '�️' : '👁️‍🗨️'}
                            </Button>
                          )
                        }}
                      />
                    </Fade>
                  )}

                  {/* Question Input and Button in one row */}
                  <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
                    <TextField
                      label="💬 Ask your question"
                      fullWidth
                      size="small"
                      value={question}
                      onChange={e => setQuestion(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && question) {
                          e.preventDefault();
                          handleAsk();
                        }
                      }}
                      sx={{ 
                        flex: 1,
                        '& .MuiOutlinedInput-root': {
                          color: textPrimary,
                          bgcolor: `${bgColor}80`,
                          fontSize: '0.9rem',
                          '& fieldset': {
                            borderColor: borderColor
                          },
                          '&:hover fieldset': {
                            borderColor: warningColor
                          },
                          '&.Mui-focused fieldset': {
                            borderColor: warningColor
                          }
                        },
                        '& .MuiInputLabel-root': {
                          color: textSecondary,
                          fontSize: '0.9rem'
                        }
                      }}
                    />

                    <Button 
                      variant="contained"
                      sx={{ 
                        px: 3,
                        background: `linear-gradient(135deg, ${warningColor} 0%, #d97706 100%)`,
                        color: textPrimary, 
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        boxShadow: `0 4px 15px ${warningColor}60`,
                        transition: 'all 0.3s',
                        '&:hover': { 
                          background: `linear-gradient(135deg, #d97706 0%, #b45309 100%)`,
                          transform: 'translateY(-1px)',
                          boxShadow: `0 6px 20px ${warningColor}80`
                        },
                        '&:disabled': {
                          background: borderColor,
                          color: textSecondary
                        }
                      }} 
                      onClick={handleAsk} 
                      disabled={!question || loadingAsk}
                    >
                      {loadingAsk ? (
                        <CircularProgress size={18} sx={{ color: textPrimary }} />
                      ) : (
                        '✨ Ask'
                      )}
                    </Button>
                  </Box>
                  
                  {/* Answer Display Area - Redesigned with Answer as Focal Point */}
                  {typingText && parsedAnswer && (
                    <Fade in timeout={500}>
                      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 1.5 }}>
                        {/* AI Answer Section - FOCAL POINT */}
                        <Box sx={{ 
                          bgcolor: `${bgColor}80`, 
                          border: `3px solid ${warningColor}`,
                          borderRadius: 3, 
                          overflow: 'hidden',
                          boxShadow: `0 0 30px ${warningColor}50, 0 0 60px ${warningColor}20`,
                          position: 'relative',
                          '&::before': {
                            content: '""',
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            height: 4,
                            background: `linear-gradient(90deg, ${warningColor}, ${accentColor}, ${successColor}, ${warningColor})`,
                            backgroundSize: '200% 100%',
                            animation: 'shimmer 3s linear infinite',
                            '@keyframes shimmer': {
                              '0%': { backgroundPosition: '0% 0%' },
                              '100%': { backgroundPosition: '200% 0%' }
                            }
                          }
                        }}>
                          <Box sx={{ 
                            p: 2, 
                            background: `linear-gradient(135deg, ${warningColor}15 0%, transparent 100%)`,
                            borderBottom: `1px solid ${borderColor}`, 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center' 
                          }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box sx={{
                                width: 36,
                                height: 36,
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${warningColor}, ${accentColor})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: `0 0 20px ${warningColor}60`,
                                animation: 'pulse 2s ease-in-out infinite',
                                '@keyframes pulse': {
                                  '0%, 100%': { transform: 'scale(1)' },
                                  '50%': { transform: 'scale(1.1)' }
                                }
                              }}>
                                <PsychologyIcon sx={{ fontSize: 20, color: textPrimary }} />
                              </Box>
                              <Box>
                                <Typography variant="h6" sx={{ color: warningColor, fontWeight: 700, lineHeight: 1.2 }}>
                                  AI-Augmented Answer
                                </Typography>
                                <Typography variant="caption" sx={{ color: textSecondary, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <Chip 
                                    label={parsedAnswer.model} 
                                    size="small" 
                                    sx={{ 
                                      height: 18, 
                                      fontSize: '0.65rem', 
                                      bgcolor: `${warningColor}20`, 
                                      color: warningColor,
                                      fontWeight: 600
                                    }} 
                                  />
                                  • RAG Enhanced
                                </Typography>
                              </Box>
                            </Box>
                            <Button
                              size="small"
                              onClick={() => {
                                navigator.clipboard.writeText(parsedAnswer.answer);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                              }}
                              sx={{
                                px: 1.5,
                                py: 0.5,
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: copied ? textPrimary : warningColor,
                                bgcolor: copied ? successColor : `${warningColor}20`,
                                border: `1px solid ${copied ? successColor : warningColor}`,
                                borderRadius: 1.5,
                                textTransform: 'none',
                                transition: 'all 0.3s',
                                '&:hover': {
                                  bgcolor: copied ? successColor : warningColor,
                                  color: textPrimary,
                                  transform: 'translateY(-1px)',
                                  boxShadow: `0 4px 12px ${copied ? successColor : warningColor}40`
                                }
                              }}
                            >
                              {copied ? '✓ Copied!' : '📋 Copy Answer'}
                            </Button>
                          </Box>
                          <Box sx={{ p: 3, maxHeight: 300, overflow: 'auto' }}>
                            <Typography variant="body1" sx={{ 
                              color: textPrimary, 
                              fontSize: '1rem', 
                              lineHeight: 1.8, 
                              whiteSpace: 'pre-wrap',
                              fontWeight: 500
                            }}>
                              {parsedAnswer.answer}
                            </Typography>
                          </Box>
                        </Box>

                        {/* Compact Collapsible Sections Below */}
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          {/* Retrieved Context Section - Compact */}
                          <Box sx={{ 
                            flex: 1,
                            bgcolor: `${bgColor}80`, 
                            border: `1px solid ${accentColor}40`, 
                            borderRadius: 2, 
                            overflow: 'hidden',
                            transition: 'all 0.3s',
                            '&:hover': {
                              borderColor: accentColor,
                              boxShadow: `0 0 15px ${accentColor}30`
                            }
                          }}>
                            <Box 
                              onClick={() => setExpandContext(!expandContext)}
                              sx={{ 
                                p: 1.5, 
                                borderBottom: expandContext ? `1px solid ${borderColor}` : 'none', 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center', 
                                cursor: 'pointer',
                                bgcolor: expandContext ? `${accentColor}10` : 'transparent',
                                '&:hover': { bgcolor: `${accentColor}10` } 
                              }}
                            >
                              <Typography variant="caption" sx={{ color: accentColor, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.8rem' }}>
                                📚 Context
                                <Chip label={`${parsedAnswer.chunks?.length || 0}`} size="small" sx={{ height: 18, fontSize: '0.65rem', bgcolor: `${accentColor}20`, color: accentColor, fontWeight: 600 }} />
                              </Typography>
                              <Typography variant="caption" sx={{ color: textSecondary, fontSize: '0.75rem' }}>{expandContext ? '▲' : '▼'}</Typography>
                            </Box>
                            {expandContext && (
                              <Box sx={{ 
                                p: 1.5, 
                                maxHeight: 400, 
                                overflow: 'auto',
                                '&::-webkit-scrollbar': { width: '6px' },
                                '&::-webkit-scrollbar-track': { background: 'rgba(255,255,255,0.05)' },
                                '&::-webkit-scrollbar-thumb': { background: accentColor, borderRadius: '3px' }
                              }}>
                                <Typography variant="caption" sx={{ color: textSecondary, fontSize: '0.8rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                                  {parsedAnswer.context}
                                </Typography>
                              </Box>
                            )}
                          </Box>

                          {/* Citations Section - Compact */}
                          {parsedAnswer.chunks && parsedAnswer.chunks.length > 0 && (
                            <Box sx={{ 
                              flex: 1,
                              bgcolor: `${bgColor}80`, 
                              border: `1px solid ${successColor}40`, 
                              borderRadius: 2, 
                              overflow: 'hidden',
                              transition: 'all 0.3s',
                              '&:hover': {
                                borderColor: successColor,
                                boxShadow: `0 0 15px ${successColor}30`
                              }
                            }}>
                              <Box 
                                onClick={() => setExpandCitations(!expandCitations)}
                                sx={{ 
                                  p: 1.5, 
                                  borderBottom: expandCitations ? `1px solid ${borderColor}` : 'none', 
                                  display: 'flex', 
                                  justifyContent: 'space-between', 
                                  alignItems: 'center', 
                                  cursor: 'pointer',
                                  bgcolor: expandCitations ? `${successColor}10` : 'transparent',
                                  '&:hover': { bgcolor: `${successColor}10` } 
                                }}
                              >
                                <Typography variant="caption" sx={{ color: successColor, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.8rem' }}>
                                  📖 Citations
                                  <Chip label={parsedAnswer.chunks.length} size="small" sx={{ height: 18, fontSize: '0.65rem', bgcolor: `${successColor}20`, color: successColor, fontWeight: 600 }} />
                                </Typography>
                                <Typography variant="caption" sx={{ color: textSecondary, fontSize: '0.75rem' }}>{expandCitations ? '▲' : '▼'}</Typography>
                              </Box>
                              {expandCitations && (
                                <Box sx={{ 
                                  p: 1.5, 
                                  maxHeight: 400, 
                                  overflow: 'auto',
                                  '&::-webkit-scrollbar': { width: '6px' },
                                  '&::-webkit-scrollbar-track': { background: 'rgba(255,255,255,0.05)' },
                                  '&::-webkit-scrollbar-thumb': { background: successColor, borderRadius: '3px' }
                                }}>
                                  {parsedAnswer.chunks.map((chunk, idx) => (
                                    <Box key={idx} sx={{ mb: 1, pb: 1, borderBottom: idx < parsedAnswer.chunks.length - 1 ? `1px solid ${borderColor}` : 'none' }}>
                                      <Typography variant="caption" sx={{ color: successColor, fontWeight: 700, display: 'block', mb: 0.3, fontSize: '0.75rem' }}>
                                        [{chunk.chunk_id}] {chunk.metadata?.filename || 'Document'}
                                      </Typography>
                                      <Typography variant="caption" sx={{ color: textSecondary, fontSize: '0.7rem', display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                        {chunk.content}
                                      </Typography>
                                    </Box>
                                  ))}
                                </Box>
                              )}
                            </Box>
                          )}
                        </Box>
                      </Box>
                    </Fade>
                  )}

                  {/* Fallback for old format */}
                  {typingText && !parsedAnswer && (
                    <Fade in timeout={500}>
                      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                          <Typography variant="caption" sx={{ color: successColor, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <CheckCircleIcon sx={{ fontSize: 14 }} />
                            Answer
                          </Typography>
                          <Button
                            size="small"
                            onClick={() => {
                              navigator.clipboard.writeText(typingText);
                              setCopied(true);
                              setTimeout(() => setCopied(false), 2000);
                            }}
                            sx={{
                              minWidth: 'auto',
                              px: 1,
                              py: 0.5,
                              fontSize: '0.7rem',
                              color: copied ? successColor : textSecondary,
                              border: `1px solid ${copied ? successColor : borderColor}`,
                              borderRadius: 1,
                              textTransform: 'none'
                            }}
                          >
                            {copied ? '✓ Copied!' : '📋 Copy'}
                          </Button>
                        </Box>
                        <Paper elevation={4} sx={{ flex: 1, p: 2.5, bgcolor: `${bgColor}80`, border: `2px solid ${warningColor}40`, borderRadius: 2, overflow: 'auto', minHeight: 0 }}>
                          <Typography variant="body2" sx={{ color: textPrimary, fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                            {typingText}
                          </Typography>
                        </Paper>
                      </Box>
                    </Fade>
                  )}
                </Box>
              </Paper>
            </Grow>
          )}
        </Box>

        {/* Compelling Footer CTA */}
        <Box sx={{ 
          textAlign: 'center', 
          py: 1.5, 
          borderTop: `1px solid ${borderColor}`,
          background: `linear-gradient(180deg, transparent 0%, ${borderColor}15 100%)`
        }}>
          <Typography 
            variant="body1" 
            fontWeight={700}
            sx={{ 
              color: textPrimary,
              background: `linear-gradient(135deg, ${accentColor} 0%, ${warningColor} 100%)`,
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            🚀 Foundation Models • LLM Fine-tuning • RLHF • Trillion-Token Scale
          </Typography>
        </Box>
      </Container>
    </Box>
  );
}

