"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useRef, useState } from "react";

type SolutionComponent = {
  name: string;
  type: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

type ParsedSolution = {
  solution_name: string;
  version: string;
  publisher: string;
  components: SolutionComponent[];
};

export default function SolutionDocsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [parsedSolution, setParsedSolution] = useState<ParsedSolution | null>(null);
  const [documentation, setDocumentation] = useState<string>("");
  const [loading, setLoading] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [backendStatus, setBackendStatus] = useState<string>("checking...");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    // Check backend health on mount
    fetch("/api/rag-health")
      .then((res) => res.json())
      .then((data) => {
        if (data.status === "healthy") {
          setBackendStatus(
            data.pac_cli_available
              ? "✅ Connected (PAC CLI available)"
              : "⚠️ Connected (fallback mode)"
          );
        } else {
          setBackendStatus("❌ Backend not available");
        }
      })
      .catch(() => {
        setBackendStatus("❌ Backend not available");
      });
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setParsedSolution(null);
      setDocumentation("");
      setError("");
    }
  };

  const handleParseSolution = async () => {
    if (!file) {
      setError("Please select a solution file first");
      return;
    }

    setLoading("Parsing solution with PAC CLI...");
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/parse-solution", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to parse solution");
      }

      const result = await response.json();
      setParsedSolution(result);
      setLoading("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse solution");
      setLoading("");
    }
  };

  const handleGenerateDocumentation = async () => {
    if (!parsedSolution) {
      setError("Please parse a solution first");
      return;
    }

    setLoading("Generating documentation with AI...");
    setError("");

    try {
      const response = await fetch("/api/generate-solution-docs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          solution: parsedSolution,
          doc_type: "markdown",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate documentation");
      }

      const result = await response.json();
      setDocumentation(result.documentation);
      setLoading("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate documentation");
      setLoading("");
    }
  };

  const handleDownloadDoc = () => {
    if (!documentation) return;

    const blob = new Blob([documentation], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${parsedSolution?.solution_name || "solution"}-documentation.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const groupComponentsByType = (components: SolutionComponent[]) => {
    return components.reduce((acc, comp) => {
      if (!acc[comp.type]) acc[comp.type] = [];
      acc[comp.type].push(comp);
      return acc;
    }, {} as Record<string, SolutionComponent[]>);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
  };

  return (
    <main
      style={{
        maxWidth: 1400,
        margin: "30px auto",
        fontFamily: "system-ui",
        padding: "0 16px 24px",
        background: "#f7f7fb",
        minHeight: "100vh",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>🔧 Power Platform Solution Docs</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, padding: "6px 12px", background: "#fff", borderRadius: 20, border: "1px solid #e0e0e5" }}>
            {backendStatus}
          </span>
          <a href="/" style={{ fontSize: 13, color: "#1f7aec", textDecoration: "none" }}>
            ← Back to Chat
          </a>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Left Column: Upload & Parse */}
        <div style={{ display: "grid", gap: 16 }}>
          {/* Upload Section */}
          <section style={panelStyle}>
            <div style={panelHeaderStyle}>📁 Upload Solution File</div>
            <div
              className={`dropzone${isDragging ? " dragging" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const droppedFile = e.dataTransfer.files?.[0];
                if (droppedFile?.name.endsWith(".zip")) {
                  setFile(droppedFile);
                  setParsedSolution(null);
                  setDocumentation("");
                  setError("");
                } else {
                  setError("Please upload a .zip solution file");
                }
              }}
              style={{
                border: isDragging ? "2px dashed #1f7aec" : "2px dashed #d0d0d7",
                borderRadius: 12,
                padding: 32,
                textAlign: "center",
                cursor: "pointer",
                background: isDragging ? "#f0f6ff" : "#fafbff",
                transition: "all 0.2s",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
              <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {file ? file.name : "Drop Power Platform solution here"}
              </div>
              <div style={{ fontSize: 13, color: "#555" }}>
                {file ? formatSize(file.size) : "or click to browse (.zip files only)"}
              </div>
            </div>

            <button
              onClick={handleParseSolution}
              disabled={!file || !!loading}
              style={{
                ...buttonStyle,
                background: !file || !!loading ? "#9dc2f7" : "#1f7aec",
                cursor: !file || !!loading ? "not-allowed" : "pointer",
                marginTop: 12,
                width: "100%",
              }}
            >
              🔍 Parse Solution with PAC CLI
            </button>
          </section>

          {/* Parsed Solution Display */}
          {parsedSolution && (
            <section style={panelStyle}>
              <div style={panelHeaderStyle}>📋 Parsed Solution</div>
              
              {/* Solution Info */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div style={infoBoxStyle}>
                  <div style={{ fontSize: 12, color: "#666" }}>Solution Name</div>
                  <div style={{ fontWeight: 600 }}>{parsedSolution.solution_name}</div>
                </div>
                <div style={infoBoxStyle}>
                  <div style={{ fontSize: 12, color: "#666" }}>Version</div>
                  <div style={{ fontWeight: 600 }}>{parsedSolution.version}</div>
                </div>
                <div style={infoBoxStyle}>
                  <div style={{ fontSize: 12, color: "#666" }}>Publisher</div>
                  <div style={{ fontWeight: 600 }}>{parsedSolution.publisher}</div>
                </div>
                <div style={infoBoxStyle}>
                  <div style={{ fontSize: 12, color: "#666" }}>Total Components</div>
                  <div style={{ fontWeight: 600 }}>{parsedSolution.components.length}</div>
                </div>
              </div>

              {/* Components by Type */}
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Components by Type</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 16 }}>
                {Object.entries(groupComponentsByType(parsedSolution.components)).map(
                  ([type, components]) => (
                    <div key={type} style={componentCardStyle}>
                      <div style={{ fontSize: 11, color: "#1f7aec", textTransform: "uppercase", fontWeight: 600 }}>
                        {type}
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{components.length}</div>
                      <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 0", fontSize: 11, color: "#666" }}>
                        {components.slice(0, 3).map((comp, idx) => (
                          <li key={idx} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {comp.name}
                          </li>
                        ))}
                        {components.length > 3 && (
                          <li style={{ color: "#999", fontStyle: "italic" }}>+{components.length - 3} more</li>
                        )}
                      </ul>
                    </div>
                  )
                )}
              </div>

              <button
                onClick={handleGenerateDocumentation}
                disabled={!!loading}
                style={{
                  ...buttonStyle,
                  background: !!loading ? "#9dc2f7" : "#0a6b3d",
                  cursor: !!loading ? "not-allowed" : "pointer",
                  width: "100%",
                }}
              >
                ✨ Generate Documentation with AI
              </button>
            </section>
          )}
        </div>

        {/* Right Column: Output */}
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          {/* Loading & Error */}
          {loading && (
            <div style={{ ...panelStyle, background: "#f0f6ff", borderColor: "#1f7aec" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div className="spinner" style={{ width: 20, height: 20, border: "3px solid #1f7aec", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                <span style={{ fontWeight: 600, color: "#1f7aec" }}>{loading}</span>
              </div>
            </div>
          )}
          
          {error && (
            <div style={{ ...panelStyle, background: "#fff5f5", borderColor: "#e53e3e" }}>
              <div style={{ color: "#c53030", fontWeight: 600 }}>❌ {error}</div>
            </div>
          )}

          {/* Generated Documentation */}
          {documentation && (
            <section style={{ ...panelStyle, maxHeight: "calc(100vh - 200px)", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={panelHeaderStyle}>📄 Generated Documentation</div>
                <button
                  onClick={handleDownloadDoc}
                  style={{
                    ...buttonStyle,
                    background: "#5c2d91",
                    padding: "8px 16px",
                    fontSize: 13,
                  }}
                >
                  ⬇️ Download Markdown
                </button>
              </div>
              <div style={{ 
                flex: 1, 
                overflow: "auto", 
                background: "#fafbff", 
                borderRadius: 8, 
                padding: 16,
                border: "1px solid #e0e0e5",
              }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{documentation}</ReactMarkdown>
              </div>
            </section>
          )}

          {/* Placeholder when no output */}
          {!documentation && !loading && !error && (
            <section style={panelStyle}>
              <div style={panelHeaderStyle}>📄 Documentation Output</div>
              <div style={placeholderBox}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
                <div>Upload and parse a Power Platform solution to generate documentation.</div>
              </div>
            </section>
          )}
        </div>
      </div>

      <style jsx global>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .dropzone:hover {
          border-color: #1f7aec !important;
          background: #f0f6ff !important;
        }
      `}</style>
    </main>
  );
}

const panelStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e0e0e5",
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
};

const panelHeaderStyle: React.CSSProperties = {
  fontWeight: 700,
  marginBottom: 12,
  color: "#222",
  fontSize: 16,
};

const buttonStyle: React.CSSProperties = {
  padding: "12px 20px",
  borderRadius: 10,
  border: "none",
  color: "#fff",
  fontWeight: 600,
  fontSize: 14,
};

const infoBoxStyle: React.CSSProperties = {
  background: "#f7f7fb",
  borderRadius: 8,
  padding: 12,
};

const componentCardStyle: React.CSSProperties = {
  background: "#f7f7fb",
  borderRadius: 8,
  padding: 10,
  border: "1px solid #e0e0e5",
};

const placeholderBox: React.CSSProperties = {
  border: "1px dashed #d0d0d7",
  borderRadius: 10,
  padding: 32,
  background: "#fafbff",
  color: "#6b6b75",
  fontSize: 14,
  textAlign: "center",
};
