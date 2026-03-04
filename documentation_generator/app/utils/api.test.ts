import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchModels, fetchLocalModels } from "./api";

describe("fetchModels", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns models array when API returns models", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ models: ["gpt-4", "gpt-3.5-turbo"] }),
    });

    const result = await fetchModels();
    expect(result).toEqual(["gpt-4", "gpt-3.5-turbo"]);
    expect(fetch).toHaveBeenCalledWith("/api/models");
  });

  it("returns empty array when API returns non-array or missing models", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const result = await fetchModels();
    expect(result).toEqual([]);
  });

  it("throws when response is not ok", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("Server error"),
    });

    await expect(fetchModels()).rejects.toThrow("Server error");
  });
});

describe("fetchLocalModels", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed JSON when ok", async () => {
    const data = { models: ["llama3"] };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(data),
    });

    const result = await fetchLocalModels();
    expect(result).toEqual(data);
    expect(fetch).toHaveBeenCalledWith("/api/local-models");
  });

  it("throws when response is not ok", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("Not found"),
    });

    await expect(fetchLocalModels()).rejects.toThrow("Not found");
  });
});
