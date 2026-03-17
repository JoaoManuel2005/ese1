"use client";

import React, { useEffect, useState } from "react";
import type { FC } from "react";
import type { OutputFile } from "../types";

type Props = {
  out: OutputFile | null;
  isRefreshing?: boolean;
  pdfRenderError?: string | null;
  onDownload: (o: OutputFile) => void;
  onOpenPdf: () => void;
  onSaveQuickEdit: (outputId: string, markdown: string) => Promise<void> | void;
};

const PreviewPanel: FC<Props> = ({ out, isRefreshing = false, pdfRenderError, onDownload, onOpenPdf, onSaveQuickEdit }) => {
  const [isQuickEditOpen, setIsQuickEditOpen] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const canQuickEdit = !!out && typeof out.markdownContent === "string";
  const savedContent = out?.markdownContent ?? "";
  const hasUnsavedChanges = draftContent !== savedContent;

  useEffect(() => {
    setIsQuickEditOpen(false);
    setDraftContent(savedContent);
    setSaveState("idle");
    setSaveError(null);
  }, [out?.id, savedContent]);

  function resetEditorState() {
    setDraftContent(savedContent);
    setSaveState("idle");
    setSaveError(null);
  }

  function confirmDiscardIfNeeded() {
    if (!hasUnsavedChanges) return true;
    if (typeof window === "undefined") return true;
    return window.confirm("Discard unsaved changes?");
  }

  function openQuickEdit() {
    if (!canQuickEdit) return;
    resetEditorState();
    setIsQuickEditOpen(true);
  }

  function closeQuickEdit() {
    if (saveState === "saving") return;
    if (!confirmDiscardIfNeeded()) return;
    resetEditorState();
    setIsQuickEditOpen(false);
  }

  async function saveQuickEdit() {
    if (!out || !canQuickEdit || saveState === "saving") return;
    setSaveState("saving");
    setSaveError(null);

    try {
      await onSaveQuickEdit(out.id, draftContent);
      setSaveState("idle");
      setIsQuickEditOpen(false);
    } catch (error: unknown) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Failed to save changes.");
    }
  }

  // container uses panel-scroll to ensure it fills available panel space and
  // allows internal scrolling without expanding the parent panel.
  if (!out)
    return (
      <div className="panel-scroll" style={{ padding: 12 }}>
        <div
          style={{
            border: "1px dashed var(--border)",
            borderRadius: 10,
            padding: 12,
            background: "var(--panel-bg)",
            color: "var(--muted)",
            fontSize: 14,
          }}
        >
          Select an output file to preview its contents.
        </div>
      </div>
    );

  return (
    <>
      <div className="panel-scroll" style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, maxHeight: "80vh" }}>
        <div style={{ fontWeight: 600, color: "var(--foreground)" }}>{out.filename}</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Generated at {new Date(out.createdAt).toLocaleString()}</div>
        {isRefreshing && (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Refreshing preview...
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => onDownload(out)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-bg)", color: "var(--foreground)", cursor: "pointer", fontSize: 12 }}>Download</button>
          <button
            onClick={openQuickEdit}
            disabled={!canQuickEdit}
            title={canQuickEdit ? "Edit raw document source" : "Source unavailable for this output"}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--panel-bg)",
              color: "var(--foreground)",
              cursor: canQuickEdit ? "pointer" : "not-allowed",
              fontSize: 12,
              opacity: canQuickEdit ? 1 : 0.6,
            }}
          >
            Quick Edit
          </button>
          <button onClick={() => onOpenPdf()} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-bg)", color: "var(--foreground)", cursor: "pointer", fontSize: 12 }}>Open PDF in new tab</button>
        </div>

        {pdfRenderError && <div style={{ color: "var(--danger)", fontSize: 12 }}>{pdfRenderError}. You can still open the PDF in a new tab.</div>}

        <div
          style={{ border: "1px solid var(--border)", color: "var(--foreground)", borderRadius: 10, padding: 10, background: "var(--panel-bg)", flex: "1 1 auto", minHeight: 0, overflow: "auto" }}
          dangerouslySetInnerHTML={{ __html: out.htmlPreview || "<p>Preview unavailable.</p>" }}
        />
      </div>

      {isQuickEditOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={closeQuickEdit}
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 900,
              maxWidth: "95%",
              maxHeight: "85vh",
              overflow: "auto",
              background: "var(--panel-bg)",
              color: "var(--foreground)",
              borderRadius: 10,
              padding: 20,
              boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
              border: "1px solid var(--border)",
              zIndex: 10000,
              display: "grid",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>Quick Edit</h2>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{out.filename}</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={closeQuickEdit}
                  disabled={saveState === "saving"}
                  style={{ border: "1px solid var(--border)", background: "var(--panel-bg)", color: "var(--foreground)", padding: "6px 10px", borderRadius: 8, cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void saveQuickEdit(); }}
                  disabled={saveState === "saving"}
                  style={{ border: "1px solid var(--border)", background: "var(--panel-bg)", color: "var(--foreground)", padding: "6px 10px", borderRadius: 8, cursor: saveState === "saving" ? "not-allowed" : "pointer" }}
                >
                  {saveState === "saving" ? "Saving..." : "Save"}
                </button>
              </div>
            </div>

            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Editing the raw markdown/source stored for this document.
            </div>

            {saveError && (
              <div style={{ fontSize: 12, color: "var(--danger)" }}>
                {saveError}
              </div>
            )}

            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              disabled={saveState === "saving"}
              rows={20}
              spellCheck={false}
              style={{
                width: "100%",
                minHeight: 360,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--panel-bg)",
                color: "var(--foreground)",
                resize: "vertical",
                fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                lineHeight: 1.5,
                boxSizing: "border-box",
                opacity: saveState === "saving" ? 0.85 : 1,
              }}
            />
          </div>
        </div>
      )}
    </>
  );
};

export default PreviewPanel;
