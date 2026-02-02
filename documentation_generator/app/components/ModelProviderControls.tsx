"use client";

import React, { useState, type Dispatch, type SetStateAction } from "react";
import type { FC } from "react";

type Props = {
  provider: "cloud" | "local";
  setProvider: (p: "cloud" | "local") => void;
  models: string[];
  selectedModel: string;
  setSelectedModel: (m: string) => void;
  modelsLoading: boolean;
  modelsError: boolean;
  localModels: string[];
  localModel: string;
  setLocalModel: (m: string) => void;
  localModelsLoading: boolean;
  localModelsError: string | null;
  useCustomLocalModel: boolean;
  setUseCustomLocalModel: (b: boolean) => void;
  fetchLocalModels: () => void;
  showAdvanced: boolean;
  setShowAdvanced: Dispatch<SetStateAction<boolean>>;
};

const ModelProviderControls: FC<Props> = ({
  provider,
  setProvider,
  models,
  selectedModel,
  setSelectedModel,
  modelsLoading,
  modelsError,
  localModels,
  localModel,
  setLocalModel,
  localModelsLoading,
  localModelsError,
  useCustomLocalModel,
  setUseCustomLocalModel,
  fetchLocalModels,
  showAdvanced,
  setShowAdvanced,
}) => {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <button
        type="button"
        aria-expanded={showAdvanced}
        onClick={() => setShowAdvanced((v) => !v)}
        style={{
          border: "1px solid #ddd",
          background: "#fff",
          padding: "8px 10px",
          borderRadius: 10,
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontWeight: 600,
        }}
      >
        Advanced options
        <span style={{ fontSize: 12, color: "#555" }}>{showAdvanced ? "▲" : `Provider: ${provider === "cloud" ? "Cloud" : "Local"}`}</span>
      </button>

      {showAdvanced && (
        <div style={{ display: "grid", gap: 10, paddingTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label htmlFor="provider-select" style={{ fontWeight: 600 }}>
              Provider
            </label>
            <select
              id="provider-select"
              value={provider}
              onChange={(e) => setProvider(e.target.value === "local" ? "local" : "cloud")}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", minWidth: 200, background: "#fff" }}
            >
              <option value="cloud">Cloud (OpenAI API)</option>
              <option value="local">Local (Ollama API)</option>
            </select>
          </div>

          {provider === "cloud" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label htmlFor="model-select" style={{ fontWeight: 600 }}>
                Model
              </label>
              <select
                id="model-select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={modelsLoading || (!models.length && !selectedModel)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", minWidth: 180, background: "#fff" }}
              >
                {modelsLoading && <option>Loading models...</option>}
                {!modelsLoading && models.map((m) => <option key={m} value={m}>{m}</option>)}
                {!modelsLoading && models.length === 0 && <option value={selectedModel || ""}>{selectedModel || "Default (env)"}</option>}
              </select>
              {modelsError && <span style={{ fontSize: 12, color: "#a00" }}>Model list unavailable. Using default.</span>}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label htmlFor="local-model-select" style={{ fontWeight: 600 }}>Local model</label>
                <select
                  id="local-model-select"
                  value={useCustomLocalModel ? "custom" : localModel}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "custom") setUseCustomLocalModel(true);
                    else {
                      setUseCustomLocalModel(false);
                      setLocalModel(val);
                    }
                  }}
                  disabled={localModelsLoading}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", minWidth: 200, background: "#fff" }}
                >
                  {localModelsLoading && <option>Loading local models...</option>}
                  {!localModelsLoading && localModels.map((m) => <option key={m} value={m}>{m}</option>)}
                  <option value="custom">Custom model...</option>
                </select>
                <button type="button" onClick={() => fetchLocalModels()} aria-label="Refresh local models" style={{ border: "1px solid #ddd", background: "#fff", padding: "6px 8px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>⟳</button>
              </div>

              {localModelsError && <span style={{ fontSize: 12, color: "#a00" }}>{localModelsError}</span>}

              {useCustomLocalModel && (
                <input id="local-model" value={localModel} onChange={(e) => setLocalModel(e.target.value)} placeholder="llama3.1:8b" style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", minWidth: 180, background: "#fff" }} />
              )}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px solid #e0e0e0" }}>
            <div style={{ fontWeight: 600, color: "#0a6b3d" }}>API Key (Secure)</div>
            <div style={{ fontSize: 12, color: "#555" }}>OpenAI API key is stored securely in backend .env file. No browser storage needed.</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px solid #e0e0e0" }}>
            <div style={{ fontWeight: 600, color: "#0a6b3d" }}>RAG Mode (FREE)</div>
            <div style={{ fontSize: 12, color: "#555" }}>Chat uses FREE hybrid search (Sentence-BERT + BM25). No API key needed for chat!</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelProviderControls;
