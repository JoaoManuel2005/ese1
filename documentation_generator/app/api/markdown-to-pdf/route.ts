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
    mermaid.initialize({ 
      startOnLoad: true, 
      theme: 'default',
      securityLevel: 'loose',
      flowchart: { useMaxWidth: true, htmlLabels: true },
      er: {
        useMaxWidth: true,
        layoutDirection: 'TB',
        minEntityWidth: 120,
        minEntityHeight: 75,
        entityPadding: 15,
        stroke: '#333',
        fill: '#ececff'
      }
    });
    // After Mermaid renders, force all SVGs to fill their container width
    mermaid.run().then(() => {
      document.querySelectorAll('.mermaid svg').forEach(svg => {
        svg.setAttribute('width', '100%');
        svg.removeAttribute('height');
        svg.style.width = '100%';
        svg.style.height = 'auto';
        svg.style.display = 'block';
      });
    });
  </script>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    body { font-family: "Helvetica Neue", Arial, sans-serif; margin: 0; padding: 8px; line-height: 1.55; color: #1d1d1f; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    h2 { font-size: 20px; margin: 18px 0 6px; page-break-after: avoid; }
    h3 { font-size: 17px; margin: 14px 0 6px; page-break-after: avoid; }
    p { margin: 8px 0; }
    ul, ol { padding-left: 20px; margin: 8px 0; }
    li { margin: 4px 0; }
    code { background: #f6f8fa; padding: 2px 4px; border-radius: 4px; font-family: "SFMono-Regular", Consolas, monospace; }
    pre { background: #f6f8fa; padding: 10px; border-radius: 6px; overflow: auto; }
    pre.mermaid { background: transparent; padding: 0; }
    .meta { font-size: 12px; color: #666; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12px; table-layout: fixed; word-wrap: break-word; }
    th { background: #f0f0f5; font-weight: 600; text-align: left; padding: 7px 10px; border: 1px solid #d0d0d8; }
    td { padding: 6px 10px; border: 1px solid #d0d0d8; vertical-align: top; word-break: break-word; }
    tr:nth-child(even) td { background: #f9f9fb; }
    /* Each mermaid diagram gets its own full landscape page */
    .mermaid {
      display: block;
      width: 100%;
      page-break-before: always;
      page-break-after: always;
      page-break-inside: avoid;
      min-height: 170mm;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .mermaid svg {
      display: block;
      width: 100% !important;
      height: auto !important;
      max-width: none !important;
      max-height: 190mm !important;
    }
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

async function htmlToPdf(html: string, hasMermaid: boolean) {
  const browser = await chromium.launch({ headless: true });
  try {
    // Use landscape A4 viewport: 297mm x 210mm at 150dpi = 1754 x 1240
    const page = await browser.newPage({ viewport: { width: 1754, height: 1240 } });
    await page.setContent(html, { waitUntil: "networkidle" });

    // Only wait for Mermaid rendering when diagrams are actually present
    if (hasMermaid) {
      await page.waitForTimeout(5000);

      // Force all SVGs to fill their container
      await page.evaluate(() => {
        document.querySelectorAll('.mermaid svg').forEach((svg: any) => {
          svg.setAttribute('width', '100%');
          svg.removeAttribute('height');
          svg.style.width = '100%';
          svg.style.height = 'auto';
          svg.style.maxHeight = '190mm';
        });
      });
    }

    const pdfBuffer = await page.pdf({
      format: "A4",
      landscape: true,
      margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
      printBackground: true,
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

export async function POST(req: Request) {
  try {
    const { markdown, title, metadata } = await req.json();
    
    if (typeof markdown !== "string") {
      return NextResponse.json(
        { error: "Markdown content is required" },
        { status: 400 }
      );
    }
    
    const html = await markdownToHtml(markdown, title || "Documentation", metadata);
    const hasMermaid = typeof markdown === "string" && markdown.includes("```mermaid");
    const pdfBuffer = await htmlToPdf(html, hasMermaid);
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
