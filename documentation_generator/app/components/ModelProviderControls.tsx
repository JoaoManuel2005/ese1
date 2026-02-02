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
}) => {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Provider:</div>
        <div style={{ fontSize: 14 }}>{provider === "cloud" ? "Cloud" : "Local"}</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Model:</div>
        <div style={{ fontSize: 14 }}>{provider === "cloud" ? (selectedModel || "default") : (localModel || "default")}</div>
      </div>

      <div style={{ fontSize: 12, color: "#666" }}>
        To change provider/model or API key, open the Settings overlay (⚙️ Settings in the header).
      </div>
    </div>
  );
};

export default ModelProviderControls;
