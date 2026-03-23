import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Page from "./page";

const mockUseSession = vi.fn();
const mockUseFiles = vi.fn();
const mockUseModels = vi.fn();
const mockUseRag = vi.fn();
const mockClassifyUploads = vi.fn();

let chatMessageToSend = "";
let generateBodies: Array<Record<string, unknown>> = [];

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

vi.mock("./components/OutputsList", () => ({
  default: () => <div data-testid="outputs-list" />,
}));

vi.mock("./components/PreviewPanel", () => ({
  default: () => <div data-testid="preview-panel" />,
}));

vi.mock("./components/SignInButton", () => ({
  default: () => <div data-testid="sign-in-button" />,
}));

vi.mock("./components/ChatWindow", () => ({
  default: (props: any) => (
    <div data-testid="chat-window">
      <div data-testid="chat-transcript">
        {props.chat.map((msg: { role: string; content: string }) => `${msg.role}:${msg.content}`).join("\n")}
      </div>
      <button onClick={() => props.onSend(chatMessageToSend)}>Send chat</button>
    </div>
  ),
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

function setupCommonState() {
  const zipFile = makeZipFile();
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
  generateBodies = [];

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
    if (url.includes("/api/rag-chat")) {
      return jsonResponse({ answer: "RAG answer", sources: [] });
    }
    if (url.includes("/api/generate-solution-docs")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      generateBodies.push(body);
      return jsonResponse({
        documentation: "Generated markdown",
        output_type_id: body.output_type,
        output_type_title: body.output_type === "custom:prompt-1" ? "Concise release notes" : "Documentation",
        output_type_kind: body.output_type === "custom:prompt-1" ? "custom" : "builtin",
        prompt_id: body.output_type === "custom:prompt-1" ? "prompt-1" : null,
        prompt_name_snapshot: body.output_type === "custom:prompt-1" ? "Concise release notes" : "Documentation",
        prompt_text_snapshot: body.output_type === "custom:prompt-1" ? "Custom prompt text" : "Doc prompt",
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
  return { fetchMock };
}

describe("Page chat output type commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    chatMessageToSend = "";
  });

  it("changes a built-in output type from chat without regenerating", async () => {
    const { fetchMock } = setupCommonState();
    const user = userEvent.setup();

    render(<Page />);

    await waitFor(() => {
      expect(screen.getByLabelText("Output type")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Parse & Generate Docs/i })).toBeEnabled();
    });

    chatMessageToSend = "Could you please change output file type to diagrams?";
    await user.click(screen.getByRole("button", { name: /Send chat/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("Output type")).toHaveValue("diagrams");
    });
    expect(screen.getByTestId("chat-transcript")).toHaveTextContent("Changed output file type to Diagrams.");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/rag-chat"))).toBe(false);
    expect(generateBodies).toHaveLength(0);
  });

  it("changes a custom saved prompt and regenerates with the selected prompt", async () => {
    const { fetchMock } = setupCommonState();
    const user = userEvent.setup();

    render(<Page />);

    await waitFor(() => {
      expect(screen.getByLabelText("Output type")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Parse & Generate Docs/i })).toBeEnabled();
    });

    chatMessageToSend = "Could you please change output file type to concise release notes and generate?";
    await user.click(screen.getByRole("button", { name: /Send chat/i }));

    await waitFor(() => {
      expect(generateBodies).toHaveLength(1);
    });

    const body = generateBodies[0];
    expect(body.output_type).toBe("custom:prompt-1");
    expect(body.systemPrompt).toBe("Custom prompt text");
    expect(screen.getByLabelText("Output type")).toHaveValue("custom:prompt-1");
    expect(screen.getByTestId("chat-transcript")).toHaveTextContent(
      "Changing output file type to Concise release notes and regenerating document"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/generate-solution-docs"),
      expect.any(Object)
    );
  });

  it("returns a helpful message when the output type does not exist", async () => {
    setupCommonState();
    const user = userEvent.setup();

    render(<Page />);

    await waitFor(() => {
      expect(screen.getByLabelText("Output type")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Parse & Generate Docs/i })).toBeEnabled();
    });

    chatMessageToSend = "Could you please change output file type to missing type and regen?";
    await user.click(screen.getByRole("button", { name: /Send chat/i }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-transcript")).toHaveTextContent(
        "I couldn't find an output file type named \"missing type\""
      );
    });
    expect(generateBodies).toHaveLength(0);
    expect(screen.getByLabelText("Output type")).toHaveValue("documentation");
  });

  it("keeps the legacy keyword-based output switching behaviour", async () => {
    setupCommonState();
    const user = userEvent.setup();

    render(<Page />);

    await waitFor(() => {
      expect(screen.getByLabelText("Output type")).toBeInTheDocument();
    });

    chatMessageToSend = "please create diagram";
    await user.click(screen.getByRole("button", { name: /Send chat/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("Output type")).toHaveValue("diagrams");
    });
    expect(generateBodies).toHaveLength(0);
  });
});
