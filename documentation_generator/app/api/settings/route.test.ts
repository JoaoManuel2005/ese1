import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "./route";

const mockGetRuntimeConfig = vi.fn();
const mockSetRuntimeConfig = vi.fn();
const mockGetServerSession = vi.fn();
const mockGetUserSystemPrompt = vi.fn();
const mockUpsertUserSystemPrompt = vi.fn();
const mockGetSavedPromptSelection = vi.fn();
const mockSelectSavedPromptForUser = vi.fn();
const mockListSavedPrompts = vi.fn();

vi.mock("../../../lib/runtimeConfig", () => ({
  getRuntimeConfig: (...args: unknown[]) => mockGetRuntimeConfig(...args),
  setRuntimeConfig: (...args: unknown[]) => mockSetRuntimeConfig(...args),
}));

vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock("../auth/[...nextauth]/route", () => ({
  authOptions: {},
}));

vi.mock("../../../lib/userSettings", () => ({
  getUserSystemPrompt: (userId: string) => mockGetUserSystemPrompt(userId),
  upsertUserSystemPrompt: (userId: string, prompt: string | null) =>
    mockUpsertUserSystemPrompt(userId, prompt),
}));

vi.mock("../../../lib/savedPrompts", () => ({
  getSavedPromptSelection: (userId: string) => mockGetSavedPromptSelection(userId),
  selectSavedPromptForUser: (userId: string, promptId: string) =>
    mockSelectSavedPromptForUser(userId, promptId),
  listSavedPrompts: (userId: string) => mockListSavedPrompts(userId),
  SavedPromptNotFoundError: class SavedPromptNotFoundError extends Error {},
}));

describe("GET /api/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue(null);
    mockGetUserSystemPrompt.mockReturnValue(null);
    mockGetSavedPromptSelection.mockReturnValue({ systemPrompt: null, activePromptId: null });
    mockListSavedPrompts.mockReturnValue([]);
  });

  it("returns public config from getRuntimeConfig", async () => {
    mockGetRuntimeConfig.mockResolvedValue({
      provider: "cloud",
      model: "gpt-4",
    });

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.provider).toBe("cloud");
    expect(data.model).toBe("gpt-4");
  });

  it("returns 500 when getRuntimeConfig throws", async () => {
    mockGetRuntimeConfig.mockRejectedValue(new Error("File read error"));

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBeDefined();
    expect(typeof data.error).toBe("string");
    expect(data.error.length).toBeGreaterThan(0);
  });
});

describe("POST /api/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue(null);
    mockGetUserSystemPrompt.mockReturnValue(null);
    mockGetSavedPromptSelection.mockReturnValue({ systemPrompt: null, activePromptId: null });
    mockListSavedPrompts.mockReturnValue([]);
    mockUpsertUserSystemPrompt.mockImplementation((_, prompt: string | null) => prompt);
    mockSetRuntimeConfig.mockResolvedValue({
      provider: "local",
      model: "llama3",
    });
  });

  it("returns 400 for invalid payload (not object)", async () => {
    const req = new Request("http://localhost/api/settings", {
      method: "POST",
      body: JSON.stringify("not an object"),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Invalid settings payload.");
  });

  it("returns 200 and updated config for valid payload", async () => {
    mockSetRuntimeConfig.mockResolvedValue({
      provider: "cloud",
      model: "gpt-4o",
      updatedAt: "2025-01-01T00:00:00Z",
    });

    const req = new Request("http://localhost/api/settings", {
      method: "POST",
      body: JSON.stringify({
        provider: "cloud",
        model: "gpt-4o",
      }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.provider).toBe("cloud");
    expect(data.model).toBe("gpt-4o");
    expect(mockSetRuntimeConfig).toHaveBeenCalled();
  });

  it("loads a selected saved prompt when requested", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "user@example.com" } });
    mockGetSavedPromptSelection.mockReturnValue({ systemPrompt: "Current prompt", activePromptId: "prompt-1" });
    mockListSavedPrompts.mockReturnValue([
      { id: "prompt-1", name: "Prompt 1", promptText: "Prompt text", createdAt: 1, updatedAt: 1, deletedAt: null, userId: "user@example.com" },
    ]);
    mockSelectSavedPromptForUser.mockReturnValue({
      id: "prompt-1",
      name: "Prompt 1",
      promptText: "Prompt text",
      createdAt: 1,
      updatedAt: 2,
      deletedAt: null,
      userId: "user@example.com",
    });

    const req = new Request("http://localhost/api/settings", {
      method: "POST",
      body: JSON.stringify({
        selectedPromptId: "prompt-1",
      }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.systemPrompt).toBe("Prompt text");
    expect(data.activeSavedPromptId).toBe("prompt-1");
    expect(mockSelectSavedPromptForUser).toHaveBeenCalledWith("user@example.com", "prompt-1");
  });
});
