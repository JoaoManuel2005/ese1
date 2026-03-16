import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "./route";

const mockGetRuntimeConfig = vi.fn();
const mockSetRuntimeConfig = vi.fn();
const mockGetServerSession = vi.fn();
const mockGetUserSystemPrompt = vi.fn();
const mockUpsertUserSystemPrompt = vi.fn();

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

describe("GET /api/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue(null);
    mockGetUserSystemPrompt.mockReturnValue(null);
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
});
