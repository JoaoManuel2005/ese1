import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import SettingsButton from "./SettingsButton";

type SettingsButtonProps = ComponentProps<typeof SettingsButton>;

const builtinPromptLibrary = [
  {
    id: "documentation",
    title: "Documentation",
    description: "Built-in docs",
    prompt: "Doc prompt",
    mime: "application/pdf",
    keywords: ["docs"],
    kind: "builtin" as const,
  },
  {
    id: "diagrams",
    title: "Diagrams",
    description: "Built-in diagrams",
    prompt: "Diagram prompt",
    mime: "application/pdf",
    keywords: ["diagram"],
    kind: "builtin" as const,
  },
];

const customPromptLibrary = [
  {
    id: "custom:prompt-1",
    title: "Concise release notes",
    description: "Custom saved prompt",
    prompt: "Custom prompt text",
    mime: "application/pdf",
    keywords: ["release notes"],
    kind: "custom" as const,
    promptId: "prompt-1",
    promptName: "Concise release notes",
    promptText: "Custom prompt text",
  },
];

const promptLibraryResponse = [...builtinPromptLibrary, ...customPromptLibrary];

function makeProps(overrides: Partial<SettingsButtonProps> = {}): SettingsButtonProps {
  return {
    isAuthenticated: true,
    provider: "cloud",
    setProvider: vi.fn(),
    models: ["gpt-4o"],
    selectedModel: "gpt-4o",
    setSelectedModel: vi.fn(),
    modelsLoading: false,
    modelsError: false,
    localModels: ["llama3.1"],
    localModel: "llama3.1",
    setLocalModel: vi.fn(),
    localModelsLoading: false,
    localModelsError: null,
    useCustomLocalModel: false,
    setUseCustomLocalModel: vi.fn(),
    fetchLocalModels: vi.fn(),
    sharePointToken: null,
    setSharePointToken: vi.fn(),
    systemPrompt: "Current active prompt",
    setSystemPrompt: vi.fn(),
    systemPromptDefault: "Default system prompt",
    ...overrides,
  };
}

function SettingsHarness(overrides: Partial<SettingsButtonProps> = {}) {
  const props = makeProps({
    ...overrides,
    systemPrompt: overrides.systemPrompt ?? "Current active prompt",
  });
  const [systemPrompt, setSystemPrompt] = useState(props.systemPrompt);
  const [provider, setProvider] = useState(props.provider);
  const [selectedModel, setSelectedModel] = useState(props.selectedModel);
  const [localModel, setLocalModel] = useState(props.localModel);
  const [useCustomLocalModel, setUseCustomLocalModel] = useState(props.useCustomLocalModel);

  return (
    <SettingsButton
      {...props}
      provider={provider}
      setProvider={setProvider}
      selectedModel={selectedModel}
      setSelectedModel={setSelectedModel}
      localModel={localModel}
      setLocalModel={setLocalModel}
      useCustomLocalModel={useCustomLocalModel}
      setUseCustomLocalModel={setUseCustomLocalModel}
      systemPrompt={systemPrompt}
      setSystemPrompt={setSystemPrompt}
    />
  );
}

function createResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

function makeFetchMock(overrides: Partial<{
  settingsGet: Record<string, unknown>;
  settingsPost: Record<string, unknown>;
  outputTypes: unknown[];
  savedPromptCreate: Record<string, unknown>;
  selectedPromptId: string;
  selectedPromptResponse: Record<string, unknown>;
}> = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};

    if (url.includes("/api/output-types")) {
      return createResponse(overrides.outputTypes ?? promptLibraryResponse);
    }

    if (url.includes("/api/settings") && method === "GET") {
      return createResponse({
        provider: "cloud",
        model: "gpt-4o",
        systemPrompt: "Current active prompt",
        savedPrompts: [],
        activeSavedPromptId: null,
        ...overrides.settingsGet,
      });
    }

    if (url.includes("/api/settings") && method === "POST" && typeof body.selectedPromptId === "string") {
      return createResponse(
        overrides.selectedPromptResponse ?? {
          systemPrompt: body.selectedPromptId === "custom:prompt-1" ? "Custom prompt text" : "Doc prompt",
          activeSavedPromptId: body.selectedPromptId,
          savedPrompts: promptLibraryResponse.filter((entry) => entry.kind === "custom").map((entry) => ({
            id: entry.promptId,
            name: entry.title,
            promptText: entry.promptText,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deletedAt: null,
          })),
        }
      );
    }

    if (url.includes("/api/settings") && method === "POST" && typeof body.systemPrompt === "string") {
      return createResponse(
        overrides.settingsPost ?? {
          provider: body.provider ?? "cloud",
          model: body.model ?? "gpt-4o",
          systemPrompt: body.systemPrompt,
          savedPrompts: [],
          activeSavedPromptId: null,
        }
      );
    }

    if (url.includes("/api/saved-prompts") && method === "POST") {
      return createResponse(
        overrides.savedPromptCreate ?? {
          prompt: {
            id: "saved-new",
            name: String(body.name || ""),
            promptText: String(body.promptText || ""),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deletedAt: null,
          },
        }
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });
}

function mockSettingsLoad(overrides: Parameters<typeof makeFetchMock>[0] = {}) {
  const fetchMock = makeFetchMock(overrides);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function createStatefulPromptFetch(initialState: {
  systemPrompt: string;
  activeSavedPromptId: string | null;
  savedPrompts: Array<{
    id: string;
    name: string;
    promptText: string;
  }>;
}) {
  const state = {
    systemPrompt: initialState.systemPrompt,
    activeSavedPromptId: initialState.activeSavedPromptId,
    savedPrompts: [...initialState.savedPrompts],
  };

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};

    if (url.includes("/api/output-types")) {
      return createResponse([
        ...builtinPromptLibrary,
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
      return createResponse({
        provider: "cloud",
        model: "gpt-4o",
        systemPrompt: state.systemPrompt,
        savedPrompts: state.savedPrompts.map((entry) => ({
          id: entry.id,
          name: entry.name,
          promptText: entry.promptText,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deletedAt: null,
        })),
        activeSavedPromptId: state.activeSavedPromptId,
      });
    }

    if (url.includes("/api/settings") && method === "POST" && typeof body.selectedPromptId === "string") {
      const selected = state.savedPrompts.find((entry) => entry.id === body.selectedPromptId) || null;
      if (selected) {
        state.systemPrompt = selected.promptText;
        state.activeSavedPromptId = selected.id;
      }

      return createResponse({
        provider: "cloud",
        model: "gpt-4o",
        systemPrompt: state.systemPrompt,
        savedPrompts: state.savedPrompts.map((entry) => ({
          id: entry.id,
          name: entry.name,
          promptText: entry.promptText,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deletedAt: null,
        })),
        activeSavedPromptId: state.activeSavedPromptId,
      });
    }

    if (url.includes("/api/settings") && method === "POST" && typeof body.systemPrompt === "string") {
      state.systemPrompt = body.systemPrompt;
      state.activeSavedPromptId = null;

      return createResponse({
        provider: "cloud",
        model: "gpt-4o",
        systemPrompt: state.systemPrompt,
        savedPrompts: state.savedPrompts.map((entry) => ({
          id: entry.id,
          name: entry.name,
          promptText: entry.promptText,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deletedAt: null,
        })),
        activeSavedPromptId: state.activeSavedPromptId,
      });
    }

    if (url.includes("/api/saved-prompts/") && method === "DELETE") {
      const deletedPromptId = url.split("/").pop() || "";
      state.savedPrompts = state.savedPrompts.filter((entry) => entry.id !== deletedPromptId);
      if (state.activeSavedPromptId === deletedPromptId) {
        state.activeSavedPromptId = null;
      }
      return new Response(null, { status: 204 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe("SettingsButton prompt UX", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens the naming flow when saving a prompt", async () => {
    mockSettingsLoad();
    const user = userEvent.setup();

    render(<SettingsHarness />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("dialog", { name: "Save prompt" })).toBeInTheDocument();
    expect(screen.getByLabelText("Prompt name")).toBeInTheDocument();
  });

  it("rejects blank prompt text before opening the save dialog", async () => {
    mockSettingsLoad();
    const user = userEvent.setup();

    render(<SettingsHarness />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const promptBox = await screen.findByRole("textbox", { name: "System Prompt (Solution Docs)" });
    await user.clear(promptBox);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Prompt content is required.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Save prompt" })).not.toBeInTheDocument();
  });

  it("blocks duplicate prompt names before submitting and keeps the dialog open", async () => {
    const fetchMock = mockSettingsLoad();

    const user = userEvent.setup();
    render(<SettingsHarness />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await user.type(screen.getByLabelText("Prompt name"), "Concise release notes");
    await user.click(screen.getByRole("button", { name: "Save prompt" }));

    expect(await screen.findByText('A saved prompt named "Concise release notes" already exists.')).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Save prompt" })).toBeInTheDocument();
    const saveCalls = fetchMock.mock.calls.filter(
      ([input, init]) => String(input).includes("/api/saved-prompts") && (init?.method || "GET") === "POST"
    );
    expect(saveCalls).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Save prompt" })).not.toBeInTheDocument();
  });

  it("blocks built-in prompt names before submitting", async () => {
    const fetchMock = mockSettingsLoad();

    const user = userEvent.setup();
    render(<SettingsHarness />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await user.type(screen.getByLabelText("Prompt name"), "Documentation");
    await user.click(screen.getByRole("button", { name: "Save prompt" }));

    expect(await screen.findByText("Prompt name conflicts with a built-in prompt.")).toBeInTheDocument();
    const saveCalls = fetchMock.mock.calls.filter(
      ([input, init]) => String(input).includes("/api/saved-prompts") && (init?.method || "GET") === "POST"
    );
    expect(saveCalls).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Save prompt" })).not.toBeInTheDocument();
  });

  it("loads saved prompts and built-in prompts into the system prompt textarea", async () => {
    const documentationPrompt = builtinPromptLibrary[0].prompt;
    const fetchMock = makeFetchMock({
      outputTypes: [
        ...builtinPromptLibrary,
        {
          id: "custom:prompt-1",
          title: "Prompt one",
          description: "Custom saved prompt",
          prompt: "Prompt one text",
          mime: "application/pdf",
          keywords: ["prompt one"],
          kind: "custom" as const,
          promptId: "prompt-1",
          promptName: "Prompt one",
          promptText: "Prompt one text",
        },
        {
          id: "custom:prompt-2",
          title: "Prompt two",
          description: "Custom saved prompt",
          prompt: "Prompt two text",
          mime: "application/pdf",
          keywords: ["prompt two"],
          kind: "custom" as const,
          promptId: "prompt-2",
          promptName: "Prompt two",
          promptText: "Prompt two text",
        },
      ],
      settingsGet: {
        savedPrompts: [
          {
            id: "prompt-1",
            name: "Prompt one",
            promptText: "Prompt one text",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deletedAt: null,
          },
          {
            id: "prompt-2",
            name: "Prompt two",
            promptText: "Prompt two text",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deletedAt: null,
          },
        ],
        activeSavedPromptId: "prompt-1",
      },
      selectedPromptResponse: {
        systemPrompt: "Prompt two text",
        activeSavedPromptId: "prompt-2",
        savedPrompts: [
          {
            id: "prompt-1",
            name: "Prompt one",
            promptText: "Prompt one text",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deletedAt: null,
          },
          {
            id: "prompt-2",
            name: "Prompt two",
            promptText: "Prompt two text",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deletedAt: null,
          },
        ],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<SettingsHarness />);
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await user.click(screen.getByRole("button", { name: "Load" }));
    expect(await screen.findByRole("button", { name: "Documentation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Diagrams" })).toBeInTheDocument();
    await screen.findByRole("button", { name: "Prompt two" });
    await user.click(screen.getByRole("button", { name: "Prompt two" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "System Prompt (Solution Docs)" })).toHaveValue("Prompt two text");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Prompt two");
    expect(screen.queryByRole("dialog", { name: "Load prompt" })).not.toBeInTheDocument();
    expect(screen.getByText("Prompt two loaded.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load" }));
    await user.click(screen.getByRole("button", { name: "Documentation" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "System Prompt (Solution Docs)" })).toHaveValue(documentationPrompt);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Documentation");
    expect(screen.queryByRole("dialog", { name: "Load prompt" })).not.toBeInTheDocument();
  });

  it("restores the default prompt", async () => {
    mockSettingsLoad();
    const user = userEvent.setup();

    render(<SettingsHarness />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Restore to default" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "System Prompt (Solution Docs)" })).toHaveValue("Default system prompt");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Default prompt");
    expect(screen.getByText("Restored to default prompt.")).toBeInTheDocument();
  });

  it("marks edited prompt text as Custom", async () => {
    const fetchMock = createStatefulPromptFetch({
      systemPrompt: "Doc prompt",
      activeSavedPromptId: null,
      savedPrompts: [],
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<SettingsHarness />);
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Documentation");
    });

    const promptBox = screen.getByRole("textbox", { name: "System Prompt (Solution Docs)" });
    await user.clear(promptBox);
    await user.type(promptBox, "Completely custom prompt text");

    expect(screen.getByRole("status")).toHaveTextContent("Custom");

    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Custom");
    });
  });

  it("keeps the saved prompt indicator after saving and reopening settings", async () => {
    const fetchMock = createStatefulPromptFetch({
      systemPrompt: "Prompt two text",
      activeSavedPromptId: "prompt-2",
      savedPrompts: [
        {
          id: "prompt-1",
          name: "Prompt one",
          promptText: "Prompt one text",
        },
        {
          id: "prompt-2",
          name: "Prompt two",
          promptText: "Prompt two text",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<SettingsHarness />);
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Prompt two");
    });

    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(
      fetchMock.mock.calls.some(([input, init]) => {
        if (!String(input).includes("/api/settings") || (init?.method || "GET") !== "POST") {
          return false;
        }
        const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        return body.selectedPromptId === "prompt-2";
      })
    ).toBe(true);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Prompt two");
    });
  });

  it("shows delete controls only for saved prompts and keeps built-ins non-deletable", async () => {
    mockSettingsLoad({
      outputTypes: [
        ...builtinPromptLibrary,
        {
          id: "custom:prompt-1",
          title: "Prompt one",
          description: "Custom saved prompt",
          prompt: "Prompt one text",
          mime: "application/pdf",
          keywords: ["prompt one"],
          kind: "custom" as const,
          promptId: "prompt-1",
          promptName: "Prompt one",
          promptText: "Prompt one text",
        },
      ],
      settingsGet: {
        systemPrompt: "Doc prompt",
        activeSavedPromptId: null,
        savedPrompts: [
          {
            id: "prompt-1",
            name: "Prompt one",
            promptText: "Prompt one text",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deletedAt: null,
          },
        ],
      },
    });

    const user = userEvent.setup();
    render(<SettingsHarness />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Load" }));

    expect(await screen.findByRole("button", { name: "Documentation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Diagrams" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prompt one" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete saved prompt Documentation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete saved prompt Diagrams" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete saved prompt Prompt one" })).toBeInTheDocument();
  });

  it("deletes an inactive saved prompt and keeps the active indicator intact", async () => {
    const fetchMock = createStatefulPromptFetch({
      systemPrompt: "Doc prompt",
      activeSavedPromptId: null,
      savedPrompts: [
        {
          id: "prompt-1",
          name: "Prompt one",
          promptText: "Prompt one text",
        },
        {
          id: "prompt-2",
          name: "Prompt two",
          promptText: "Prompt two text",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    render(<SettingsHarness />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Load" }));

    await user.click(screen.getByRole("button", { name: "Delete saved prompt Prompt two" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Load prompt" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Documentation");

    await user.click(screen.getByRole("button", { name: "Load" }));
    expect(await screen.findByRole("button", { name: "Prompt one" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prompt two" })).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("deletes the currently active saved prompt and falls back to Custom", async () => {
    const fetchMock = createStatefulPromptFetch({
      systemPrompt: "Prompt one text",
      activeSavedPromptId: "prompt-1",
      savedPrompts: [
        {
          id: "prompt-1",
          name: "Prompt one",
          promptText: "Prompt one text",
        },
        {
          id: "prompt-2",
          name: "Prompt two",
          promptText: "Prompt two text",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    render(<SettingsHarness />);
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Prompt one");
    });

    await user.click(screen.getByRole("button", { name: "Load" }));
    await user.click(screen.getByRole("button", { name: "Delete saved prompt Prompt one" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Load prompt" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Custom");

    confirmSpy.mockRestore();
  });

  it("closes the dialog on cancel, success, and after dismissing an error", async () => {
    let saveAttemptCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";

      if (url.includes("/api/output-types")) {
        return createResponse(promptLibraryResponse);
      }

      if (url.includes("/api/settings") && method === "GET") {
        return createResponse({
          provider: "cloud",
          model: "gpt-4o",
          systemPrompt: "Current active prompt",
          savedPrompts: [],
          activeSavedPromptId: null,
        });
      }

      if (url.includes("/api/saved-prompts") && method === "POST") {
        saveAttemptCount += 1;
        if (saveAttemptCount === 1) {
          return createResponse({
            prompt: {
              id: "saved-1",
              name: "Compact prompt",
              promptText: "Current active prompt",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              deletedAt: null,
            },
          });
        }
        return createResponse({ error: "Duplicate name" }, { status: 400 });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<SettingsHarness />);
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("dialog", { name: "Save prompt" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Save prompt" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.type(screen.getByLabelText("Prompt name"), "Compact prompt");
    await user.click(screen.getByRole("button", { name: "Save prompt" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Save prompt" })).not.toBeInTheDocument();
    });

    fetchMock.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/output-types")) {
        return createResponse(promptLibraryResponse);
      }
      if (url.includes("/api/settings") && (init?.method || "GET") === "GET") {
        return createResponse({
          provider: "cloud",
          model: "gpt-4o",
          systemPrompt: "Current active prompt",
          savedPrompts: [],
          activeSavedPromptId: null,
        });
      }
      if (url.includes("/api/saved-prompts")) {
        return createResponse({ error: "Duplicate name" }, { status: 400 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.type(screen.getByLabelText("Prompt name"), "Broken prompt");
    await user.click(screen.getByRole("button", { name: "Save prompt" }));
    expect(await screen.findByText("Duplicate name")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Save prompt" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Save prompt" })).not.toBeInTheDocument();
  });
});
