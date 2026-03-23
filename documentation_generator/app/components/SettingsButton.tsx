"use client";

import React, { useState, useEffect, useRef } from "react";
import type { FC } from "react";
import { PublicClientApplication } from "@azure/msal-browser";
import { SHAREPOINT_CONNECT_REQUEST } from "../auth/authRequests";
import { useOutputTypes } from "../hooks/useOutputTypes";
import {
  buildPromptChoices,
  getPromptChoicesByGroup,
  getPromptSelectionLabel,
  resolvePromptChoiceFromText,
  type PromptChoice,
} from "../utils/promptLibrary";

type SharePointMsalRuntimeConfig = {
  clientId: string;
  authority: string;
  redirectUri: string;
};

let sharedSharePointMsalInstance: PublicClientApplication | null = null;
let sharedSharePointMsalInitPromise: Promise<PublicClientApplication> | null = null;
let sharedSharePointMsalConfigKey: string | null = null;
let sharedSharePointPopupPromise: Promise<unknown> | null = null;

function getSharePointMsalConfigKey(config: SharePointMsalRuntimeConfig): string {
  return [config.clientId, config.authority, config.redirectUri].join("|");
}

async function getSharedSharePointMsalInstance(
  config: SharePointMsalRuntimeConfig
): Promise<PublicClientApplication> {
  const configKey = getSharePointMsalConfigKey(config);
  if (!sharedSharePointMsalInstance || sharedSharePointMsalConfigKey !== configKey) {
    const nextInstance = new PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: config.authority,
        redirectUri: config.redirectUri,
      },
      cache: {
        cacheLocation: "sessionStorage",
        storeAuthStateInCookie: false,
      },
    } as any);

    sharedSharePointMsalInstance = nextInstance;
    sharedSharePointMsalConfigKey = configKey;
    sharedSharePointMsalInitPromise = nextInstance.initialize()
      .then(() => nextInstance)
      .catch((error) => {
        if (sharedSharePointMsalConfigKey === configKey) {
          sharedSharePointMsalInstance = null;
          sharedSharePointMsalInitPromise = null;
          sharedSharePointMsalConfigKey = null;
        }
        throw error;
      });
  }

  if (!sharedSharePointMsalInitPromise || !sharedSharePointMsalInstance) {
    throw new Error("SharePoint authentication is not initialized.");
  }

  return sharedSharePointMsalInitPromise;
}

function isSharePointMsalInteractionInProgress(): boolean {
  return sharedSharePointPopupPromise !== null;
}

type Props = {
  isAuthenticated: boolean;
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
  sharePointToken: string | null;
  setSharePointToken: (token: string | null) => void;
  systemPrompt: string;
  setSystemPrompt: (v: string) => void;
  systemPromptDefault: string;
};

type PromptStatus = {
  kind: "error" | "success" | "info";
  message: string;
} | null;

const SettingsButton: FC<Props> = ({
  isAuthenticated,
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
  sharePointToken,
  setSharePointToken,
  systemPrompt,
  setSystemPrompt,
  systemPromptDefault,
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
  const [promptDialogMode, setPromptDialogMode] = useState<"save" | "load" | null>(null);
  const [promptDialogBusy, setPromptDialogBusy] = useState(false);
  const [promptDialogError, setPromptDialogError] = useState<string | null>(null);
  const [promptStatus, setPromptStatus] = useState<PromptStatus>(null);
  const [promptNameDraft, setPromptNameDraft] = useState("");
  const [pendingPromptText, setPendingPromptText] = useState("");
  const [promptLibraryRefreshKey, setPromptLibraryRefreshKey] = useState(0);
  const [activeSavedPromptId, setActiveSavedPromptId] = useState<string | null>(null);
  const [connectingSharePoint, setConnectingSharePoint] = useState(false);
  const [sharePointError, setSharePointError] = useState<string | null>(null);
  const [sharePointUserEmail, setSharePointUserEmail] = useState<string | null>(null);
  const [sharePointAuthClientId, setSharePointAuthClientId] = useState<string | null>(null);
  const [sharePointAuthAuthority, setSharePointAuthAuthority] = useState("https://login.microsoftonline.com/organizations");
  const [sharePointMsalInteractionInProgress, setSharePointMsalInteractionInProgress] = useState(
    isSharePointMsalInteractionInProgress()
  );
  const sharePointPopupInFlightRef = useRef(false);
  const promptNameInputRef = useRef<HTMLInputElement | null>(null);
  const promptActionRequestIdRef = useRef(0);
  const {
    outputTypes: promptLibrary,
    loading: promptLibraryLoading,
    error: promptLibraryError,
  } = useOutputTypes(promptLibraryRefreshKey);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("ui-theme", theme);
    } catch {}

    // simply toggle a data attribute; all variable values come from globals.css
    document.documentElement.setAttribute("data-theme", theme);

    // we don't need to manually touch individual vars or body styles any more
  }, [theme]);

  useEffect(() => {
    if (promptDialogMode !== "save") return;
    const nextFrame = window.setTimeout(() => {
      promptNameInputRef.current?.focus();
      promptNameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(nextFrame);
  }, [promptDialogMode]);

  useEffect(() => {
    if (!promptDialogMode) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePromptDialog();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [promptDialogMode]);

  useEffect(() => {
    if (!open) {
      closePromptDialog();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function loadSettings() {
      setLoadingSettings(true);
      setSaveState("idle");
      setSaveMessage(null);
      setPromptStatus(null);
      setPromptDialogError(null);

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
        if (typeof data?.systemPrompt === "string" && data.systemPrompt.trim().length > 0) {
          setSystemPrompt(data.systemPrompt);
        } else if (!isAuthenticated && typeof window !== "undefined") {
          try {
            const stored = sessionStorage.getItem("systemPrompt");
            if (stored != null && stored.trim().length > 0) setSystemPrompt(stored);
          } catch { /* ignore */ }
        }
        setActiveSavedPromptId(
          typeof data?.activeSavedPromptId === "string" && data.activeSavedPromptId.trim()
            ? data.activeSavedPromptId
            : null
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
  }, [isAuthenticated, open, setProvider, setSelectedModel, setSystemPrompt]);

  async function saveSettings(
    systemPromptOverride?: string,
    options?: { closeAfterSave?: boolean }
  ) {
    setSaveState("saving");
    setSaveMessage(null);

    const promptToSave = systemPromptOverride !== undefined ? systemPromptOverride : systemPrompt;
    const resolvedSelection = resolvePromptChoiceFromText(promptChoices, promptToSave ?? "", activeSavedPromptId);
    const selectedPromptId =
      isAuthenticated && resolvedSelection?.kind === "custom" && resolvedSelection.promptId
        ? resolvedSelection.promptId
        : null;

    if (typeof window !== "undefined" && !isAuthenticated) {
      try {
        sessionStorage.setItem("systemPrompt", promptToSave ?? "");
      } catch { /* ignore */ }
    }

    const payload: Record<string, unknown> = {
      provider,
      model: selectedModel || null,
    };
    if (selectedPromptId) {
      payload.selectedPromptId = selectedPromptId;
    } else {
      payload.systemPrompt = promptToSave ?? "";
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
      if (data && "systemPrompt" in data) {
        setSystemPrompt(typeof data.systemPrompt === "string" ? data.systemPrompt : "");
      }
      if ("activeSavedPromptId" in data) {
        setActiveSavedPromptId(
          typeof data.activeSavedPromptId === "string" && data.activeSavedPromptId.trim()
            ? data.activeSavedPromptId
            : null
        );
      } else if (!selectedPromptId) {
        setActiveSavedPromptId(null);
      }
      if (systemPromptOverride !== undefined) {
        setSaveMessage(isAuthenticated ? "Restored to default prompt." : "Restored to default prompt. Saved for this browser session.");
      } else if (!isAuthenticated) {
        setSaveMessage("Saved for this browser session.");
      }
      if (options?.closeAfterSave !== false) {
        setTimeout(() => setOpen(false), 400);
      }
    } catch (err: any) {
      setSaveState("error");
      setSaveMessage(err?.message || "Failed to save settings.");
    }
  }

  function closePromptDialog() {
    promptActionRequestIdRef.current += 1;
    setPromptDialogMode(null);
    setPromptDialogBusy(false);
    setPromptDialogError(null);
    setPromptNameDraft("");
    setPendingPromptText("");
  }

  function openSavePromptDialog() {
    const promptText = systemPrompt.trim();
    if (!promptText) {
      setPromptDialogMode(null);
      setPromptDialogError(null);
      setPromptStatus({ kind: "error", message: "Prompt content is required." });
      return;
    }

    setPromptStatus(null);
    setPromptDialogError(null);
    setPromptNameDraft("");
    setPendingPromptText(systemPrompt);
    setPromptDialogMode("save");
  }

  function openLoadPromptDialog() {
    setPromptStatus(null);
    setPromptDialogError(null);
    setPromptDialogBusy(false);
    setPromptDialogMode("load");
  }

  async function handlePromptSelection(choice: PromptChoice) {
    setPromptStatus(null);
    setPromptDialogError(null);
    const requestId = ++promptActionRequestIdRef.current;

    if (choice.group === "default" || choice.kind === "builtin") {
      if (!isAuthenticated) {
        setSystemPrompt(choice.promptText);
        setActiveSavedPromptId(null);
        if (typeof window !== "undefined") {
          try {
            sessionStorage.setItem("systemPrompt", choice.promptText);
          } catch {
            /* ignore */
          }
        }
        setPromptStatus({
          kind: "success",
          message:
            choice.group === "default"
              ? "Restored to default prompt."
              : `${choice.title} loaded.`,
        });
        closePromptDialog();
        return;
      }

      setPromptDialogBusy(true);
      try {
        const res = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            model: selectedModel || null,
            systemPrompt: choice.promptText,
          }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data?.error || "Failed to load prompt.");
        }

        if (requestId !== promptActionRequestIdRef.current) {
          return;
        }

        setSystemPrompt(
          typeof data?.systemPrompt === "string" && data.systemPrompt.trim().length > 0
            ? data.systemPrompt
            : choice.promptText
        );
        setActiveSavedPromptId(null);
        setPromptStatus({
          kind: "success",
          message:
            choice.group === "default"
              ? "Restored to default prompt."
              : `${choice.title} loaded.`,
        });
        closePromptDialog();
      } catch (err: any) {
        if (requestId !== promptActionRequestIdRef.current) {
          return;
        }
        setPromptDialogError(err?.message || "Failed to load prompt.");
      } finally {
        if (requestId === promptActionRequestIdRef.current) {
          setPromptDialogBusy(false);
        }
      }
      return;
    }

    if (!isAuthenticated || !choice.promptId) {
      setPromptDialogError("Sign in to use saved prompts.");
      return;
    }

    setPromptDialogBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedPromptId: choice.promptId }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "Failed to load saved prompt.");
      }

      if (requestId !== promptActionRequestIdRef.current) {
        return;
      }

      if (typeof data?.systemPrompt === "string") {
        setSystemPrompt(data.systemPrompt);
      } else {
        setSystemPrompt(choice.promptText);
      }
      setActiveSavedPromptId(
        typeof data?.activeSavedPromptId === "string" && data.activeSavedPromptId.trim()
          ? data.activeSavedPromptId
          : choice.promptId ?? null
      );
      setPromptLibraryRefreshKey((value) => value + 1);
      setPromptStatus({ kind: "success", message: `${choice.title} loaded.` });
      closePromptDialog();
    } catch (err: any) {
      if (requestId !== promptActionRequestIdRef.current) {
        return;
      }
      setPromptDialogError(err?.message || "Failed to load saved prompt.");
    } finally {
      if (requestId === promptActionRequestIdRef.current) {
        setPromptDialogBusy(false);
      }
    }
  }

  async function deleteSavedPrompt(choice: PromptChoice) {
    if (!choice.promptId) return;

    const confirmed = typeof window === "undefined"
      ? true
      : window.confirm(`Delete saved prompt "${choice.title}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setPromptDialogBusy(true);
    setPromptDialogError(null);
    const requestId = ++promptActionRequestIdRef.current;

    try {
      const res = await fetch(`/api/saved-prompts/${encodeURIComponent(choice.promptId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok && res.status !== 204) {
        throw new Error(data?.error || "Failed to delete saved prompt.");
      }

      if (requestId !== promptActionRequestIdRef.current) {
        return;
      }

      setPromptLibraryRefreshKey((value) => value + 1);
      if (activeSavedPromptId === choice.promptId) {
        setActiveSavedPromptId(null);
      }
      setPromptStatus({ kind: "success", message: `${choice.title} deleted.` });
      closePromptDialog();
    } catch (err: any) {
      if (requestId !== promptActionRequestIdRef.current) {
        return;
      }
      setPromptDialogError(err?.message || "Failed to delete saved prompt.");
    } finally {
      if (requestId === promptActionRequestIdRef.current) {
        setPromptDialogBusy(false);
      }
    }
  }

  async function submitPromptSave() {
    const name = promptNameDraft.trim();
    const promptText = pendingPromptText.trim();
    const requestId = ++promptActionRequestIdRef.current;

    if (!isAuthenticated) {
      setPromptDialogError("Sign in to save named prompts.");
      return;
    }
    if (!name) {
      setPromptDialogError("Prompt name is required.");
      return;
    }
    if (!promptText) {
      setPromptDialogError("Prompt content is required.");
      return;
    }

    const conflictMessage = getPromptNameConflictMessage(name);
    if (conflictMessage) {
      setPromptDialogError(conflictMessage);
      return;
    }

    setPromptDialogBusy(true);
    setPromptDialogError(null);

    try {
      const res = await fetch("/api/saved-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, promptText }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "Failed to save prompt.");
      }

      if (requestId !== promptActionRequestIdRef.current) {
        return;
      }

      setPromptLibraryRefreshKey((value) => value + 1);
      setPromptStatus({ kind: "success", message: "Saved prompt created." });
      closePromptDialog();
    } catch (err: any) {
      if (requestId !== promptActionRequestIdRef.current) {
        return;
      }
      setPromptDialogError(err?.message || "Failed to save prompt.");
    } finally {
      if (requestId === promptActionRequestIdRef.current) {
        setPromptDialogBusy(false);
      }
    }
  }

  const textColor = "var(--foreground)";
  const borderColor = "var(--border)";
  const inputBg = "var(--panel-bg)";
  const backdrop = theme === "dark" ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.25)";
  const smallText = "var(--muted)";
  const sharePointConnected = Boolean(sharePointToken);
  const promptChoices = buildPromptChoices(promptLibrary, systemPromptDefault);
  const { defaultChoice, builtins: builtinPromptChoices, saved: savedPromptChoices } = getPromptChoicesByGroup(promptChoices);
  const activePromptLabel = getPromptSelectionLabel(
    promptChoices,
    systemPrompt,
    activeSavedPromptId,
    promptLibraryLoading
  );

  function normalizePromptNameKey(value: string) {
    return value.trim().toLocaleLowerCase();
  }

  function getPromptNameConflictMessage(name: string) {
    const normalizedName = normalizePromptNameKey(name);
    if (!normalizedName) return null;

    const matchingChoice = promptChoices.find(
      (choice) => normalizePromptNameKey(choice.title) === normalizedName
    );
    if (!matchingChoice) return null;

    if (matchingChoice.group === "default" || matchingChoice.kind === "builtin") {
      return "Prompt name conflicts with a built-in prompt.";
    }

    return `A saved prompt named "${matchingChoice.title}" already exists.`;
  }

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
    if (
      connectingSharePoint ||
      sharePointPopupInFlightRef.current ||
      isSharePointMsalInteractionInProgress()
    ) {
      setSharePointMsalInteractionInProgress(isSharePointMsalInteractionInProgress());
      if (isSharePointMsalInteractionInProgress()) {
        setSharePointError("A sign-in window is already open. Close it and try again.");
      }
      return;
    }

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
      const msalInstance = await getSharedSharePointMsalInstance({
        clientId: sharePointAuthClientId,
        authority: sharePointAuthAuthority,
        redirectUri: typeof window !== "undefined" ? window.location.origin : "",
      });

      const loginRequest = {
        ...SHAREPOINT_CONNECT_REQUEST,
        scopes: [...SHAREPOINT_CONNECT_REQUEST.scopes],
        // Keep the popup on a static page so the Next app doesn't boot inside it.
        redirectUri: sharePointPopupRedirectUri,
      };

      const popupTimeoutMs = 120000;
      const popupPromise = msalInstance.loginPopup(loginRequest);
      sharedSharePointPopupPromise = popupPromise;
      setSharePointMsalInteractionInProgress(true);
      void popupPromise
        .finally(() => {
          if (sharedSharePointPopupPromise === popupPromise) {
            sharedSharePointPopupPromise = null;
          }
          setSharePointMsalInteractionInProgress(false);
        })
        .catch(() => {});

      const response = await Promise.race([
        popupPromise,
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
        aria-label="Settings"
        title="Settings"
        style={{
          border: "1px solid var(--border)",
          background: "var(--panel-bg)",
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
          aria-labelledby="settings-dialog-title"
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
              background: inputBg,
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
              <h2 id="settings-dialog-title" style={{ margin: 0, fontSize: 18, color: textColor }}>Settings</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setOpen(false)} style={{ border: `1px solid ${borderColor}`, background: inputBg, color: textColor, padding: "6px 10px", borderRadius: 8, cursor: "pointer" }}>Close</button>
                <button
                  onClick={() => saveSettings()}
                  disabled={saveState === "saving"}
                  style={{ border: `1px solid ${borderColor}`, background: inputBg, color: textColor, padding: "6px 10px", borderRadius: 8, cursor: saveState === "saving" ? "not-allowed" : "pointer" }}
                >
                  {saveState === "saving" ? "Saving..." : "Save settings"}
                </button>
              </div>
            </div>

            {saveMessage && (
              <div
                style={{ fontSize: 12, color: saveState === "error" ? "var(--danger)" : smallText }}
                aria-live="polite"
              >
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
                <label htmlFor="system-prompt" style={{ fontWeight: 600 }}>System Prompt (Solution Docs)</label>
                <div style={{ fontSize: 12, color: smallText }}>
                  {isAuthenticated
                    ? "Saved to your account. Used when generating solution documentation."
                    : "Saved for this browser session only (clears when tab/session ends)."}
                </div>
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    color: smallText,
                  }}
                >
                  <span style={{ fontWeight: 600, color: textColor }}>Currently active:</span>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      border: `1px solid ${borderColor}`,
                      background: theme === "dark" ? "#1b1b1b" : "#f4f6f8",
                      color: textColor,
                      fontWeight: 600,
                    }}
                  >
                    {activePromptLabel}
                  </span>
                </div>
                <textarea
                  id="system-prompt"
                  value={systemPrompt}
                  onChange={(e) => { setSaveState("idle"); setSystemPrompt(e.target.value); }}
                  rows={6}
                  placeholder="Optional: customise the system instruction for solution doc generation. Leave blank to use the default."
                  style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${borderColor}`, width: "100%", background: inputBg, color: textColor, resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 }}
                />
                <button
                  type="button"
                  onClick={() => {
                    void saveSettings(systemPromptDefault, { closeAfterSave: false });
                  }}
                  disabled={saveState === "saving"}
                  style={{
                    alignSelf: "flex-start",
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: `1px solid ${borderColor}`,
                    background: inputBg,
                    color: textColor,
                    cursor: saveState === "saving" ? "not-allowed" : "pointer",
                    fontSize: 13,
                  }}
                >
                  Restore to default
                </button>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setPromptStatus(null);
                      setPromptDialogError(null);
                      openLoadPromptDialog();
                    }}
                    disabled={loadingSettings}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: `1px solid ${borderColor}`,
                      background: inputBg,
                      color: textColor,
                      cursor: loadingSettings ? "not-allowed" : "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    onClick={() => openSavePromptDialog()}
                    disabled={loadingSettings}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: `1px solid ${borderColor}`,
                      background: inputBg,
                      color: textColor,
                      cursor: loadingSettings ? "not-allowed" : "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    Save
                  </button>
                </div>
                {promptStatus && (
                  <div
                    style={{ fontSize: 12, color: promptStatus.kind === "error" ? "var(--danger)" : smallText }}
                    aria-live="polite"
                  >
                    {promptStatus.message}
                  </div>
                )}
              </div>

              {promptDialogMode && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="prompt-dialog-title"
                  aria-describedby="prompt-dialog-description"
                  onClick={(e) => {
                    e.stopPropagation();
                    closePromptDialog();
                  }}
                  style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 11000,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 16,
                  }}
                >
                  <div style={{ position: "absolute", inset: 0, background: backdrop }} />
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: "relative",
                      zIndex: 11001,
                      width: 560,
                      maxWidth: "100%",
                      background: inputBg,
                      color: textColor,
                      borderRadius: 12,
                      border: `1px solid ${borderColor}`,
                      boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
                      padding: 18,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
                      <h3 id="prompt-dialog-title" style={{ margin: 0, fontSize: 16, color: textColor }}>
                        {promptDialogMode === "save" ? "Save prompt" : "Load prompt"}
                      </h3>
                      <button
                        type="button"
                        onClick={closePromptDialog}
                        aria-label="Close prompt dialog"
                        style={{
                          border: `1px solid ${borderColor}`,
                          background: inputBg,
                          color: textColor,
                          padding: "6px 10px",
                          borderRadius: 8,
                          cursor: "pointer",
                        }}
                      >
                        ×
                      </button>
                    </div>

                    {promptDialogMode === "save" ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void submitPromptSave();
                        }}
                        style={{ display: "grid", gap: 12 }}
                      >
                        <div id="prompt-dialog-description" style={{ fontSize: 12, color: smallText }}>
                          Save the current system prompt so you can load it later.
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                          <label htmlFor="prompt-name-dialog" style={{ fontWeight: 600, fontSize: 13 }}>
                            Prompt name
                          </label>
                          <input
                            ref={promptNameInputRef}
                            id="prompt-name-dialog"
                            value={promptNameDraft}
                            onChange={(e) => {
                              setPromptNameDraft(e.target.value);
                              setPromptDialogError(null);
                            }}
                            placeholder="e.g. Concise release notes"
                            aria-invalid={Boolean(promptDialogError)}
                            aria-describedby={promptDialogError ? "prompt-dialog-error" : undefined}
                            style={{
                              padding: "8px 10px",
                              borderRadius: 8,
                              border: `1px solid ${borderColor}`,
                              width: "100%",
                              background: inputBg,
                              color: textColor,
                            }}
                          />
                        </div>

                        {promptDialogError && (
                          <div id="prompt-dialog-error" style={{ fontSize: 12, color: "var(--danger)" }} aria-live="polite">
                            {promptDialogError}
                          </div>
                        )}

                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                          <button
                            type="button"
                            onClick={closePromptDialog}
                            style={{
                              border: `1px solid ${borderColor}`,
                              background: inputBg,
                              color: textColor,
                              padding: "6px 12px",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={promptDialogBusy}
                            style={{
                              border: `1px solid ${borderColor}`,
                              background: inputBg,
                              color: textColor,
                              padding: "6px 12px",
                              borderRadius: 8,
                              cursor: promptDialogBusy ? "not-allowed" : "pointer",
                              fontWeight: 600,
                            }}
                          >
                            {promptDialogBusy ? "Saving..." : "Save prompt"}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div style={{ display: "grid", gap: 12, maxHeight: "55vh", overflow: "auto" }}>
                        <div id="prompt-dialog-description" style={{ fontSize: 12, color: smallText }}>
                          Choose a prompt to load into the system prompt textbox.
                        </div>

                        {promptLibraryLoading && (
                          <div style={{ fontSize: 12, color: smallText }} aria-live="polite">
                            Loading prompts...
                          </div>
                        )}

                        {!promptLibraryLoading && promptLibraryError && (
                          <div style={{ fontSize: 12, color: "var(--danger)" }} aria-live="polite">
                            {promptLibraryError} Built-in prompts are still available.
                          </div>
                        )}

                        <div style={{ display: "grid", gap: 8 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{defaultChoice?.title ?? "Default prompt"}</div>
                          {defaultChoice && (
                            <button
                              type="button"
                              onClick={() => void handlePromptSelection(defaultChoice)}
                              disabled={promptDialogBusy}
                              aria-label={defaultChoice.title}
                              style={{
                                textAlign: "left",
                                border: `1px solid ${borderColor}`,
                                background: inputBg,
                                color: textColor,
                                borderRadius: 8,
                                padding: "8px 10px",
                                cursor: promptDialogBusy ? "not-allowed" : "pointer",
                              }}
                            >
                              <div style={{ fontWeight: 600 }}>{defaultChoice.title}</div>
                              <div style={{ fontSize: 12, color: smallText }}>{defaultChoice.description}</div>
                            </button>
                          )}
                        </div>

                        <div style={{ display: "grid", gap: 8 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>Built-in prompts</div>
                          <div style={{ display: "grid", gap: 8 }}>
                            {builtinPromptChoices.map((choice) => (
                              <button
                                key={choice.id}
                                type="button"
                                onClick={() => void handlePromptSelection(choice)}
                                disabled={promptDialogBusy}
                                aria-label={choice.title}
                                style={{
                                  textAlign: "left",
                                  border: `1px solid ${borderColor}`,
                                  background: inputBg,
                                  color: textColor,
                                  borderRadius: 8,
                                  padding: "8px 10px",
                                  cursor: promptDialogBusy ? "not-allowed" : "pointer",
                                }}
                                >
                                  <div style={{ fontWeight: 600 }}>{choice.title}</div>
                                  <div style={{ fontSize: 12, color: smallText }}>{choice.description}</div>
                                </button>
                            ))}
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: 8 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>Saved prompts</div>
                          {savedPromptChoices.length > 0 ? (
                            <div style={{ display: "grid", gap: 8 }}>
                              {savedPromptChoices.map((choice) => (
                                <div key={choice.id} style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                                  <button
                                    type="button"
                                    onClick={() => void handlePromptSelection(choice)}
                                    disabled={promptDialogBusy}
                                    aria-label={choice.title}
                                    style={{
                                      flex: 1,
                                      textAlign: "left",
                                      border: `1px solid ${borderColor}`,
                                      background: inputBg,
                                      color: textColor,
                                      borderRadius: 8,
                                      padding: "8px 10px",
                                      cursor: promptDialogBusy ? "not-allowed" : "pointer",
                                    }}
                                  >
                                    <div style={{ fontWeight: 600 }}>{choice.title}</div>
                                    <div style={{ fontSize: 12, color: smallText }}>{choice.description}</div>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void deleteSavedPrompt(choice)}
                                    disabled={promptDialogBusy}
                                    aria-label={`Delete saved prompt ${choice.title}`}
                                    title={`Delete ${choice.title}`}
                                    style={{
                                      border: `1px solid ${borderColor}`,
                                      background: inputBg,
                                      color: textColor,
                                      borderRadius: 8,
                                      padding: "8px 10px",
                                      cursor: promptDialogBusy ? "not-allowed" : "pointer",
                                      fontSize: 12,
                                      minWidth: 74,
                                    }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : promptLibraryLoading ? (
                            <div style={{ fontSize: 12, color: smallText }}>
                              Loading saved prompts...
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: smallText, background: theme === "dark" ? "#1b1b1b" : "#f7f7f8", padding: 10, borderRadius: 8, border: `1px dashed ${borderColor}` }}>
                              No saved prompts yet. Save the current system prompt to create one.
                            </div>
                          )}
                        </div>

                        {promptDialogError && (
                          <div style={{ fontSize: 12, color: "var(--danger)" }} aria-live="polite">
                            {promptDialogError}
                          </div>
                        )}

                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            onClick={closePromptDialog}
                            style={{
                              border: `1px solid ${borderColor}`,
                              background: inputBg,
                              color: textColor,
                              padding: "6px 12px",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* SharePoint Authentication Section */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${borderColor}` }}>
                <div style={{ fontWeight: 600, color: "#0078d4" }}>SharePoint Integration</div>
                <div style={{ fontSize: 12, color: smallText }}>
                  Connect your Microsoft account to automatically fetch SharePoint metadata (lists, libraries, columns) when parsing Power Platform solutions.
                </div>
                {isAuthenticated && !sharePointConnected && (
                  <div style={{ fontSize: 12, color: smallText, background: theme === "dark" ? "#1a1a1a" : "#f8f9fa", padding: 8, borderRadius: 6 }}>
                    App sign-in is active. SharePoint access stays disconnected until you connect it here.
                  </div>
                )}

                {sharePointConnected ? (
                  <div style={{ background: theme === "dark" ? "#1a2e1a" : "#e8f5e9", border: `1px solid ${theme === "dark" ? "#2d5" : "#4caf50"}`, borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 13, color: theme === "dark" ? "#8ce99a" : "#2e7d32", fontWeight: 600, marginBottom: 4 }}>✓ SharePoint connected</div>
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
                      Disconnect SharePoint
                    </button>
                  </div>
                ) : (
                  <div>
                    <button
                      onClick={() => void handleConnectSharePointAccount()}
                      disabled={connectingSharePoint || sharePointMsalInteractionInProgress}
                      style={{ padding: "8px 16px", border: `1px solid #0078d4`, background: connectingSharePoint || sharePointMsalInteractionInProgress ? "#999" : "#0078d4", color: "#fff", borderRadius: 8, cursor: connectingSharePoint || sharePointMsalInteractionInProgress ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13 }}
                    >
                      {connectingSharePoint ? "Connecting SharePoint..." : "Connect SharePoint Account"}
                    </button>
                    {sharePointError && (
                      <div style={{ marginTop: 8, fontSize: 12, color: "#d32f2f" }}>SharePoint connection error: {sharePointError}</div>
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
