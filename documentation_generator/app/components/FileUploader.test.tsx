import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FileUploader from "./FileUploader";
import type { AttachedFile } from "../types";

function makeAttachedFile(overrides: Partial<AttachedFile> = {}): AttachedFile {
  return {
    name: "document.pdf",
    type: "application/pdf",
    size: 1024,
    isText: false,
    ...overrides,
  };
}

describe("FileUploader", () => {
  it("shows no files selected when files is empty", () => {
    render(
      <FileUploader files={[]} onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    expect(screen.getByText("No files selected yet.")).toBeInTheDocument();
  });

  it("shows Input Files header", () => {
    render(
      <FileUploader files={[]} onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    expect(screen.getByText("Input Files")).toBeInTheDocument();
  });

  it("renders list of files with names and sizes", () => {
    const files: AttachedFile[] = [
      makeAttachedFile({ name: "a.pdf", size: 500 }),
      makeAttachedFile({ name: "b.txt", size: 100 }),
    ];
    render(
      <FileUploader files={files} onAdd={vi.fn()} onRemove={vi.fn()} />
    );

    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    expect(screen.getByText("b.txt")).toBeInTheDocument();
    expect(screen.getByText(/500 B/)).toBeInTheDocument();
    expect(screen.getByText(/100 B/)).toBeInTheDocument();
  });

  it("calls onRemove when remove button clicked", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const files = [makeAttachedFile({ name: "remove-me.pdf" })];
    render(
      <FileUploader files={files} onAdd={vi.fn()} onRemove={onRemove} />
    );

    const removeButton = screen.getByRole("button", { name: /Remove remove-me.pdf/i });
    await user.click(removeButton);

    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("shows Clear all and calls clearFiles when provided", async () => {
    const user = userEvent.setup();
    const clearFiles = vi.fn();
    const files = [makeAttachedFile()];
    render(
      <FileUploader
        files={files}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        clearFiles={clearFiles}
      />
    );

    const clearButton = screen.getByText("Clear all");
    await user.click(clearButton);

    expect(clearFiles).toHaveBeenCalled();
  });

  it("does not show Clear all when clearFiles not provided", () => {
    render(
      <FileUploader
        files={[makeAttachedFile()]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.queryByText("Clear all")).not.toBeInTheDocument();
  });

  it("shows Power Platform solution when displayType is solution_zip", () => {
    render(
      <FileUploader
        files={[makeAttachedFile({ name: "sol.zip" })]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        displayType="solution_zip"
        displayReason="Solution marker found"
      />
    );
    expect(screen.getByText("Detected: Power Platform solution")).toBeInTheDocument();
    expect(screen.getByText("Solution marker found")).toBeInTheDocument();
  });

  it("shows Power Platform solution when displayType is power_platform_solution_zip", () => {
    render(
      <FileUploader
        files={[makeAttachedFile({ name: "sol.zip" })]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        displayType="power_platform_solution_zip"
      />
    );
    expect(screen.getByText("Detected: Power Platform solution")).toBeInTheDocument();
  });

  it("shows Detected: Documents when displayType is docs", () => {
    render(
      <FileUploader
        files={[makeAttachedFile()]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        displayType="docs"
      />
    );
    expect(screen.getByText("Detected: Documents")).toBeInTheDocument();
  });

  it("shows Detected: Unknown for other displayType", () => {
    render(
      <FileUploader
        files={[makeAttachedFile()]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        displayType="unknown"
      />
    );
    expect(screen.getByText("Detected: Unknown")).toBeInTheDocument();
  });

  it("shows file error when file has error", () => {
    const files = [makeAttachedFile({ error: "Failed to read" })];
    render(
      <FileUploader files={files} onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    expect(screen.getByText("Failed to read")).toBeInTheDocument();
  });
});
