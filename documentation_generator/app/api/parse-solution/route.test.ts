import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mockValidateSolutionZip = vi.fn();
const mockIsSharePointEnrichmentEnabled = vi.fn();

vi.mock("../../../lib/validateSolutionZip", () => ({
  validateSolutionZip: (...args: unknown[]) => mockValidateSolutionZip(...args),
}));

vi.mock("../../../lib/featureFlags", () => ({
  isSharePointEnrichmentEnabled: () => mockIsSharePointEnrichmentEnabled(),
}));

function createRequest(fileName = "solution.zip") {
  const formData = new FormData();
  formData.append("file", new File(["zip-content"], fileName, { type: "application/zip" }));
  return {
    formData: vi.fn().mockResolvedValue(formData),
  } as unknown as Request;
}

describe("POST /api/parse-solution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateSolutionZip.mockResolvedValue({ ok: true });
    mockIsSharePointEnrichmentEnabled.mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("normalizes the backend auth-required envelope so data is the real parsed solution", async () => {
    const parsedSolution = {
      solutionName: "ContosoSample",
      version: "1.0.0.0",
      components: [{ id: "comp-1" }],
    };

    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: parsedSolution,
          authenticationRequired: true,
          sharePointUrls: ["https://contoso.sharepoint.com/sites/demo"],
          sharePointEnrichmentStatus: "detected_requires_auth",
          message: "SharePoint authentication required",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const response = await POST(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      data: parsedSolution,
      authenticationRequired: true,
      sharePointUrls: ["https://contoso.sharepoint.com/sites/demo"],
      sharePointEnrichmentStatus: "detected_requires_auth",
      message: "SharePoint authentication required",
      sharePointEnrichmentEnabled: true,
    });
  });

  it("keeps plain parsed solutions usable when no SharePoint wrapper is returned", async () => {
    const parsedSolution = {
      solutionName: "ContosoSample",
      version: "1.0.0.0",
      components: [{ id: "comp-1" }],
    };

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(parsedSolution), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const response = await POST(createRequest());
    const payload = await response.json();

    expect(payload).toEqual({
      ok: true,
      data: parsedSolution,
      authenticationRequired: false,
      sharePointUrls: [],
      sharePointEnrichmentStatus: "not_needed",
      sharePointEnrichmentEnabled: true,
    });
  });

  it("preserves the disabled enrichment contract when the feature flag is off", async () => {
    mockIsSharePointEnrichmentEnabled.mockReturnValue(false);

    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            solutionName: "ContosoSample",
            components: [{ id: "comp-1" }],
          },
          authenticationRequired: false,
          sharePointUrls: ["https://contoso.sharepoint.com/sites/demo"],
          sharePointEnrichmentStatus: "disabled",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const response = await POST(createRequest());
    const payload = await response.json();

    expect(payload.sharePointEnrichmentEnabled).toBe(false);
    expect(payload.sharePointEnrichmentStatus).toBe("disabled");
    expect(payload.data).toEqual({
      solutionName: "ContosoSample",
      components: [{ id: "comp-1" }],
    });
  });

  it("rejects non-zip uploads with a clear client-facing error", async () => {
    const response = await POST(createRequest("notes.txt"));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Only .zip solution files are supported.",
        hint: "Upload a Power Platform solution .zip file.",
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
