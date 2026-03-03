import { NextResponse } from "next/server";
import { chromium } from "playwright";
import MarkdownIt from "markdown-it";

async function markdownToHtml(markdown: string, title: string, metadata?: string) {
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
  
  const bodyHtml = md.render(markdown || "");
  const timestamp = new Date().toLocaleString();
  
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
    pre.mermaid { background: transparent; }
    .meta { font-size: 12px; color: #666; margin-bottom: 12px; }
    .mermaid { margin: 16px 0; text-align: center; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${metadata ? `<div class="meta">${metadata}</div>` : ''}
  <div class="meta">Generated: ${timestamp}</div>
  ${bodyHtml}
</body>
</html>`;
}

async function htmlToPdf(html: string) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(html, { waitUntil: "networkidle" });
  
  // Wait for Mermaid diagrams to render
  await page.waitForTimeout(2000);
  
  const pdfBuffer = await page.pdf({
    format: "A4",
    margin: { top: "20mm", bottom: "20mm", left: "16mm", right: "16mm" },
    printBackground: true,
  });
  await browser.close();
  return pdfBuffer;
}

export async function POST(req: Request) {
  try {
    const { markdown, title, metadata } = await req.json();
    
    if (!markdown) {
      return NextResponse.json(
        { error: "Markdown content is required" },
        { status: 400 }
      );
    }
    
    const html = await markdownToHtml(markdown, title || "Documentation", metadata);
    const pdfBuffer = await htmlToPdf(html);
    const pdfBase64 = pdfBuffer.toString("base64");
    
    return NextResponse.json({
      pdfBase64,
      html,
    });
  } catch (error: any) {
    console.error("Markdown to PDF error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to convert markdown to PDF" },
      { status: 500 }
    );
  }
}
