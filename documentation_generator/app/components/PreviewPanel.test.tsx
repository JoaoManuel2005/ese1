import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import PreviewPanel from "./PreviewPanel";
import type { OutputFile } from "../types";

type PreviewPanelProps = ComponentProps<typeof PreviewPanel>;

function makeOutput(overrides: Partial<OutputFile> = {}): OutputFile {
  return {
    id: "output-1",
    filename: "generated-doc.md",
    mime: "application/pdf",
    createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
    bytesBase64: "ZmFrZS1wZGY=",
    htmlPreview: "<p>Original preview</p>",
    markdownContent: "# Original document\n\nInitial content.",
    ...overrides,
  };
}

function renderPreviewPanel(overrides: Partial<PreviewPanelProps> = {}) {
  const props: PreviewPanelProps = {
    out: makeOutput(),
    previewBlobUrl: null,
    pdfRenderError: null,
    onDownload: vi.fn(),
    onOpenPdf: vi.fn(),
    onSaveQuickEdit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return {
    user: userEvent.setup(),
    props,
    ...render(<PreviewPanel {...props} />),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;

  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe("PreviewPanel quick edit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the editor with the current document source", async () => {
    const { user } = renderPreviewPanel({
      out: makeOutput({
        markdownContent: "# Current source\n\nThis is the saved markdown.",
      }),
    });

    await user.click(screen.getByRole("button", { name: "Quick Edit" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("# Current source\n\nThis is the saved markdown.");
  });

  it("discards unsaved local changes after cancel confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = renderPreviewPanel();

    await user.click(screen.getByRole("button", { name: "Quick Edit" }));
    await user.type(screen.getByRole("textbox"), "\nUnsaved draft");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved changes?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Quick Edit" }));
    expect(screen.getByRole("textbox")).toHaveValue("# Original document\n\nInitial content.");
  });

  it("sends updated content through the save callback and shows the updated preview after save", async () => {
    const onSaveQuickEdit = vi.fn().mockResolvedValue(undefined);
    const initialOutput = makeOutput();
    const updatedMarkdown = "# Updated document\n\nSaved content.";
    const updatedOutput = makeOutput({
      htmlPreview: "<p>Updated preview</p>",
      markdownContent: updatedMarkdown,
    });
    const { user, rerender } = renderPreviewPanel({
      out: initialOutput,
      onSaveQuickEdit,
    });

    await user.click(screen.getByRole("button", { name: "Quick Edit" }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), updatedMarkdown);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSaveQuickEdit).toHaveBeenCalledWith(initialOutput.id, updatedMarkdown);
    });

    rerender(
      <PreviewPanel
        out={updatedOutput}
        previewBlobUrl={null}
        pdfRenderError={null}
        onDownload={vi.fn()}
        onOpenPdf={vi.fn()}
        onSaveQuickEdit={onSaveQuickEdit}
      />
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Updated preview")).toBeInTheDocument();
  });

  it("disables save while a save request is in flight", async () => {
    const deferred = createDeferred<void>();
    const onSaveQuickEdit = vi.fn().mockReturnValue(deferred.promise);
    const { user } = renderPreviewPanel({ onSaveQuickEdit });

    await user.click(screen.getByRole("button", { name: "Quick Edit" }));
    await user.type(screen.getByRole("textbox"), "\nPending save");

    const saveButton = screen.getByRole("button", { name: "Save" });
    await user.click(saveButton);

    expect(onSaveQuickEdit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("textbox")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Saving..." }));
    expect(onSaveQuickEdit).toHaveBeenCalledTimes(1);

    deferred.resolve();

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("keeps the editor open and preserves the draft when save fails", async () => {
    const { user } = renderPreviewPanel({
      onSaveQuickEdit: vi.fn().mockRejectedValue(new Error("Save failed.")),
    });

    await user.click(screen.getByRole("button", { name: "Quick Edit" }));
    await user.type(screen.getByRole("textbox"), "\nFailed save draft");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Save failed.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("# Original document\n\nInitial content.\nFailed save draft");
  });
});
