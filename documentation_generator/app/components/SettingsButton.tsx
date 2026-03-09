"use client";

import React, { useState, useEffect, useRef } from "react";
import type { FC } from "react";
import { PublicClientApplication } from "@azure/msal-browser";

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
  apiKey: string;
  setApiKey: (k: string) => void;
  endpoint: string;
  setEndpoint: (e: string) => void;
  sharePointToken: string | null;
  setSharePointToken: (token: string | null) => void;
};

const SettingsButton: FC<Props> = ({
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
  apiKey,
  setApiKey,
  endpoint,
  setEndpoint,
  sharePointToken,
  setSharePointToken,
}) => {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    try {
      const saved = localStorage.getItem("ui-theme");
      if (saved === "dark" || saved === "light") return saved as "light" | "dark";
    } catch {
      /* ignore */
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState<string | null>(null);
  const [connectingSharePoint, setConnectingSharePoint] = useState(false);
  const [sharePointError, setSharePointError] = useState<string | null>(null);
  const [sharePointUserEmail, setSharePointUserEmail] = useState<string | null>(null);
  const [sharePointAuthClientId, setSharePointAuthClientId] = useState<string | null>(null);
  const [sharePointAuthAuthority, setSharePointAuthAuthority] = useState("https://login.microsoftonline.com/organizations");
  const sharePointPopupInFlightRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("ui-theme", theme);
    } catch {}

    if (theme === "dark") {
      document.documentElement.style.setProperty("--background", "#0a0a0a");
      document.documentElement.style.setProperty("--foreground", "#ffffff");
      document.documentElement.style.setProperty("--border", "#333");
      document.documentElement.style.setProperty("--input-bg", "#111");
      document.documentElement.style.setProperty("--panel-bg", "#0f0f0f");
      document.documentElement.style.setProperty("--panel-bg-selected", "#1a2744");
      document.documentElement.style.setProperty("--muted", "#bbb");
      document.documentElement.style.setProperty("--danger", "#ff6b6b");
      document.body.style.background = "#0a0a0a";
      document.body.style.color = "#ffffff";
    } else {
      document.documentElement.style.setProperty("--background", "#ffffff");
      document.documentElement.style.setProperty("--foreground", "#000000");
      document.documentElement.style.setProperty("--border", "#e0e0e5");
      document.documentElement.style.setProperty("--input-bg", "#fff");
      document.documentElement.style.setProperty("--panel-bg", "#fff");
      document.documentElement.style.setProperty("--panel-bg-selected", "#f0f6ff");
      document.documentElement.style.setProperty("--muted", "#555");
      document.documentElement.style.setProperty("--danger", "#a00");
      document.body.style.background = "";
      document.body.style.color = "";
    }
  }, [theme]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function loadSettings() {
      setLoadingSettings(true);
      setSaveState("idle");
      setSaveMessage(null);

      try {
        const res = await fetch("/api/settings");
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = await res.json();

        if (cancelled) return;
        if (data?.provider === "cloud" || data?.provider === "local") {
          setProvider(data.provider);
        }
        if (typeof data?.model === "string" && data.model.trim()) {
          setSelectedModel(data.model);
        }
        if (typeof data?.azureOpenAiEndpoint === "string") {
          setEndpoint(data.azureOpenAiEndpoint);
        } else {
          setEndpoint("");
        }

        setApiKey("");
        setApiKeyConfigured(!!data?.openaiApiKeyConfigured);
        setMaskedApiKey(typeof data?.openaiApiKeyMasked === "string" ? data.openaiApiKeyMasked : null);
        setSharePointAuthClientId(
          typeof data?.azureAdClientId === "string" && data.azureAdClientId.trim()
            ? data.azureAdClientId
            : null
        );
        setSharePointAuthAuthority(
          typeof data?.azureAdAuthority === "string" && data.azureAdAuthority.trim()
            ? data.azureAdAuthority
            : "https://login.microsoftonline.com/organizations"
        );
      } catch {
        if (!cancelled) {
          setSaveState("error");
          setSaveMessage("Failed to load settings.");
        }
      } finally {
        if (!cancelled) {
          setLoadingSettings(false);
        }
      }
    }

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [open, setApiKey, setEndpoint, setProvider, setSelectedModel]);

  async function saveSettings() {
    setSaveState("saving");
    setSaveMessage(null);

    const payload: Record<string, any> = {
      provider,
      model: selectedModel || null,
      azureOpenAiEndpoint: endpoint || null,
    };

    if (apiKey.trim()) {
      payload.openaiApiKey = apiKey.trim();
    }

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "Failed to save settings.");
      }

      setSaveState("saved");
      setSaveMessage("Saved");
      setApiKey("");
      setApiKeyConfigured(!!data?.openaiApiKeyConfigured);
      setMaskedApiKey(typeof data?.openaiApiKeyMasked === "string" ? data.openaiApiKeyMasked : null);
      if (typeof data?.azureOpenAiEndpoint === "string") {
        setEndpoint(data.azureOpenAiEndpoint);
      }
      setTimeout(() => setOpen(false), 500);
    } catch (err: any) {
      setSaveState("error");
      setSaveMessage(err?.message || "Failed to save settings.");
    }
  }

  const modalBg = theme === "dark" ? "#0a0a0a" : "#fff";
  const textColor = theme === "dark" ? "#ffffff" : "#000000";
  const borderColor = theme === "dark" ? "#333" : "#ddd";
  const inputBg = theme === "dark" ? "#111" : "#fff";
  const backdrop = theme === "dark" ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.25)";
  const smallText = "var(--muted)";

  function clearSharePointMsalState(clientId?: string | null) {
    if (typeof window === "undefined") return;

    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i += 1) {
        const key = window.sessionStorage.key(i);
        if (!key || !key.startsWith("msal.")) continue;
        if (!clientId || key.includes(clientId) || key.includes("interaction.status")) {
          keysToRemove.push(key);
        }
      }

      for (const key of keysToRemove) {
        window.sessionStorage.removeItem(key);
      }
    } catch {}
  }

  async function handleConnectSharePointAccount() {
    if (connectingSharePoint || sharePointPopupInFlightRef.current) return;

    sharePointPopupInFlightRef.current = true;
    setConnectingSharePoint(true);
    setSharePointError(null);

    let popupTimeoutId: number | null = null;

    try {
      if (!sharePointAuthClientId) {
        throw new Error(
          loadingSettings
            ? "Authentication settings are still loading. Please try again."
            : "Azure AD client ID is not configured for SharePoint sign-in."
        );
      }

      clearSharePointMsalState(sharePointAuthClientId);

      const sharePointPopupRedirectUri = `${window.location.origin}/auth/popup-close.html`;
      const msalConfig = {
        auth: {
          clientId: sharePointAuthClientId,
          authority: sharePointAuthAuthority,
          redirectUri: typeof window !== "undefined" ? window.location.origin : "",
        },
        cache: {
          cacheLocation: "sessionStorage",
          storeAuthStateInCookie: false,
        },
      };

      const msalInstance = new PublicClientApplication(msalConfig as any);
      await msalInstance.initialize();

      const loginRequest = {
        scopes: ["Sites.Read.All", "User.Read"],
        prompt: "select_account" as const,
        // Keep the popup on a static page so the Next app doesn't boot inside it.
        redirectUri: sharePointPopupRedirectUri,
      };

      const popupTimeoutMs = 120000;
      const response = await Promise.race([
        msalInstance.loginPopup(loginRequest),
        new Promise<never>((_, reject) => {
          popupTimeoutId = window.setTimeout(() => {
            reject({
              errorCode: "monitor_window_timeout",
              message: "Sign-in timed out. Close the popup and try again.",
            });
          }, popupTimeoutMs);
        }),
      ]);

      if (response.accessToken) {
        setSharePointToken(response.accessToken);
        const email = response.account?.username || response.account?.name || "Connected";
        setSharePointUserEmail(email);
        try {
          sessionStorage.setItem("sharepoint_access_token", response.accessToken);
          sessionStorage.setItem("sharepoint_user_email", email);
        } catch {}
      } else {
        throw new Error("No access token received");
      }
    } catch (err: any) {
      console.error("SharePoint auth error:", err);
      clearSharePointMsalState(sharePointAuthClientId);

      if (err.errorCode === "user_cancelled") {
        setSharePointError("Login cancelled");
      } else if (err.errorCode === "popup_window_error") {
        setSharePointError("Popup blocked. Please allow popups for this site.");
      } else if (err.errorCode === "monitor_window_timeout") {
        setSharePointError("Sign-in timed out. Close the popup and try again.");
      } else if (err.errorCode === "interaction_in_progress") {
        setSharePointError("A sign-in window is already open. Close it and try again.");
      } else {
        setSharePointError(err.message || "Authentication failed");
      }
    } finally {
      if (popupTimeoutId) {
        window.clearTimeout(popupTimeoutId);
      }
      sharePointPopupInFlightRef.current = false;
      setConnectingSharePoint(false);
    }
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        title="Settings"
        style={{
          border: "1px solid var(--border)",
          background: "var(--input-bg)",
          color: "var(--foreground)",
          padding: "6px 10px",
          borderRadius: 8,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontWeight: 600,
        }}
      >
        ⚙️
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
          onClick={() => setOpen(false)}
        >
          <div style={{ position: "absolute", inset: 0, background: backdrop }} />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 720,
              maxWidth: "95%",
              background: modalBg,
              color: textColor,
              borderRadius: 10,
              padding: 20,
              boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
              border: `1px solid ${borderColor}`,
              zIndex: 10000,
              maxHeight: "85%",
              overflow: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: textColor }}>Settings</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setOpen(false)} style={{ border: `1px solid ${borderColor}`, background: inputBg, color: textColor, padding: "6px 10px", borderRadius: 8, cursor: "pointer" }}>Close</button>
                <button
                  onClick={saveSettings}
                  disabled={saveState === "saving"}
                  style={{ border: `1px solid ${borderColor}`, background: inputBg, color: textColor, padding: "6px 10px", borderRadius: 8, cursor: saveState === "saving" ? "not-allowed" : "pointer" }}
                >
                  {saveState === "saving" ? "Saving..." : "Save"}
                </button>
              </div>
            </div>

            {saveMessage && (
              <div style={{ fontSize: 12, color: saveState === "error" ? "#a00" : smallText }}>
                {saveMessage}
              </div>
            )}

            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label htmlFor="theme-select" style={{ fontWeight: 600 }}>UI Theme</label>
                <select
                  id="theme-select"
                  value={theme}
                  onChange={(e) => {
                    setSaveState("idle");
                    setTheme(e.target.value === "dark" ? "dark" : "light");
                  }}
                  style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${borderColor}`, minWidth: 220, background: inputBg, color: textColor }}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
                <div style={{ fontSize: 12, color: smallText, marginLeft: 8 }}>{theme === "dark" ? "Dark mode" : "Light mode"}</div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label htmlFor="provider-select" style={{ fontWeight: 600, color: textColor }}>Provider</label>
                <select
                  id="provider-select"
                  value={provider}
                  onChange={(e) => {
                    setSaveState("idle");
                    setProvider(e.target.value === "local" ? "local" : "cloud");
                  }}
                  style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${borderColor}`, minWidth: 220, background: inputBg, color: textColor }}
                >
                  <option value="cloud">Cloud (OpenAI API)</option>
                  <option value="local">Local (Ollama API)</option>
                </select>
              </div>

              {provider === "cloud" ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <label htmlFor="model-select" style={{ fontWeight: 600 }}>Model</label>
                  <select
                    id="model-select"
                    value={selectedModel}
                    onChange={(e) => {
                      setSaveState("idle");
                      setSelectedModel(e.target.value);
                    }}
                    disabled={modelsLoading || (!models.length && !selectedModel)}
                    style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${borderColor}`, minWidth: 220, background: inputBg, color: textColor }}
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
                        setSaveState("idle");
                        const val = e.target.value;
                        if (val === "custom") setUseCustomLocalModel(true);
                        else {
                          setUseCustomLocalModel(false);
                          setLocalModel(val);
                        }
                      }}
                      disabled={localModelsLoading}
                      style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${borderColor}`, minWidth: 220, background: inputBg, color: textColor }}
                    >
                      {localModelsLoading && <option>Loading local models...</option>}
                      {!localModelsLoading && localModels.map((m) => <option key={m} value={m}>{m}</option>)}
                      <option value="custom">Custom model...</option>
                    </select>
                    <button type="button" onClick={() => fetchLocalModels()} aria-label="Refresh local models" style={{ border: `1px solid ${borderColor}`, background: inputBg, color: textColor, padding: "6px 8px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>⟳</button>
                  </div>

                  {localModelsError && <span style={{ fontSize: 12, color: "#a00" }}>{localModelsError}</span>}

                  {useCustomLocalModel && (
                    <input
                      id="local-model"
                      value={localModel}
                      onChange={(e) => {
                        setSaveState("idle");
                        setLocalModel(e.target.value);
                      }}
                      placeholder="llama3.1:8b"
                      style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${borderColor}`, minWidth: 220, background: inputBg, color: textColor }}
                    />
                  )}
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${borderColor}` }}>
                <div style={{ fontWeight: 600, color: "#0a6b3d" }}>API Key (Secure)</div>
                <div style={{ fontSize: 12, color: smallText }}>
                  Stored server-side for runtime use. Not stored in browser storage.
                </div>
                <div style={{ fontSize: 12, color: smallText }}>
                  {loadingSettings
                    ? "Loading settings..."
                    : apiKeyConfigured
                    ? `Configured (${maskedApiKey || "****"})`
                    : "Not configured"}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${borderColor}` }}>
                <div style={{ fontWeight: 600, color: "#0a6b3d" }}>RAG Mode (FREE)</div>
                <div style={{ fontSize: 12, color: smallText }}>Chat uses FREE hybrid search (Sentence-BERT + BM25). No API key needed for chat!</div>
              </div>

              {provider === "cloud" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${borderColor}` }}>
                  <div>
                    <label htmlFor="cloud-api-key" style={{ fontWeight: 600 }}>Cloud API Key</label>
                    <input
                      id="cloud-api-key"
                      type="password"
                      value={apiKey}
                      onChange={(e) => {
                        setSaveState("idle");
                        setApiKey(e.target.value);
                      }}
                      placeholder="Enter API key (optional)"
                      style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${borderColor}`, width: "100%", background: inputBg, color: textColor, marginTop: 6 }}
                    />
                  </div>
                  
                  <div>
                    <label htmlFor="cloud-endpoint" style={{ fontWeight: 600 }}>Azure OpenAI Endpoint</label>
                    <input
                      id="cloud-endpoint"
                      type="text"
                      value={endpoint}
                      onChange={(e) => {
                        setSaveState("idle");
                        setEndpoint(e.target.value);
                      }}
                      placeholder="https://...openai.azure.com/openai/v1/ (optional)"
                      style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${borderColor}`, width: "100%", background: inputBg, color: textColor, marginTop: 6 }}
                    />
                  </div>

                  <div style={{ fontSize: 12, color: smallText, background: theme === "dark" ? "#1a1a1a" : "#f8f9fa", padding: 10, borderRadius: 6, border: `1px solid ${borderColor}` }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠️ Rate Limits</div>
                    <div>• <strong>50,000 tokens</strong> per minute</div>
                    <div>• <strong>50 requests</strong> per minute</div>
                  </div>
                </div>
              )}

              {/* SharePoint Authentication Section */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${borderColor}` }}>
                <div style={{ fontWeight: 600, color: "#0078d4" }}>SharePoint Integration</div>
                <div style={{ fontSize: 12, color: smallText }}>
                  Connect your Microsoft account to automatically fetch SharePoint metadata (lists, libraries, columns) when parsing Power Platform solutions.
                </div>

                {sharePointToken ? (
                  <div style={{ background: theme === "dark" ? "#1a2e1a" : "#e8f5e9", border: `1px solid ${theme === "dark" ? "#2d5" : "#4caf50"}`, borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 13, color: theme === "dark" ? "#8ce99a" : "#2e7d32", fontWeight: 600, marginBottom: 4 }}>✓ Connected</div>
                    {sharePointUserEmail && (
                      <div style={{ fontSize: 12, color: smallText }}>Account: {sharePointUserEmail}</div>
                    )}
                    <button
                      onClick={() => {
                        setSharePointToken(null);
                        setSharePointUserEmail(null);
                        setSharePointError(null);
                        try {
                          sessionStorage.removeItem("sharepoint_access_token");
                          sessionStorage.removeItem("sharepoint_user_email");
                        } catch {}
                      }}
                      style={{ marginTop: 8, padding: "6px 12px", border: `1px solid ${borderColor}`, background: inputBg, color: textColor, borderRadius: 6, cursor: "pointer", fontSize: 12 }}
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <div>
                    <button
                      onClick={() => void handleConnectSharePointAccount()}
                      disabled={connectingSharePoint}
                      style={{ padding: "8px 16px", border: `1px solid #0078d4`, background: connectingSharePoint ? "#999" : "#0078d4", color: "#fff", borderRadius: 8, cursor: connectingSharePoint ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13 }}
                    >
                      {connectingSharePoint ? "Connecting..." : "Connect SharePoint Account"}
                    </button>
                    {sharePointError && (
                      <div style={{ marginTop: 8, fontSize: 12, color: "#d32f2f" }}>{sharePointError}</div>
                    )}
                  </div>
                )}

                <div style={{ fontSize: 11, color: smallText, background: theme === "dark" ? "#1a1a1a" : "#f8f9fa", padding: 8, borderRadius: 6 }}>
                  <strong>Privacy:</strong> Token stored in browser session only. Cleared when tab closes. Used only for SharePoint metadata access.
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </>
  );
};

export default SettingsButton;
