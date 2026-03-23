"use client";

import { useEffect, useState } from "react";
import builtinOutputTypes from "../../config/output-types.json";

export type OutputTypeOption = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  mime: string;
  keywords: string[];
  kind: "builtin" | "custom";
  promptId?: string | null;
  promptName?: string | null;
  promptText?: string | null;
};

function normalizeBuiltinOutputTypes(): OutputTypeOption[] {
  return (builtinOutputTypes as Array<{
    id: string;
    title: string;
    description: string;
    prompt: string;
    mime: string;
    keywords: string[];
  }>)
    .filter((entry) => typeof entry?.id === "string" && typeof entry?.title === "string")
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      description: entry.description || "",
      prompt: entry.prompt || "",
      mime: entry.mime || "application/pdf",
      keywords: Array.isArray(entry.keywords)
        ? entry.keywords.filter((keyword): keyword is string => typeof keyword === "string")
        : [],
      kind: "builtin",
      promptId: null,
      promptName: entry.title,
      promptText: entry.prompt || "",
    }));
}

function normalizeCustomOutputType(entry: unknown): OutputTypeOption | null {
  if (!entry || typeof entry !== "object") return null;
  const candidate = entry as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.title !== "string") return null;

  const keywords = Array.isArray(candidate.keywords)
    ? candidate.keywords.filter((keyword): keyword is string => typeof keyword === "string")
    : [];

  return {
    id: candidate.id,
    title: candidate.title,
    description: typeof candidate.description === "string" ? candidate.description : "",
    prompt: typeof candidate.prompt === "string" ? candidate.prompt : "",
    mime: typeof candidate.mime === "string" && candidate.mime.trim() ? candidate.mime : "application/pdf",
    keywords,
    kind: candidate.kind === "custom" ? "custom" : "builtin",
    promptId: typeof candidate.promptId === "string" ? candidate.promptId : null,
    promptName: typeof candidate.promptName === "string" ? candidate.promptName : candidate.title,
    promptText: typeof candidate.promptText === "string" ? candidate.promptText : null,
  };
}

export function normalizeOutputTypes(input: unknown): OutputTypeOption[] {
  if (!Array.isArray(input)) {
    return normalizeBuiltinOutputTypes();
  }

  const normalized = input
    .map(normalizeCustomOutputType)
    .filter((entry): entry is OutputTypeOption => Boolean(entry));

  const builtins = normalized.filter((entry) => entry.kind === "builtin");
  const customs = normalized.filter((entry) => entry.kind === "custom");

  if (builtins.length === 0) {
    return normalizeBuiltinOutputTypes();
  }

  return [...builtins, ...customs];
}

export function getBuiltinOutputTypes(): OutputTypeOption[] {
  return normalizeBuiltinOutputTypes();
}

export function useOutputTypes(refreshKey?: unknown) {
  const [outputTypes, setOutputTypes] = useState<OutputTypeOption[]>(() => normalizeBuiltinOutputTypes());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchOutputTypes() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/output-types");
        const data = await response.json().catch(() => []);

        if (!response.ok) {
          throw new Error(
            typeof data?.error === "string" && data.error.trim().length > 0
              ? data.error
              : "Failed to load output types."
          );
        }

        const nextOutputTypes = normalizeOutputTypes(data);
        if (!cancelled) {
          setOutputTypes(nextOutputTypes);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to load output types.");
          setOutputTypes(normalizeBuiltinOutputTypes());
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchOutputTypes();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return {
    outputTypes,
    loading,
    error,
  };
}
