import { NextResponse } from "next/server";
import { chromium } from "playwright";
import { renderMarkdownDocument } from "../../../lib/markdown/rendering";

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
    
    const renderedDocument = renderMarkdownDocument(markdown, {
      title: title || "Documentation",
      metadata,
    });
    const hasMermaid = renderedDocument.normalizedMarkdown.includes("```mermaid");
    const pdfBuffer = await htmlToPdf(renderedDocument.pdfHtml, hasMermaid);
    const pdfBase64 = pdfBuffer.toString("base64");
    
    return NextResponse.json({
      pdfBase64,
      html: renderedDocument.previewHtml,
      normalizedMarkdown: renderedDocument.normalizedMarkdown,
    });
  } catch (error: any) {
    console.error("Markdown to PDF error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to convert markdown to PDF" },
      { status: 500 }
    );
  }
}
