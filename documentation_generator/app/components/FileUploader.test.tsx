import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FileUploader from "./FileUploader";
import type { AttachedFile } from "../types";
import { fireEvent } from "@testing-library/react";
import { useState } from "react";

function makeAttachedFile(overrides: Partial<AttachedFile> = {}): AttachedFile {
  return {
    name: "document.pdf",
    type: "application/pdf",
    size: 1024,
    isText: false,
    ...overrides,
  };
}

function FileUploaderStateHarness() {
  const [files, setFiles] = useState<AttachedFile[]>([]);

  return (
    <FileUploader
      files={files}
      onAdd={(newFiles) =>
        setFiles(
          newFiles.map((file) => ({
            name: file.name,
            type: file.type || "unknown",
            size: file.size,
            isText: false,
            file,
          }))
        )
      }
      onRemove={(index) => setFiles((prev) => prev.filter((_, i) => i !== index))}
    />
  );
}

describe("FileUploader", () => {
  it("shows no files selected when files is empty", () => {
    render(
      <FileUploader files={[]} onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    expect(screen.getByText("No .zip solution file selected yet.")).toBeInTheDocument();
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

  it("shows Detected: Unsupported file type when displayType is docs", () => {
    render(
      <FileUploader
        files={[makeAttachedFile()]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        displayType="docs"
      />
    );
    expect(screen.getByText("Detected: Unsupported file type")).toBeInTheDocument();
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

  it("renders a friendly invalid solution zip message without raw JSON", () => {
    const friendlyMessage =
      "This .zip file does not appear to be a valid Power Platform solution export. Please choose another file.";
    const rawJson = '{"ok":false,"error":{"code":"INVALID_SOLUTION_ZIP","message":"Zip does not look like a Power Platform solution export."}}';

    render(
      <FileUploader
        files={[makeAttachedFile({ name: "solution.zip", error: friendlyMessage })]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        displayType="unknown"
        displayReason={friendlyMessage}
      />
    );

    expect(screen.getByText(friendlyMessage)).toBeInTheDocument();
    expect(screen.queryByText(rawJson)).not.toBeInTheDocument();
  });

  it("limits the file picker to zip files", () => {
    const { container } = render(
      <FileUploader files={[]} onAdd={vi.fn()} onRemove={vi.fn()} />
    );

    const input = container.querySelector('input[type="file"]');
    expect(input).toHaveAttribute("accept", ".zip,application/zip,application/x-zip-compressed");
    expect(input).not.toHaveAttribute("multiple");
  });

  it("rejects non-zip files from the file picker and shows an error", () => {
    const onAdd = vi.fn();
    const { container } = render(
      <FileUploader files={[]} onAdd={onAdd} onRemove={vi.fn()} />
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const txtFile = new File(["hello"], "notes.txt", { type: "text/plain" });

    fireEvent.change(input, { target: { files: [txtFile] } });

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByText("Rejected: notes.txt.")).toBeInTheDocument();
  });

  it("does not add rejected invalid files to the selected file list", () => {
    const { container } = render(<FileUploaderStateHarness />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const txtFile = new File(["hello"], "notes.txt", { type: "text/plain" });

    fireEvent.change(input, { target: { files: [txtFile] } });

    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    expect(screen.getByText("No .zip solution file selected yet.")).toBeInTheDocument();
  });

  it("accepts zip files and clears prior upload errors", () => {
    const onAdd = vi.fn();
    const { container } = render(
      <FileUploader files={[]} onAdd={onAdd} onRemove={vi.fn()} />
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const txtFile = new File(["hello"], "notes.txt", { type: "text/plain" });
    const zipFile = new File(["zip"], "solution.zip", { type: "application/zip" });

    fireEvent.change(input, { target: { files: [txtFile] } });
    expect(screen.getByText(/Rejected: notes\.txt\./)).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [zipFile] } });

    expect(onAdd).toHaveBeenCalledWith([zipFile]);
    expect(screen.queryByText(/Rejected: notes\.txt\./)).not.toBeInTheDocument();
  });

  it("keeps only one selected zip file in the visible list", () => {
    const { container } = render(<FileUploaderStateHarness />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const firstZip = new File(["zip"], "first.zip", { type: "application/zip" });
    const secondZip = new File(["zip"], "second.zip", { type: "application/zip" });

    fireEvent.change(input, { target: { files: [firstZip] } });
    expect(screen.getByText("first.zip")).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [secondZip] } });

    expect(screen.queryByText("first.zip")).not.toBeInTheDocument();
    expect(screen.getByText("second.zip")).toBeInTheDocument();
  });

  it("accepts dropped zip files and rejects dropped non-zip files", () => {
    const onAdd = vi.fn();
    render(<FileUploader files={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    const dropzone = screen.getByText("Upload a .zip solution file").closest(".dropzone");
    expect(dropzone).not.toBeNull();

    const zipFile = new File(["zip"], "solution.zip", { type: "application/zip" });
    const txtFile = new File(["hello"], "notes.txt", { type: "text/plain" });

    fireEvent.drop(dropzone!, {
      dataTransfer: {
        files: [zipFile, txtFile],
      },
    });

    expect(onAdd).toHaveBeenCalledWith([zipFile]);
    expect(screen.getByText("Rejected: notes.txt.")).toBeInTheDocument();
  });

  it("uses only the first valid zip when multiple zip files are dropped", () => {
    const onAdd = vi.fn();
    render(<FileUploader files={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    const dropzone = screen.getByText("Upload a .zip solution file").closest(".dropzone");
    expect(dropzone).not.toBeNull();

    const firstZip = new File(["zip"], "first.zip", { type: "application/zip" });
    const secondZip = new File(["zip"], "second.zip", { type: "application/zip" });

    fireEvent.drop(dropzone!, {
      dataTransfer: {
        files: [firstZip, secondZip],
      },
    });

    expect(onAdd).toHaveBeenCalledWith([firstZip]);
    expect(screen.getByText(/Only one \.zip solution file can be uploaded at a time\./)).toBeInTheDocument();
  });

  it("disables further uploads when uploadDisabled is true", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <FileUploader
        files={[makeAttachedFile({ name: "bad.txt", error: "Invalid file type" })]}
        onAdd={onAdd}
        onRemove={vi.fn()}
        uploadDisabled
        disabledMessage="Remove the invalid file before uploading more files or generating documentation."
      />
    );

    await user.click(screen.getByRole("button", { name: "Browse" }));

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByText("Remove the invalid file before uploading more files or generating documentation.")).toBeInTheDocument();
  });
});
