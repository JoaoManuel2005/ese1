import { formidable } from 'formidable';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ step: 'method', message: 'Method not allowed' });
  }

  // Support chunking step
  if (req.headers['content-type'] === 'application/json') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    await new Promise(resolve => req.on('end', resolve));
    const data = JSON.parse(body);
    if (data.step === 'chunk' && data.fileName) {
      // Run chunking logic (call Python ingestion script)
      const filePath = path.join(process.cwd(), '..', 'data', data.fileName);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ step: 'chunk', message: 'File not found for chunking.' });
      }
      // Call Python ingestion/ingest.py with filePath
      const result = spawnSync('python3', ['ingestion/ingest.py', filePath], { encoding: 'utf-8' });
      if (result.error) {
        return res.status(500).json({ step: 'chunk', message: 'Chunking failed.', error: result.error.message });
      }
      return res.status(200).json({ step: 'chunk', chunkStatus: result.stdout || 'Chunked!' });
    }
    if (data.step === 'embed' && data.fileName) {
      // Run embedding logic (call Python embedding/embed_chunks.py)
      const result = spawnSync('python3', ['embedding/embed_chunks.py'], { encoding: 'utf-8' });
      if (result.error) {
        return res.status(500).json({ step: 'embed', message: 'Embedding failed.', error: result.error.message });
      }
      return res.status(200).json({ step: 'embed', embedStatus: result.stdout || 'Embedded!', model: data.model });
    }
  }

  // Default: handle file upload (multipart/form-data)
  let parsed;
  try {
    const form = formidable({
      uploadDir: path.join(process.cwd(), '..', 'data'),
      keepExtensions: true,
      maxFileSize: 50 * 1024 * 1024,
    });
    parsed = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });
  } catch (err) {
    return res.status(500).json({ step: 'parse', message: 'File parsing failed', error: err.message });
  }

  let fileObj, model;
  try {
    const { fields, files } = parsed;
    if (!files) {
      return res.status(400).json({ step: 'file', message: 'No file uploaded. Formidable did not receive any files.' });
    }
    // Robust file extraction for formidable v3+
    fileObj = files.file || files[Object.keys(files)[0]];
    if (Array.isArray(fileObj)) fileObj = fileObj[0];
    model = Array.isArray(fields.model) ? fields.model[0] : fields.model;
    if (!fileObj) {
      return res.status(400).json({ step: 'file', message: 'No file uploaded. File object is missing.' });
    }
  } catch (err) {
    return res.status(500).json({ step: 'extract', message: 'Failed to extract file/model', error: err.message });
  }

  // Only copy file to location, no chunking or embedding
  let newPath;
  try {
    newPath = path.join(process.cwd(), '..', 'data', fileObj.originalFilename);
    if (fs.existsSync(newPath)) {
      return res.status(409).json({ step: 'save', message: 'File already exists. Upload aborted.' });
    }
    fs.renameSync(fileObj.filepath, newPath);
  } catch (err) {
    return res.status(500).json({ step: 'save', message: 'File saving failed', error: err.message });
  }

  return res.status(200).json({
    step: 'success',
    message: `File uploaded as ${fileObj.originalFilename}.`,
    file: fileObj.originalFilename
  });
}
