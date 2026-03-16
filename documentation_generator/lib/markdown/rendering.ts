import MarkdownIt from "markdown-it";
import { normalizeMarkdownWhitespace } from "./normalization";

type RenderMarkdownDocumentOptions = {
  title: string;
  metadata?: string;
  timestamp?: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createMarkdownRenderer() {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
  const defaultFence = md.renderer.rules.fence!;

  md.renderer.rules.fence = (tokens, idx, options, env, slf) => {
    const token = tokens[idx];
    const info = token.info ? token.info.trim() : "";
    const langName = info ? info.split(/\s+/g)[0] : "";

    if (langName === "mermaid") {
      return `<pre class="mermaid">${token.content}</pre>\n`;
    }

    return defaultFence(tokens, idx, options, env, slf);
  };

  return md;
}

function buildPreviewHtml({
  title,
  metadata,
  timestamp,
  bodyHtml,
}: {
  title: string;
  metadata?: string;
  timestamp: string;
  bodyHtml: string;
}) {
  const safeTitle = escapeHtml(title);
  const safeMetadata = metadata ? escapeHtml(metadata) : "";
  const safeTimestamp = escapeHtml(timestamp);

  return `
    <div class="rendered-markdown preview-markdown">
      <h1 class="doc-title">${safeTitle}</h1>
      ${safeMetadata ? `<div class="doc-meta">${safeMetadata}</div>` : ""}
      <div class="doc-meta">Generated: ${safeTimestamp}</div>
      ${bodyHtml}
    </div>
  `.trim();
}

function buildPdfHtmlDocument({
  title,
  metadata,
  timestamp,
  bodyHtml,
}: {
  title: string;
  metadata?: string;
  timestamp: string;
  bodyHtml: string;
}) {
  const safeTitle = escapeHtml(title);
  const safeMetadata = metadata ? escapeHtml(metadata) : "";
  const safeTimestamp = escapeHtml(timestamp);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    mermaid.initialize({
      startOnLoad: true,
      theme: "default",
      securityLevel: "loose",
      flowchart: { useMaxWidth: true, htmlLabels: true },
      er: {
        useMaxWidth: true,
        layoutDirection: "TB",
        minEntityWidth: 120,
        minEntityHeight: 75,
        entityPadding: 15,
        stroke: "#333",
        fill: "#ececff"
      }
    });
    mermaid.run().then(() => {
      document.querySelectorAll(".mermaid svg").forEach((svg) => {
        svg.setAttribute("width", "100%");
        svg.removeAttribute("height");
        svg.style.width = "100%";
        svg.style.height = "auto";
        svg.style.display = "block";
      });
    });
  </script>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    body {
      font-family: "Helvetica Neue", Arial, sans-serif;
      margin: 0;
      padding: 8px;
      background: #ffffff;
      color: #1d1d1f;
    }
    .pdf-markdown {
      color: #1d1d1f;
      line-height: 1.55;
    }
    .pdf-markdown h1 { font-size: 24px; margin: 0 0 8px; }
    .pdf-markdown h2 { font-size: 20px; margin: 18px 0 6px; page-break-after: avoid; }
    .pdf-markdown h3 { font-size: 17px; margin: 14px 0 6px; page-break-after: avoid; }
    .pdf-markdown p { margin: 8px 0; }
    .pdf-markdown ul, .pdf-markdown ol { padding-left: 20px; margin: 8px 0; }
    .pdf-markdown li { margin: 4px 0; }
    .pdf-markdown code {
      background: #f6f8fa;
      padding: 2px 4px;
      border-radius: 4px;
      font-family: "SFMono-Regular", Consolas, monospace;
    }
    .pdf-markdown pre {
      background: #f6f8fa;
      padding: 10px;
      border-radius: 6px;
      overflow: auto;
    }
    .pdf-markdown pre code {
      background: transparent;
      padding: 0;
    }
    .pdf-markdown pre.mermaid { background: transparent; padding: 0; }
    .pdf-markdown .doc-meta { font-size: 12px; color: #666; margin-bottom: 12px; }
    .pdf-markdown table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 12px;
      table-layout: fixed;
      word-wrap: break-word;
    }
    .pdf-markdown th {
      background: #f0f0f5;
      font-weight: 600;
      text-align: left;
      padding: 7px 10px;
      border: 1px solid #d0d0d8;
    }
    .pdf-markdown td {
      padding: 6px 10px;
      border: 1px solid #d0d0d8;
      vertical-align: top;
      word-break: break-word;
    }
    .pdf-markdown tr:nth-child(even) td { background: #f9f9fb; }
    .pdf-markdown .mermaid {
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
    .pdf-markdown .mermaid svg {
      display: block;
      width: 100% !important;
      height: auto !important;
      max-width: none !important;
      max-height: 190mm !important;
    }
  </style>
</head>
<body>
  <div class="pdf-markdown">
    <h1>${safeTitle}</h1>
    ${safeMetadata ? `<div class="doc-meta">${safeMetadata}</div>` : ""}
    <div class="doc-meta">Generated: ${safeTimestamp}</div>
    ${bodyHtml}
  </div>
</body>
</html>`;
}

export function renderMarkdownDocument(
  markdown: string,
  options: RenderMarkdownDocumentOptions
) {
  const normalizedMarkdown = normalizeMarkdownWhitespace(markdown, { context: "document" });
  const renderer = createMarkdownRenderer();
  const bodyHtml = renderer.render(normalizedMarkdown || "");
  const timestamp = options.timestamp ?? new Date().toLocaleString();

  return {
    normalizedMarkdown,
    bodyHtml,
    previewHtml: buildPreviewHtml({
      title: options.title,
      metadata: options.metadata,
      timestamp,
      bodyHtml,
    }),
    pdfHtml: buildPdfHtmlDocument({
      title: options.title,
      metadata: options.metadata,
      timestamp,
      bodyHtml,
    }),
  };
}
