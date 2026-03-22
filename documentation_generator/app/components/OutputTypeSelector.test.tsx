import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import OutputTypeSelector from "./OutputTypeSelector";
import type { OutputTypeOption } from "../hooks/useOutputTypes";

function makeOutputTypes(): OutputTypeOption[] {
  return [
    {
      id: "documentation",
      title: "Documentation",
      description: "Built-in docs",
      prompt: "Doc prompt",
      mime: "application/pdf",
      keywords: ["docs"],
      kind: "builtin",
      promptId: null,
      promptName: "Documentation",
      promptText: "Doc prompt",
    },
    {
      id: "diagrams",
      title: "Diagrams",
      description: "Built-in diagrams",
      prompt: "Diagram prompt",
      mime: "application/pdf",
      keywords: ["diagram"],
      kind: "builtin",
      promptId: null,
      promptName: "Diagrams",
      promptText: "Diagram prompt",
    },
    {
      id: "custom:prompt-1",
      title: "Concise release notes",
      description: "Custom saved prompt",
      prompt: "Custom prompt text",
      mime: "application/pdf",
      keywords: ["release notes"],
      kind: "custom",
      promptId: "prompt-1",
      promptName: "Concise release notes",
      promptText: "Custom prompt text",
    },
  ];
}

function SelectorHarness({
  outputTypes,
  showEmptyState = false,
  loading = false,
  error = null,
}: {
  outputTypes: OutputTypeOption[];
  showEmptyState?: boolean;
  loading?: boolean;
  error?: string | null;
}) {
  const [selectedOutputTypeId, setSelectedOutputTypeId] = useState(outputTypes[0]?.id ?? "documentation");

  return (
    <OutputTypeSelector
      outputTypes={outputTypes}
      selectedOutputTypeId={selectedOutputTypeId}
      onSelect={setSelectedOutputTypeId}
      loading={loading}
      error={error}
      showEmptyState={showEmptyState}
    />
  );
}

describe("OutputTypeSelector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows built-in and custom output types", () => {
    render(<SelectorHarness outputTypes={makeOutputTypes()} />);

    expect(screen.getByRole("group", { name: "Built-in output types" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Saved output types" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Documentation" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Diagrams" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Concise release notes" })).toBeInTheDocument();
    expect(screen.getByText(/Selected output type:/)).toHaveTextContent("Documentation");
  });

  it("updates selected state when a new output type is chosen", async () => {
    const user = userEvent.setup();
    render(<SelectorHarness outputTypes={makeOutputTypes()} />);

    await user.selectOptions(screen.getByLabelText("Output type"), "custom:prompt-1");

    expect(screen.getByText(/Selected output type:/)).toHaveTextContent("Concise release notes");
    expect(screen.getByRole("combobox")).toHaveValue("custom:prompt-1");
  });

  it("shows only built-in options when there are no custom prompts", () => {
    render(
      <SelectorHarness
        outputTypes={makeOutputTypes().filter((entry) => entry.kind === "builtin")}
        showEmptyState
      />
    );

    expect(screen.getByRole("option", { name: "Documentation" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Diagrams" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Concise release notes" })).not.toBeInTheDocument();
    expect(screen.getByText(/No saved output types yet/)).toBeInTheDocument();
  });

  it("keeps a missing custom selection visible while prompts load", () => {
    render(
      <OutputTypeSelector
        outputTypes={makeOutputTypes().filter((entry) => entry.kind === "builtin")}
        selectedOutputTypeId="custom"
        onSelect={vi.fn()}
        loading
      />
    );

    expect(screen.getByRole("combobox")).toHaveValue("custom");
    expect(screen.getAllByText("Custom")).toHaveLength(2);
  });

  it("shows an unavailable label when a historical custom prompt no longer exists", () => {
    render(
      <OutputTypeSelector
        outputTypes={makeOutputTypes().filter((entry) => entry.kind === "builtin")}
        selectedOutputTypeId="custom:deleted-prompt"
        onSelect={vi.fn()}
      />
    );

    expect(screen.getAllByText("Output type unavailable")).toHaveLength(2);
  });
});
