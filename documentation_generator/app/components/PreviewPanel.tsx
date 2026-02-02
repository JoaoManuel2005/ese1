"use client";

import React from "react";
import type { FC } from "react";
import type { OutputFile } from "../types";

type Props = {
  out: OutputFile | null;
  previewBlobUrl?: string | null;
  pdfRenderError?: string | null;
  onDownload: (o: OutputFile) => void;
  onOpenPdf: () => void;
};

const PreviewPanel: FC<Props> = ({ out, previewBlobUrl, pdfRenderError, onDownload, onOpenPdf }) => {
  if (!out) return <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 12, background: "var(--panel-bg)", color: "var(--muted)", fontSize: 14 }}>Select an output file to preview its contents.</div>;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 600 }}>{out.filename}</div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>Generated at {new Date(out.createdAt).toLocaleString()}</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => onDownload(out)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)", color: "var(--foreground)", cursor: "pointer", fontSize: 12 }}>Download</button>
        <button onClick={() => onOpenPdf()} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)", color: "var(--foreground)", cursor: "pointer", fontSize: 12 }}>Open PDF in new tab</button>
      </div>

      {pdfRenderError && <div style={{ color: "var(--danger)", fontSize: 12 }}>{pdfRenderError}. You can still open the PDF in a new tab.</div>}

      <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--panel-bg)", maxHeight: 500, overflowY: "auto" }} dangerouslySetInnerHTML={{ __html: out.htmlPreview || "<p>Preview unavailable.</p>" }} />
    </div>
  );
};

export default PreviewPanel;