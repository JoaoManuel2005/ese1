import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Page from "./page";

const mockUseSession = vi.fn();
const mockUseFiles = vi.fn();
const mockUseModels = vi.fn();
const mockUseRag = vi.fn();
const mockClassifyUploads = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: (...args: unknown[]) => mockUseSession(...args),
  getSession: vi.fn(),
}));

vi.mock("./hooks/useFiles", () => ({
  default: (...args: unknown[]) => mockUseFiles(...args),
}));

vi.mock("./hooks/useModels", () => ({
  default: (...args: unknown[]) => mockUseModels(...args),
}));

vi.mock("./hooks/useRag", () => ({
  default: (...args: unknown[]) => mockUseRag(...args),
}));

vi.mock("../lib/classifyUploads", () => ({
  classifyUploads: (...args: unknown[]) => mockClassifyUploads(...args),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
}));

vi.mock("./components/FileUploader", () => ({
  default: () => <div data-testid="file-uploader" />,
}));

vi.mock("./components/ModelProviderControls", () => ({
  default: () => <div data-testid="model-controls" />,
}));

vi.mock("./components/SettingsButton", () => ({
  default: () => <div data-testid="settings-button" />,
}));

vi.mock("./components/ChatWindow", () => ({
  default: () => <div data-testid="chat-window" />,
}));

vi.mock("./components/OutputsList", () => ({
  default: () => <div data-testid="outputs-list" />,
}));

vi.mock("./components/PreviewPanel", () => ({
  default: () => <div data-testid="preview-panel" />,
}));

vi.mock("./components/SignInButton", () => ({
  default: () => <div data-testid="sign-in-button" />,
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Page output type selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends the built-in prompt when generating docs without changing the selection", async () => {
    const zipFile = new File(["fake zip"], "solution.zip", { type: "application/zip" });
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
    mockUseFiles.mockReturnValue({
      files: [
        {
          name: "solution.zip",
          type: "application/zip",
          size: zipFile.size,
          text: undefined,
          truncated: false,
          error: undefined,
          isText: false,
          file: zipFile,
        },
      ],
      setFiles: vi.fn(),
      addFiles: vi.fn(),
      removeFile: vi.fn(),
      updateFileText: vi.fn(),
    });
    mockUseModels.mockReturnValue({
      models: ["gpt-4o"],
      localModels: [],
      loading: false,
      error: null,
    });
    mockUseRag.mockReturnValue({ ragStatus: null });
    mockClassifyUploads.mockResolvedValue({ type: "power_platform_solution_zip" });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/models")) {
        return jsonResponse({ models: ["gpt-4o"] });
      }
      if (url.includes("/api/output-types")) {
        return jsonResponse([
          {
            id: "documentation",
            title: "Documentation",
            description: "Built-in docs",
            prompt: "Doc prompt",
            mime: "application/pdf",
            keywords: ["docs"],
            kind: "builtin",
          },
          {
            id: "diagrams",
            title: "Diagrams",
            description: "Built-in diagrams",
            prompt: "Diagram prompt",
            mime: "application/pdf",
            keywords: ["diagram"],
            kind: "builtin",
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
        ]);
      }
      if (url.includes("/api/rag-status")) {
        return jsonResponse({ status: "ready", chunks_indexed: 1 });
      }
      if (url.includes("/api/rag-ingest-zip")) {
        return jsonResponse({ chunks_stored: 1, corpus_type: "solution_zip" });
      }
      if (url.includes("/api/parse-solution")) {
        return jsonResponse({
          data: {
            solution_name: "Acme Solution",
            version: "1.0.0",
            publisher: "Acme",
            components: [],
            sharepointRefs: [],
          },
          sharePointEnrichmentEnabled: false,
          authenticationRequired: false,
          sharePointUrls: [],
          sharePointEnrichmentStatus: "not_needed",
        });
      }
      if (url.includes("/api/generate-solution-docs")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.output_type).toBe("documentation");
        expect(String(body.systemPrompt || "")).toContain("Doc prompt");
        expect(body.output_type_id).toBe("documentation");
        expect(body.output_type_title).toBe("Documentation");
        expect(body.output_type_kind).toBe("builtin");
        expect(body.prompt_id).toBeNull();
        expect(body.prompt_name_snapshot).toBe("Documentation");
        expect(String(body.prompt_text_snapshot || "")).toContain("Doc prompt");
        return jsonResponse({ documentation: "Generated markdown" });
      }
      if (url.includes("/api/markdown-to-pdf")) {
        return jsonResponse({
          pdfBase64: "cGRm",
          html: "<p>PDF</p>",
          normalizedMarkdown: "Generated markdown",
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByLabelText("Output type")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Concise release notes" })).toBeInTheDocument();
    });

    expect(screen.getByText(/Selected output type:/)).toHaveTextContent("Documentation");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Parse & Generate Docs/i })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: /Parse & Generate Docs/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/generate-solution-docs"),
        expect.any(Object)
      );
    });
  });

  it("sends the saved prompt when a custom prompt is selected", async () => {
    const zipFile = new File(["fake zip"], "solution.zip", { type: "application/zip" });
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
    mockUseFiles.mockReturnValue({
      files: [
        {
          name: "solution.zip",
          type: "application/zip",
          size: zipFile.size,
          text: undefined,
          truncated: false,
          error: undefined,
          isText: false,
          file: zipFile,
        },
      ],
      setFiles: vi.fn(),
      addFiles: vi.fn(),
      removeFile: vi.fn(),
      updateFileText: vi.fn(),
    });
    mockUseModels.mockReturnValue({
      models: ["gpt-4o"],
      localModels: [],
      loading: false,
      error: null,
    });
    mockUseRag.mockReturnValue({ ragStatus: null });
    mockClassifyUploads.mockResolvedValue({ type: "power_platform_solution_zip" });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/models")) {
        return jsonResponse({ models: ["gpt-4o"] });
      }
      if (url.includes("/api/output-types")) {
        return jsonResponse([
          {
            id: "documentation",
            title: "Documentation",
            description: "Built-in docs",
            prompt: "Doc prompt",
            mime: "application/pdf",
            keywords: ["docs"],
            kind: "builtin",
          },
          {
            id: "diagrams",
            title: "Diagrams",
            description: "Built-in diagrams",
            prompt: "Diagram prompt",
            mime: "application/pdf",
            keywords: ["diagram"],
            kind: "builtin",
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
        ]);
      }
      if (url.includes("/api/rag-status")) {
        return jsonResponse({ status: "ready", chunks_indexed: 1 });
      }
      if (url.includes("/api/rag-ingest-zip")) {
        return jsonResponse({ chunks_stored: 1, corpus_type: "solution_zip" });
      }
      if (url.includes("/api/parse-solution")) {
        return jsonResponse({
          data: {
            solution_name: "Acme Solution",
            version: "1.0.0",
            publisher: "Acme",
            components: [],
            sharepointRefs: [],
          },
          sharePointEnrichmentEnabled: false,
          authenticationRequired: false,
          sharePointUrls: [],
          sharePointEnrichmentStatus: "not_needed",
        });
      }
      if (url.includes("/api/generate-solution-docs")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.output_type).toBe("custom:prompt-1");
        expect(body.systemPrompt).toBe("Custom prompt text");
        expect(body.output_type_id).toBe("custom:prompt-1");
        expect(body.output_type_title).toBe("Concise release notes");
        expect(body.output_type_kind).toBe("custom");
        expect(body.prompt_id).toBe("prompt-1");
        expect(body.prompt_name_snapshot).toBe("Concise release notes");
        expect(body.prompt_text_snapshot).toBe("Custom prompt text");
        return jsonResponse({
          documentation: "Generated markdown",
          output_type_id: "custom:prompt-1",
          output_type_title: "Concise release notes",
          output_type_kind: "custom",
          prompt_id: "prompt-1",
          prompt_name_snapshot: "Concise release notes",
          prompt_text_snapshot: "Custom prompt text",
        });
      }
      if (url.includes("/api/markdown-to-pdf")) {
        return jsonResponse({
          pdfBase64: "cGRm",
          html: "<p>PDF</p>",
          normalizedMarkdown: "Generated markdown",
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByLabelText("Output type")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Concise release notes" })).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Output type"), "custom:prompt-1");
    expect(screen.getByText(/Selected output type:/)).toHaveTextContent("Concise release notes");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Parse & Generate Docs/i })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: /Parse & Generate Docs/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/generate-solution-docs"),
        expect.any(Object)
      );
    });
  });

  it("uses the latest selected prompt when the selection changes before generation", async () => {
    const zipFile = new File(["fake zip"], "solution.zip", { type: "application/zip" });
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
    mockUseFiles.mockReturnValue({
      files: [
        {
          name: "solution.zip",
          type: "application/zip",
          size: zipFile.size,
          text: undefined,
          truncated: false,
          error: undefined,
          isText: false,
          file: zipFile,
        },
      ],
      setFiles: vi.fn(),
      addFiles: vi.fn(),
      removeFile: vi.fn(),
      updateFileText: vi.fn(),
    });
    mockUseModels.mockReturnValue({
      models: ["gpt-4o"],
      localModels: [],
      loading: false,
      error: null,
    });
    mockUseRag.mockReturnValue({ ragStatus: null });
    mockClassifyUploads.mockResolvedValue({ type: "power_platform_solution_zip" });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/models")) {
        return jsonResponse({ models: ["gpt-4o"] });
      }
      if (url.includes("/api/output-types")) {
        return jsonResponse([
          {
            id: "documentation",
            title: "Documentation",
            description: "Built-in docs",
            prompt: "Doc prompt",
            mime: "application/pdf",
            keywords: ["docs"],
            kind: "builtin",
          },
          {
            id: "diagrams",
            title: "Diagrams",
            description: "Built-in diagrams",
            prompt: "Diagram prompt",
            mime: "application/pdf",
            keywords: ["diagram"],
            kind: "builtin",
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
        ]);
      }
      if (url.includes("/api/rag-status")) {
        return jsonResponse({ status: "ready", chunks_indexed: 1 });
      }
      if (url.includes("/api/rag-ingest-zip")) {
        return jsonResponse({ chunks_stored: 1, corpus_type: "solution_zip" });
      }
      if (url.includes("/api/parse-solution")) {
        return jsonResponse({
          data: {
            solution_name: "Acme Solution",
            version: "1.0.0",
            publisher: "Acme",
            components: [],
            sharepointRefs: [],
          },
          sharePointEnrichmentEnabled: false,
          authenticationRequired: false,
          sharePointUrls: [],
          sharePointEnrichmentStatus: "not_needed",
        });
      }
      if (url.includes("/api/generate-solution-docs")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.output_type).toBe("diagrams");
        expect(body.systemPrompt).toBe("Diagram prompt");
        expect(body.output_type_id).toBe("diagrams");
        expect(body.output_type_title).toBe("Diagrams");
        expect(body.output_type_kind).toBe("builtin");
        expect(body.prompt_id).toBeNull();
        expect(body.prompt_name_snapshot).toBe("Diagrams");
        expect(body.prompt_text_snapshot).toBe("Diagram prompt");
        return jsonResponse({
          documentation: "Generated markdown",
          output_type_id: "diagrams",
          output_type_title: "Diagrams",
          output_type_kind: "builtin",
          prompt_id: null,
          prompt_name_snapshot: "Diagrams",
          prompt_text_snapshot: "Diagram prompt",
        });
      }
      if (url.includes("/api/markdown-to-pdf")) {
        return jsonResponse({
          pdfBase64: "cGRm",
          html: "<p>PDF</p>",
          normalizedMarkdown: "Generated markdown",
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByLabelText("Output type")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Output type"), "custom:prompt-1");
    await user.selectOptions(screen.getByLabelText("Output type"), "diagrams");
    expect(screen.getByText(/Selected output type:/)).toHaveTextContent("Diagrams");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Parse & Generate Docs/i })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: /Parse & Generate Docs/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/generate-solution-docs"),
        expect.any(Object)
      );
    });
  });
});
