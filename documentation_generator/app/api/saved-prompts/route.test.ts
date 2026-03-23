import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "./route";

const mockGetServerSession = vi.fn();
const mockListSavedPrompts = vi.fn();
const mockCreateSavedPrompt = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock("../auth/[...nextauth]/route", () => ({
  authOptions: {},
}));

vi.mock("../../../lib/savedPrompts", () => ({
  listSavedPrompts: (userId: string) => mockListSavedPrompts(userId),
  createSavedPrompt: (userId: string, name: string, promptText: string) =>
    mockCreateSavedPrompt(userId, name, promptText),
  SavedPromptValidationError: class SavedPromptValidationError extends Error {},
  SavedPromptConflictError: class SavedPromptConflictError extends Error {},
}));

describe("/api/saved-prompts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue(null);
    mockListSavedPrompts.mockReturnValue([]);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("lists prompts for the authenticated user", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "user@example.com" } });
    mockListSavedPrompts.mockReturnValue([
      { id: "1", userId: "user@example.com", name: "Prompt", promptText: "Text", createdAt: 1, updatedAt: 1, deletedAt: null },
    ]);

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.prompts).toHaveLength(1);
    expect(mockListSavedPrompts).toHaveBeenCalledWith("user@example.com");
  });

  it("creates a prompt for the authenticated user", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "user@example.com" } });
    mockCreateSavedPrompt.mockReturnValue({
      id: "prompt-1",
      userId: "user@example.com",
      name: "Prompt",
      promptText: "Text",
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });

    const req = new Request("http://localhost/api/saved-prompts", {
      method: "POST",
      body: JSON.stringify({ name: "Prompt", promptText: "Text" }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.prompt.id).toBe("prompt-1");
    expect(mockCreateSavedPrompt).toHaveBeenCalledWith("user@example.com", "Prompt", "Text");
  });
});

