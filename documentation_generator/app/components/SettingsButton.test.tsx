import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import SettingsButton from "./SettingsButton";

type SettingsButtonProps = ComponentProps<typeof SettingsButton>;

function makeProps(overrides: Partial<SettingsButtonProps> = {}): SettingsButtonProps {
  return {
    isAuthenticated: false,
    provider: "cloud",
    setProvider: vi.fn(),
    models: ["gpt-4.1"],
    selectedModel: "gpt-4.1",
    setSelectedModel: vi.fn(),
    modelsLoading: false,
    modelsError: false,
    localModels: ["llama3.1:8b"],
    localModel: "llama3.1:8b",
    setLocalModel: vi.fn(),
    localModelsLoading: false,
    localModelsError: null,
    useCustomLocalModel: false,
    setUseCustomLocalModel: vi.fn(),
    fetchLocalModels: vi.fn(),
    sharePointToken: null,
    setSharePointToken: vi.fn(),
    systemPrompt: "Default system prompt",
    setSystemPrompt: vi.fn(),
    systemPromptDefault: "Default system prompt",
    ...overrides,
  };
}

function renderSettingsButton(overrides: Partial<SettingsButtonProps> = {}) {
  const props = makeProps(overrides);
  const user = userEvent.setup();
  render(<SettingsButton {...props} />);
  return { user, props };
}

describe("SettingsButton", () => {
  const fetchMock = vi.fn();
  const matchMediaMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        provider: "cloud",
        model: "gpt-4.1",
        azureAdClientId: "test-client-id",
        azureAdAuthority: "https://login.microsoftonline.com/organizations",
        systemPrompt: "Loaded prompt",
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    matchMediaMock.mockReturnValue({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: matchMediaMock,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not render the removed API key and RAG settings section", async () => {
    const { user } = renderSettingsButton();

    await user.click(screen.getByTitle("Settings"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    expect(screen.queryByText("API Key (Secure)")).not.toBeInTheDocument();
    expect(screen.queryByText("RAG Mode (FREE)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cloud API Key")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Azure OpenAI Endpoint")).not.toBeInTheDocument();
    expect(screen.queryByText(/Rate Limits/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/50,000 tokens/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/50 requests/i)).not.toBeInTheDocument();
  });

  it("still renders the remaining settings UI and loads settings successfully", async () => {
    const { user } = renderSettingsButton();

    await user.click(screen.getByTitle("Settings"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/settings");
    });

    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByLabelText("Provider")).toBeInTheDocument();
    expect(screen.getByLabelText("Cloud model")).toBeInTheDocument();
    expect(screen.getByLabelText("System Prompt (Solution Docs)")).toBeInTheDocument();
    expect(screen.getByText("SharePoint Integration")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
