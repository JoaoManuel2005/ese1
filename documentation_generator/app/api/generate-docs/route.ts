import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import MarkdownIt from "markdown-it";
import { chromium } from "playwright";
import { getRuntimeConfig } from "../../../lib/runtimeConfig";

type IncomingFile = {
  name: string;
  type?: string;
  size?: number;
  text?: string | null;
  truncated?: boolean;
  isText?: boolean;
  error?: string | null;
};

const LINE_HEIGHT = 14;
const FONT_SIZE = 12;
const MAX_WIDTH = 500;

function formatSize(size?: number) {
  if (typeof size !== "number" || Number.isNaN(size)) return "unknown size";
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
}

function sanitizeFilename(name: string) {
  return name.replace(/[^\w.-]/g, "_") || "file";
}

function baseNameForDoc(name: string) {
  const safe = sanitizeFilename(name || "file");
  const lastDot = safe.lastIndexOf(".");
  if (lastDot <= 0) return `${safe}_documentation.pdf`;
  const base = safe.slice(0, lastDot);
  return `${base}_documentation.pdf`;
}

function wrapText(text: string, maxWidth: number, font: any, size: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, size);
    if (width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function markdownToHtml(markdown: string) {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
  
  // Override fence renderer to handle mermaid blocks
  const defaultFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, slf) => {
    const token = tokens[idx];
    const info = token.info ? token.info.trim() : '';
    const langName = info ? info.split(/\s+/g)[0] : '';
    
    if (langName === 'mermaid') {
      // Render mermaid blocks with the class that mermaid.js will pick up
      return `<pre class="mermaid">${token.content}</pre>\n`;
    }
    
    // Use default renderer for other code blocks
    return defaultFence(tokens, idx, options, env, slf);
  };
  
  return md.render(markdown || "");
}

function htmlDocumentTemplate(title: string, timestamp: string, bodyHtml: string) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, theme: 'default' });
  </script>
  <style>
    body { font-family: "Helvetica Neue", Arial, sans-serif; margin: 24px; line-height: 1.55; color: #1d1d1f; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    h2 { font-size: 20px; margin: 18px 0 6px; }
    h3 { font-size: 17px; margin: 14px 0 6px; }
    p { margin: 8px 0; }
    ul, ol { padding-left: 20px; margin: 8px 0; }
    li { margin: 4px 0; }
    code { background: #f6f8fa; padding: 2px 4px; border-radius: 4px; font-family: "SFMono-Regular", Consolas, monospace; }
    pre { background: #f6f8fa; padding: 10px; border-radius: 6px; overflow: auto; }
    .meta { font-size: 12px; color: #666; margin-bottom: 12px; }
    .mermaid { margin: 16px 0; text-align: center; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12px; table-layout: fixed; word-wrap: break-word; }
    th { background: #f0f0f5; font-weight: 600; text-align: left; padding: 7px 10px; border: 1px solid #d0d0d8; }
    td { padding: 6px 10px; border: 1px solid #d0d0d8; vertical-align: top; word-break: break-word; }
    tr:nth-child(even) td { background: #f9f9fb; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta">Generated: ${timestamp}</div>
  ${bodyHtml}
</body>
</html>`;
}

async function htmlToPdf(html: string, browser: import("playwright").Browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.setContent(html, { waitUntil: "networkidle" });

    if (html.includes('class="mermaid"')) {
      await page.waitForTimeout(2000);
    }

    return await page.pdf({
      format: "A4",
      margin: { top: "20mm", bottom: "20mm", left: "16mm", right: "16mm" },
      printBackground: true,
    });
  } finally {
    await page.close();
  }
}

function buildFilePrompt(file: IncomingFile) {
  const name = file?.name || "unnamed";
  const type = file?.type || "unknown type";
  const sizeStr = formatSize(file?.size);

  if (file?.error) {
    return `File: ${name} (${type}, ${sizeStr})\n[Error reading file: ${file.error}]`;
  }

  if (file?.isText && typeof file?.text === "string") {
    const truncNote = file?.truncated ? "\n[Content truncated]" : "";
    return `File: ${name} (${type}, ${sizeStr})\n${file.text}${truncNote}`;
  }

  return `File: ${name} (${type}, ${sizeStr})\n[Content not parsed in prototype]`;
}

export async function POST(req: Request) {
  try {
    const { model, systemPrompt, temperature, files, apiKey: bodyApiKey, endpoint: bodyEndpoint } = await req.json();
    const runtimeConfig = await getRuntimeConfig();
    const apiKey =
      runtimeConfig.openaiApiKey ||
      bodyApiKey ||
      req.headers.get("x-openai-api-key") ||
      process.env.OPENAI_API_KEY;
    const endpoint =
      runtimeConfig.azureOpenAiEndpoint ||
      bodyEndpoint ||
      req.headers.get("x-azure-openai-endpoint") ||
      process.env.AZURE_OPENAI_ENDPOINT;

    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI API key is required. Please add it in Settings." },
        { status: 401 }
      );
    }

    const modelToUse = model || runtimeConfig.model || process.env.OPENAI_MODEL || "gpt-4";
    const tempValue = typeof temperature === "number" ? temperature : 0.7;
    const fileArray: IncomingFile[] = Array.isArray(files) ? files : [];

    const systemMessage = systemPrompt
      ? `You are a documentation generator. Produce clear, structured text for PDFs. ${systemPrompt}`
      : "You are a documentation generator. Produce clear, structured text for PDFs.";

    const outputs = [];
    const errors = [];

    // Launch a single browser for all files instead of one per file
    const browser = await chromium.launch({ headless: true });
    try {
      for (const file of fileArray) {
        const prompt = [
          "Generate documentation for THIS file only.",
          "Use only the provided content/metadata.",
          "Output markdown with clear headings: Title, Overview, Key Entities, Assumptions, Summary.",
          buildFilePrompt(file),
          "Include overview, key entities, assumptions, and a concise summary.",
        ].join("\n\n");

        const baseUrl = endpoint ? endpoint.replace(/\/$/, "") : "https://api.openai.com/v1";
        const completionsUrl = baseUrl.endsWith("/chat/completions")
          ? baseUrl
          : `${baseUrl}/chat/completions`;
        const openaiRes = await fetch(completionsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelToUse,
            messages: [
              { role: "system", content: systemMessage },
              { role: "user", content: prompt },
            ],
            temperature: tempValue,
          }),
        });

        if (!openaiRes.ok) {
          const text = await openaiRes.text();
          errors.push({ file: file?.name, message: text || "OpenAI API request failed" });
          continue;
        }

        const data = await openaiRes.json();
        const markdown = data?.choices?.[0]?.message?.content;
        if (!markdown) {
          errors.push({ file: file?.name, message: "Empty response from model" });
          continue;
        }

        const createdAt = new Date().toISOString();
        const title = `Documentation for ${file?.name || "file"}`;
        const bodyHtml = await markdownToHtml(markdown);
        const html = htmlDocumentTemplate(title, createdAt, bodyHtml);
        const pdfBuffer = await htmlToPdf(html, browser);
        const pdfBase64 = pdfBuffer.toString("base64");
        const filename = baseNameForDoc(file?.name || "file");

        outputs.push({
          id: `${filename}-${createdAt}`,
          filename,
          mime: "application/pdf",
          bytesBase64: pdfBase64,
          createdAt,
          htmlPreview: html,
          markdownContent: markdown,
        });
      }
    } finally {
      await browser.close();
    }

    if (outputs.length === 0 && errors.length > 0) {
      return NextResponse.json({ error: "Failed to generate outputs", errors }, { status: 500 });
    }

    return NextResponse.json({ outputs, errors });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Failed to generate documentation" },
      { status: 500 }
    );
  }
}
