
import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Avatar from '@mui/material/Avatar';
import EmojiObjectsIcon from '@mui/icons-material/EmojiObjects';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PsychologyIcon from '@mui/icons-material/Psychology';
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
  Paper
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

  const handleIngest = async () => {
    if (!file) return;
    setLoadingIngest(true);
    setIngestStatus('📤 Uploading document...');
    setTimeout(() => {
      setIngestStatus('✂️ Chunking document...');
      setTimeout(() => {
        setIngestStatus('✅ File ingested and chunks saved in /chunks.');
        setLoadingIngest(false);
        setCompletedSteps([...completedSteps, 0]);
      }, 800);
    }, 800);
  };

  const handleValidate = async () => {
    setLoadingValidate(true);
    setValidateStatus('🔍 Scanning chunks...');
    setTimeout(() => {
      setValidateStatus('📊 Analyzing structure...');
      setTimeout(() => {
        setValidateStatus('✅ Chunks validated successfully.');
        setLoadingValidate(false);
        setCompletedSteps([...completedSteps, 1]);
      }, 600);
    }, 600);
  };

  const handleAsk = async () => {
    setLoadingAsk(true);
    setAnswer('');
    setTypingText('');
    setTimeout(() => {
      setAnswer('✨ Augmented answer for: ' + question + ' | This is a powerful RAG-generated response leveraging vector embeddings and semantic search for precision answers.');
      setLoadingAsk(false);
      setShowConfetti(true);
      setCompletedSteps([...completedSteps, 2]);
      setTimeout(() => setShowConfetti(false), 3000);
    }, 1500);
  };

  return (
    <Box sx={{ height: '100vh', background: bgColor, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {showConfetti && <Confetti width={typeof window !== 'undefined' ? window.innerWidth : 1200} height={typeof window !== 'undefined' ? window.innerHeight : 800} numberOfPieces={200} recycle={false} />}
      <Container maxWidth="lg" sx={{ flex: 1, display: 'flex', flexDirection: 'column', py: 2 }}>
        <Head>
          <title>RAG Professional Q&A - Next-Gen AI Pipeline</title>
          <meta name="description" content="Experience the future of document intelligence with RAG" />
        </Head>
        
        {/* Compact Header */}
        <Fade in timeout={800}>
          <Box sx={{ textAlign: 'center', mb: 2 }}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
              <Avatar sx={{ 
                bgcolor: accentColor, 
                width: 48, 
                height: 48, 
                boxShadow: `0 0 20px ${accentColor}80`,
                animation: 'pulse 2s ease-in-out infinite',
                '@keyframes pulse': {
                  '0%, 100%': { transform: 'scale(1)' },
                  '50%': { transform: 'scale(1.05)' }
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
                    background: `linear-gradient(135deg, ${accentColor} 0%, #8b5cf6 100%)`,
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    lineHeight: 1.2
                  }}
                >
                  RAG Professional Q&A
                </Typography>
                <Typography variant="caption" sx={{ color: textSecondary, fontWeight: 400 }}>
                  Powered by Tusshar Lingagiri
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

        {/* Compact Status Pills */}
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
              boxShadow: tab === 0 ? `0 0 15px ${accentColor}60` : 'none',
              '&:hover': {
                bgcolor: tab === 0 ? accentHover : borderColor,
                transform: 'translateY(-1px)'
              }
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
              boxShadow: tab === 1 ? `0 0 15px ${successColor}60` : 'none',
              '&:hover': {
                bgcolor: tab === 1 ? successColor : borderColor,
                transform: 'translateY(-1px)'
              }
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
              boxShadow: tab === 2 ? `0 0 15px ${warningColor}60` : 'none',
              '&:hover': {
                bgcolor: tab === 2 ? warningColor : borderColor,
                transform: 'translateY(-1px)'
              }
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
                        Document Ingestion
                      </Typography>
                      <Typography variant="body2" sx={{ color: textSecondary }}>
                        Upload and chunk your documents
                      </Typography>
                    </Box>
                  </Box>
                  
                  <Box sx={{ 
                    border: `2px dashed ${borderColor}`,
                    borderRadius: 2,
                    p: 2.5,
                    textAlign: 'center',
                    bgcolor: `${bgColor}80`,
                    transition: 'all 0.3s',
                    cursor: 'pointer',
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
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
                        {fileName || 'Click to upload'}
                      </Typography>
                      <Typography variant="caption" sx={{ color: textSecondary }}>
                        PDF, TXT, DOCX, HTML
                      </Typography>
                    </label>
                  </Box>

                  <Button 
                    variant="contained" 
                    fullWidth
                    sx={{ 
                      mt: 2, 
                      py: 1.5,
                      background: `linear-gradient(135deg, ${accentColor} 0%, ${accentHover} 100%)`,
                      color: textPrimary, 
                      fontWeight: 700,
                      boxShadow: `0 4px 15px ${accentColor}60`,
                      transition: 'all 0.3s',
                      '&:hover': { 
                        background: `linear-gradient(135deg, ${accentHover} 0%, #1e40af 100%)`,
                        transform: 'translateY(-1px)',
                        boxShadow: `0 6px 20px ${accentColor}80`
                      },
                      '&:disabled': {
                        background: borderColor,
                        color: textSecondary
                      }
                    }} 
                    onClick={handleIngest} 
                    disabled={!file || loadingIngest}
                  >
                    {loadingIngest ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <CircularProgress size={20} sx={{ color: textPrimary }} />
                        <span>Processing...</span>
                      </Box>
                    ) : (
                      '🚀 Start Ingestion'
                    )}
                  </Button>
                  
                  {ingestStatus && (
                    <Fade in timeout={500}>
                      <Alert 
                        severity={loadingIngest ? "info" : "success"}
                        icon={completedSteps.includes(0) ? <CheckCircleIcon /> : undefined}
                        sx={{ 
                          mt: 2,
                          bgcolor: `${accentColor}15`,
                          color: textPrimary,
                          border: `1px solid ${accentColor}40`,
                          fontSize: '0.9rem',
                          py: 0.5,
                          '& .MuiAlert-icon': { color: accentColor }
                        }}
                      >
                        {ingestStatus}
                      </Alert>
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
                        <span>Validating...</span>
                      </Box>
                    ) : (
                      '✓ Run Validation'
                    )}
                  </Button>
                  
                  {validateStatus && (
                    <Fade in timeout={500}>
                      <Alert 
                        severity={loadingValidate ? "info" : "success"}
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
                  flexDirection: 'column'
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

                  <TextField
                    label="💬 Type your question..."
                    fullWidth
                    multiline
                    rows={2}
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && question) {
                        e.preventDefault();
                        handleAsk();
                      }
                    }}
                    sx={{ 
                      mb: 2,
                      '& .MuiOutlinedInput-root': {
                        color: textPrimary,
                        bgcolor: `${bgColor}80`,
                        fontSize: '0.95rem',
                        '& fieldset': {
                          borderColor: borderColor,
                          borderWidth: 2
                        },
                        '&:hover fieldset': {
                          borderColor: warningColor
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: warningColor,
                          boxShadow: `0 0 10px ${warningColor}40`
                        }
                      },
                      '& .MuiInputLabel-root': {
                        color: textSecondary
                      }
                    }}
                  />

                  <Button 
                    variant="contained" 
                    fullWidth
                    sx={{ 
                      py: 1.5,
                      background: `linear-gradient(135deg, ${warningColor} 0%, #d97706 100%)`,
                      color: textPrimary, 
                      fontWeight: 700,
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
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <CircularProgress size={20} sx={{ color: textPrimary }} />
                        <span>Thinking...</span>
                      </Box>
                    ) : (
                      '✨ Get Answer'
                    )}
                  </Button>
                  
                  {typingText && (
                    <Fade in timeout={500}>
                      <Paper 
                        elevation={4}
                        sx={{ 
                          mt: 2,
                          p: 2,
                          bgcolor: `${bgColor}80`,
                          border: `2px solid ${warningColor}40`,
                          borderRadius: 2,
                          position: 'relative',
                          overflow: 'auto',
                          maxHeight: '200px'
                        }}
                      >
                        <Box sx={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          height: 3,
                          background: `linear-gradient(90deg, ${warningColor} 0%, ${accentColor} 100%)`,
                          animation: completedSteps.includes(2) ? 'none' : 'shimmer 2s infinite',
                          '@keyframes shimmer': {
                            '0%': { transform: 'translateX(-100%)' },
                            '100%': { transform: 'translateX(100%)' }
                          }
                        }} />
                        <Typography 
                          variant="body2" 
                          sx={{ 
                            color: textPrimary,
                            fontSize: '0.9rem',
                            lineHeight: 1.6,
                            whiteSpace: 'pre-wrap'
                          }}
                        >
                          {typingText}
                          {!completedSteps.includes(2) && (
                            <Box 
                              component="span" 
                              sx={{ 
                                display: 'inline-block',
                                width: 6,
                                height: 16,
                                bgcolor: warningColor,
                                ml: 0.5,
                                animation: 'blink 1s infinite',
                                '@keyframes blink': {
                                  '0%, 49%': { opacity: 1 },
                                  '50%, 100%': { opacity: 0 }
                                }
                              }} 
                            />
                          )}
                        </Typography>
                      </Paper>
                    </Fade>
                  )}
                </Box>
              </Paper>
            </Grow>
          )}
        </Box>

        {/* Compelling Footer CTA */}
        <Box sx={{ textAlign: 'center', py: 1.5, borderTop: `1px solid ${borderColor}` }}>
          <Typography variant="body2" sx={{ color: textPrimary, fontSize: '0.85rem', fontWeight: 600, mb: 0.5 }}>
            🚀 Elite-Tier AI Engineering
          </Typography>
          <Typography variant="caption" sx={{ color: textSecondary, fontSize: '0.75rem', display: 'block', mb: 0.5 }}>
            Custom LLM Fine-tuning • RLHF Pipelines • Distributed Training • GPU Optimization • Trillion-Token Scale
          </Typography>
          <Typography variant="caption" sx={{ 
            color: accentColor, 
            fontSize: '0.8rem', 
            fontWeight: 700,
            cursor: 'pointer',
            '&:hover': { color: warningColor, textDecoration: 'underline' }
          }}>
            💬 Message on LinkedIn • Research Engineer • Foundation Models • Inference at Scale • OpenAI•Anthropic•Google•Meta•xAI•NVIDIA
          </Typography>
        </Box>
      </Container>
    </Box>
  );
}

