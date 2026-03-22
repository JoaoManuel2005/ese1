import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useOutputTypes } from "./useOutputTypes";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useOutputTypes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps built-in types and loads custom prompts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
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
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOutputTypes("authenticated"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.outputTypes.some((entry) => entry.id === "documentation")).toBe(true);
    expect(result.current.outputTypes.some((entry) => entry.id === "diagrams")).toBe(true);
    expect(result.current.outputTypes.some((entry) => entry.id === "custom:prompt-1")).toBe(true);
  });

  it("falls back to built-in output types when custom prompts are empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
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
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOutputTypes("authenticated"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.outputTypes).toHaveLength(2);
    expect(result.current.outputTypes.every((entry) => entry.kind === "builtin")).toBe(true);
  });

  it("keeps built-in output types when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network down")));

    const { result } = renderHook(() => useOutputTypes("authenticated"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBe("Network down");
    expect(result.current.outputTypes.some((entry) => entry.id === "documentation")).toBe(true);
    expect(result.current.outputTypes.some((entry) => entry.id === "diagrams")).toBe(true);
  });
});
