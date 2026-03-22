import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Page from "./page";

const mockUseSession = vi.fn();
const mockUseFiles = vi.fn();
const mockUseModels = vi.fn();
const mockUseRag = vi.fn();
const mockClassifyUploads = vi.fn();
const defaultSystemPrompt =
  "You are a technical documentation assistant for Microsoft Power Platform solutions. Produce comprehensive documentation that is exhaustive and component-driven. Every component provided must appear in the output under the correct type. Use only provided component evidence and metadata; if a detail is missing, write 'Not found in solution export'. Never omit component types, and preserve exact component names. Mermaid diagrams are mandatory and must be valid fenced mermaid code blocks.";

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

function makeZipFile() {
  return new File(["fake zip"], "solution.zip", { type: "application/zip" });
}

function makeFetchMock(initialState?: Partial<{
  systemPrompt: string;
  activeSavedPromptId: string | null;
  savedPrompts: Array<{ id: string; name: string; promptText: string }>;
}>) {
  const state = {
    systemPrompt: initialState?.systemPrompt ?? defaultSystemPrompt,
    activeSavedPromptId: initialState?.activeSavedPromptId ?? null,
    savedPrompts: initialState?.savedPrompts ?? [
      { id: "prompt-1", name: "Concise release notes", promptText: "Summarise changes tersely" },
    ],
  };

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};

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
        ...state.savedPrompts.map((entry) => ({
          id: `custom:${entry.id}`,
          title: entry.name,
          description: "Custom saved prompt",
          prompt: entry.promptText,
          mime: "application/pdf",
          keywords: [entry.name],
          kind: "custom" as const,
          promptId: entry.id,
          promptName: entry.name,
          promptText: entry.promptText,
        })),
      ]);
    }
    if (url.includes("/api/settings") && method === "GET") {
      return jsonResponse({
        provider: "cloud",
        model: "gpt-4o",
        systemPrompt: state.systemPrompt,
        activeSavedPromptId: state.activeSavedPromptId,
        savedPrompts: state.savedPrompts.map((entry) => ({
          id: entry.id,
          name: entry.name,
          promptText: entry.promptText,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deletedAt: null,
        })),
      });
    }
    if (url.includes("/api/settings") && method === "POST" && typeof body.selectedPromptId === "string") {
      const selected = state.savedPrompts.find((entry) => entry.id === body.selectedPromptId) || null;
      if (selected) {
        state.systemPrompt = selected.promptText;
        state.activeSavedPromptId = selected.id;
      }
      return jsonResponse({
        provider: "cloud",
        model: "gpt-4o",
        systemPrompt: state.systemPrompt,
        activeSavedPromptId: state.activeSavedPromptId,
        savedPrompts: state.savedPrompts.map((entry) => ({
          id: entry.id,
          name: entry.name,
          promptText: entry.promptText,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deletedAt: null,
        })),
      });
    }
    if (url.includes("/api/settings") && method === "POST" && typeof body.systemPrompt === "string") {
      state.systemPrompt = body.systemPrompt;
      state.activeSavedPromptId = null;
      return jsonResponse({
        provider: "cloud",
        model: "gpt-4o",
        systemPrompt: state.systemPrompt,
        activeSavedPromptId: state.activeSavedPromptId,
        savedPrompts: state.savedPrompts.map((entry) => ({
          id: entry.id,
          name: entry.name,
          promptText: entry.promptText,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deletedAt: null,
        })),
      });
    }
    if (url.includes("/api/conversations")) {
      return jsonResponse({ conversations: [] });
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
}

function setupPage(initialState?: Parameters<typeof makeFetchMock>[0]) {
  const zipFile = makeZipFile();
  mockUseSession.mockReturnValue({ data: { user: { email: "user@example.com" } }, status: "authenticated" });
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

  const fetchMock = makeFetchMock(initialState);
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock };
}

describe("Page prompt/output sync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("syncs output selection into Settings and keeps known prompts visible", async () => {
    const { fetchMock } = setupPage({
      systemPrompt: defaultSystemPrompt,
      activeSavedPromptId: null,
      savedPrompts: [
        { id: "prompt-1", name: "Concise release notes", promptText: "Summarise changes tersely" },
      ],
    });
    const user = userEvent.setup();
    render(<Page />);

    await waitFor(() => expect(screen.getByLabelText("Output type")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Output type"), "custom:prompt-1");
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => String(input).includes("/api/settings") && (init?.method || "GET") === "POST"
        )
      ).toBe(true);
    });

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "System Prompt (Solution Docs)" })).toHaveValue("Summarise changes tersely");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Concise release notes");
  });

  it("syncs a built-in Settings load back into the output type selector", async () => {
    setupPage({
      systemPrompt: defaultSystemPrompt,
      activeSavedPromptId: null,
      savedPrompts: [
        { id: "prompt-1", name: "Concise release notes", promptText: "Summarise changes tersely" },
      ],
    });
    const user = userEvent.setup();
    render(<Page />);

    await waitFor(() => expect(screen.getByLabelText("Output type")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Load" }));
    await user.click(screen.getByRole("button", { name: "Diagrams" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Output type")).toHaveValue("diagrams");
    });

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "System Prompt (Solution Docs)" })).toHaveValue("Diagram prompt");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Diagrams");
  });

  it("shows Custom after editing the Settings prompt away from a known prompt", async () => {
    setupPage({
      systemPrompt: defaultSystemPrompt,
      activeSavedPromptId: null,
      savedPrompts: [
        { id: "prompt-1", name: "Concise release notes", promptText: "Summarise changes tersely" },
      ],
    });
    const user = userEvent.setup();
    render(<Page />);

    await waitFor(() => expect(screen.getByLabelText("Output type")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const textarea = await screen.findByRole("textbox", { name: "System Prompt (Solution Docs)" });
    await user.clear(textarea);
    await user.type(textarea, "Completely custom prompt text");

    await waitFor(() => {
      expect(screen.getByLabelText("Output type")).toHaveValue("custom");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Custom");
  });

  it("keeps the output type matched after saving known and unknown prompt text", async () => {
    const { fetchMock } = setupPage({
      systemPrompt: defaultSystemPrompt,
      activeSavedPromptId: null,
      savedPrompts: [
        { id: "prompt-1", name: "Concise release notes", promptText: "Summarise changes tersely" },
      ],
    });
    const user = userEvent.setup();
    render(<Page />);

    await waitFor(() => expect(screen.getByLabelText("Output type")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const textarea = await screen.findByRole("textbox", { name: "System Prompt (Solution Docs)" });

    await user.clear(textarea);
    await user.type(textarea, "Summarise changes tersely");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Output type")).toHaveValue("custom:prompt-1");
    });
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => String(input).includes("/api/settings") && (init?.method || "GET") === "POST"
        )
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Settings" }));
    const textareaAgain = await screen.findByRole("textbox", { name: "System Prompt (Solution Docs)" });
    await user.clear(textareaAgain);
    await user.type(textareaAgain, "My own custom text");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Output type")).toHaveValue("custom");
    });
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => String(input).includes("/api/settings") && (init?.method || "GET") === "POST"
        )
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
    });
  });

  it("restoring the default prompt updates the output type back to Documentation", async () => {
    setupPage({
      systemPrompt: defaultSystemPrompt,
      activeSavedPromptId: null,
      savedPrompts: [],
    });
    const user = userEvent.setup();
    render(<Page />);

    await waitFor(() => expect(screen.getByLabelText("Output type")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Restore to default" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Output type")).toHaveValue("documentation");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Default prompt");
  });
});
