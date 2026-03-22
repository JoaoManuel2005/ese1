import { describe, it, expect } from "vitest";
import {
  createDatasetId,
  createMessageId,
  mapProviderError,
  mapUploadErrorMessage,
  parseApiError,
} from "./helpers";

describe("createDatasetId", () => {
  it("returns a non-empty string", () => {
    const id = createDatasetId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("returns a string that looks like UUID or timestamp-hex when crypto.randomUUID exists", () => {
    const id = createDatasetId();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const isFallback = /^\d+-[0-9a-z]+$/.test(id);
    expect(isUuid || isFallback).toBe(true);
  });
});

describe("createMessageId", () => {
  it("returns a non-empty string", () => {
    const id = createMessageId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("matches timestamp-hex pattern", () => {
    const id = createMessageId();
    expect(id).toMatch(/^\d+-[0-9a-z]+$/);
  });
});

describe("mapProviderError", () => {
  it("returns API key message for 401 status", () => {
    const result = mapProviderError("Unauthorized", 401);
    expect(result).toContain("invalid API key");
    expect(result).toContain("Switch to Local");
  });

  it("returns API key message when message contains invalid api key", () => {
    const result = mapProviderError("Invalid API key provided");
    expect(result).toContain("invalid API key");
  });

  it("returns quota message for 429 status", () => {
    const result = mapProviderError("Too many requests", 429);
    expect(result).toContain("quota");
    expect(result).toContain("billing");
  });

  it("returns quota message when message contains insufficient_quota", () => {
    const result = mapProviderError("insufficient_quota for this model");
    expect(result).toContain("quota");
  });

  it("returns model not available when message contains model not found", () => {
    const result = mapProviderError("model_not_found: gpt-99");
    expect(result).toContain("model not available");
  });

  it("returns local LLM message with URL when match", () => {
    const result = mapProviderError("Local LLM not reachable at http://localhost:11434");
    expect(result).toContain("http://localhost:11434");
    expect(result).toContain("Ollama");
  });

  it("returns generic local LLM message when no URL", () => {
    const result = mapProviderError("Local LLM not reachable");
    expect(result).toContain("Local LLM not reachable");
  });

  it("returns original message for unknown error", () => {
    const msg = "Something went wrong";
    expect(mapProviderError(msg)).toBe(msg);
  });
});

describe("parseApiError", () => {
  it("extracts message and code from payload.error", () => {
    const result = parseApiError(
      { error: { message: "Bad request", code: "INVALID" } },
      "Fallback"
    );
    expect(result).toEqual({ message: "Bad request", code: "INVALID", hint: undefined });
  });

  it("extracts hint when present", () => {
    const result = parseApiError(
      { error: { message: "Err", hint: "Do X" } },
      "Fallback"
    );
    expect(result.hint).toBe("Do X");
  });

  it("uses payload.error as string when no message", () => {
    const result = parseApiError({ error: "Simple error" }, "Fallback");
    expect(result.message).toBe("Simple error");
  });

  it("uses payload.detail.message when error shape missing", () => {
    const result = parseApiError({ detail: { message: "Detail msg" } }, "Fallback");
    expect(result.message).toBe("Detail msg");
  });

  it("uses payload.detail as message when detail is string", () => {
    const result = parseApiError({ detail: "Detail string" }, "Fallback");
    expect(result.message).toBe("Detail string");
  });

  it("returns fallback when no known shape", () => {
    const result = parseApiError({}, "Fallback message");
    expect(result.message).toBe("Fallback message");
  });

  it("returns fallback for null payload", () => {
    const result = parseApiError(null, "Fallback");
    expect(result.message).toBe("Fallback");
  });
});

describe("mapUploadErrorMessage", () => {
  it("maps INVALID_SOLUTION_ZIP to a friendly message", () => {
    const result = mapUploadErrorMessage({
      code: "INVALID_SOLUTION_ZIP",
      message: "Zip does not look like a Power Platform solution export.",
    });

    expect(result).toBe(
      "This .zip file does not appear to be a valid Power Platform solution export. Please choose another file."
    );
  });

  it("returns a safe fallback for json-like unknown messages", () => {
    const result = mapUploadErrorMessage({
      message: '{"ok":false,"error":{"code":"INVALID_SOLUTION_ZIP"}}',
    });

    expect(result).toBe("We couldn't validate this .zip file. Please choose another file.");
  });

  it("keeps plain human-readable unknown messages", () => {
    const result = mapUploadErrorMessage({ message: "Service unavailable" });
    expect(result).toBe("Service unavailable");
  });
});
