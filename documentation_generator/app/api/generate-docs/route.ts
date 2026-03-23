import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { chromium } from "playwright";
import { getRuntimeConfig } from "../../../lib/runtimeConfig";
import { renderMarkdownDocument } from "../../../lib/markdown/rendering";

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
        { error: "OpenAI API key is required. Configure a valid server-side key." },
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
        const renderedDocument = renderMarkdownDocument(markdown, {
          title,
          timestamp: createdAt,
        });
        const pdfBuffer = await htmlToPdf(renderedDocument.pdfHtml, browser);
        const pdfBase64 = pdfBuffer.toString("base64");
        const filename = baseNameForDoc(file?.name || "file");

        outputs.push({
          id: `${filename}-${createdAt}`,
          filename,
          mime: "application/pdf",
          bytesBase64: pdfBase64,
          createdAt,
          htmlPreview: renderedDocument.previewHtml,
          markdownContent: renderedDocument.normalizedMarkdown,
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
