import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mockValidateSolutionZip = vi.fn();

vi.mock("../../../lib/validateSolutionZip", () => ({
  validateSolutionZip: (...args: unknown[]) => mockValidateSolutionZip(...args),
}));

function createRequest(fileName = "solution.zip") {
  const formData = new FormData();
  formData.append("file", new File(["zip-content"], fileName, { type: "application/zip" }));
  formData.append("dataset_id", "dataset-1");
  return {
    formData: vi.fn().mockResolvedValue(formData),
  } as unknown as Request;
}

describe("POST /api/rag-ingest-zip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateSolutionZip.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", vi.fn());
  });

  it("normalizes backend invalid solution zip errors into a structured payload", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        '{"ok":false,"error":{"code":"INVALID_SOLUTION_ZIP","message":"Zip does not look like a Power Platform solution export.","hint":"Export a solution from Power Platform and upload the .zip."}}',
        { status: 400 }
      )
    );

    const response = await POST(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      ok: false,
      error: {
        code: "INVALID_SOLUTION_ZIP",
        message: "Zip does not look like a Power Platform solution export.",
        hint: "Export a solution from Power Platform and upload the .zip.",
      },
    });
  });
});
