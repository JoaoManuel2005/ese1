"use client";

import type { FC } from "react";
import type { OutputTypeOption } from "../hooks/useOutputTypes";
import { buildPromptChoices, getPromptChoiceLabel, getPromptChoicesByGroup } from "../utils/promptLibrary";

type Props = {
  outputTypes: OutputTypeOption[];
  selectedOutputTypeId: string;
  onSelect: (outputTypeId: string) => void;
  loading?: boolean;
  error?: string | null;
  showEmptyState?: boolean;
};

const OutputTypeSelector: FC<Props> = ({
  outputTypes,
  selectedOutputTypeId,
  onSelect,
  loading = false,
  error = null,
  showEmptyState = false,
}) => {
  const promptChoices = buildPromptChoices(outputTypes);
  const { builtins, saved } = getPromptChoicesByGroup(promptChoices);
  const selectedExists = promptChoices.some((entry) => entry.id === selectedOutputTypeId);
  const selectedLabel = getPromptChoiceLabel(promptChoices, selectedOutputTypeId, loading, "output");

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label htmlFor="output-type-select" style={{ fontWeight: 600, fontSize: 13 }}>
          Output type
        </label>
        <select
          id="output-type-select"
          aria-describedby="output-type-status"
          value={selectedOutputTypeId}
          aria-busy={loading}
          onChange={(e) => onSelect(e.target.value)}
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--panel-bg)",
            color: "var(--foreground)",
            minWidth: 280,
          }}
        >
          {!selectedExists && selectedOutputTypeId && (
            <option value={selectedOutputTypeId} hidden>
              {selectedLabel}
            </option>
          )}
          <optgroup label="Built-in output types">
            {builtins.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </optgroup>
          {saved.length > 0 && (
            <optgroup label="Saved output types">
              {saved.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div id="output-type-status" style={{ fontSize: 12, color: "var(--muted)" }} aria-live="polite">
        Selected output type:{" "}
        <strong style={{ color: "var(--foreground)" }}>{selectedLabel}</strong>
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: "var(--muted)" }} aria-live="polite">
          Loading output types...
        </div>
      )}

      {!loading && error && (
        <div style={{ fontSize: 12, color: "var(--danger)" }} aria-live="polite">
          {error} Built-in output types remain available.
        </div>
      )}

      {!loading && !error && showEmptyState && saved.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--muted)" }} aria-live="polite">
          No saved output types yet.
        </div>
      )}
    </div>
  );
};

export default OutputTypeSelector;
