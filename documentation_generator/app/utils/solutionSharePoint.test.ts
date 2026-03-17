import { describe, expect, it, vi } from "vitest";
import {
  buildSolutionForGeneration,
  fetchSharePointEnrichmentWithUserToken,
  hasDetectedSharePointReferences,
  shouldAttemptSharePointUserEnrichment,
  splitParsedSolutionData,
  type ParsedSolutionResult,
  type SharePointMetadata,
} from "./solutionSharePoint";

const sampleSharePointMetadata: SharePointMetadata[] = [
  {
    siteUrl: "https://contoso.sharepoint.com/sites/reply",
    siteId: "site-1",
    siteName: "Reply Library",
    lists: [],
    libraries: [],
  },
];

describe("splitParsedSolutionData", () => {
  it("separates base solution data from SharePoint metadata", () => {
    const solution: ParsedSolutionResult = {
      solutionName: "Reply",
      components: [{ id: "comp-1" }],
      sharePointMetadata: sampleSharePointMetadata,
    };

    const result = splitParsedSolutionData(solution);

    expect(result.parsedSolution).toEqual({
      solutionName: "Reply",
      components: [{ id: "comp-1" }],
    });
    expect(result.sharePointMetadata).toEqual(sampleSharePointMetadata);
  });
});

describe("buildSolutionForGeneration", () => {
  it("returns the base parsed solution unchanged when enrichment is unavailable", () => {
    const baseSolution: ParsedSolutionResult = {
      solutionName: "Reply",
      components: [{ id: "comp-1" }],
    };

    const result = buildSolutionForGeneration(baseSolution, null);

    expect(result).toBe(baseSolution);
  });

  it("adds SharePoint metadata without mutating the base parsed solution", () => {
    const baseSolution: ParsedSolutionResult = {
      solutionName: "Reply",
      components: [{ id: "comp-1" }],
    };

    const result = buildSolutionForGeneration(baseSolution, sampleSharePointMetadata);

    expect(result).toEqual({
      solutionName: "Reply",
      components: [{ id: "comp-1" }],
      sharePointMetadata: sampleSharePointMetadata,
    });
    expect(baseSolution).toEqual({
      solutionName: "Reply",
      components: [{ id: "comp-1" }],
    });
  });
});

describe("SharePoint detection and enrichment gating", () => {
  it("detects no SharePoint dependency when neither URLs nor refs are present", () => {
    expect(
      hasDetectedSharePointReferences(
        {
          solutionName: "Reply",
          components: [],
        },
        []
      )
    ).toBe(false);
  });

  it("detects SharePoint when the solution export contains refs even without fetched URLs", () => {
    expect(
      hasDetectedSharePointReferences(
        {
          solutionName: "Reply",
          sharepointRefs: [
            {
              url: "https://contoso.sharepoint.com/sites/reply",
              kind: "site",
              source: "knowledge_source_item",
            },
          ],
        },
        []
      )
    ).toBe(true);
  });

  it("only attempts user-token enrichment when auth is required, URLs are detected, and a token exists", () => {
    expect(
      shouldAttemptSharePointUserEnrichment({
        authenticationRequired: true,
        detectedSharePointUrls: ["https://contoso.sharepoint.com/sites/reply"],
        sharePointToken: "token",
      })
    ).toBe(true);

    expect(
      shouldAttemptSharePointUserEnrichment({
        authenticationRequired: false,
        detectedSharePointUrls: ["https://contoso.sharepoint.com/sites/reply"],
        sharePointToken: "token",
      })
    ).toBe(false);

    expect(
      shouldAttemptSharePointUserEnrichment({
        authenticationRequired: true,
        detectedSharePointUrls: [],
        sharePointToken: "token",
      })
    ).toBe(false);

    expect(
      shouldAttemptSharePointUserEnrichment({
        authenticationRequired: true,
        detectedSharePointUrls: ["https://contoso.sharepoint.com/sites/reply"],
        sharePointToken: null,
      })
    ).toBe(false);
  });
});

describe("fetchSharePointEnrichmentWithUserToken", () => {
  it("returns available enrichment when metadata fetch succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          sites: sampleSharePointMetadata,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchSharePointEnrichmentWithUserToken({
      accessToken: "token",
      sharePointUrls: ["https://contoso.sharepoint.com/sites/reply"],
      fallbackMetadata: null,
      fetchImpl,
    });

    expect(result).toEqual({
      metadata: sampleSharePointMetadata,
      status: "available",
      error: undefined,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps base generation viable when enrichment fails and no fallback metadata exists", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Permission required" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await fetchSharePointEnrichmentWithUserToken({
      accessToken: "token",
      sharePointUrls: ["https://contoso.sharepoint.com/sites/reply"],
      fallbackMetadata: null,
      fetchImpl,
    });

    expect(result).toEqual({
      metadata: null,
      status: "failed",
      error: "Permission required",
    });
  });

  it("preserves existing metadata when a follow-up enrichment request fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Tenant policy blocked request" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await fetchSharePointEnrichmentWithUserToken({
      accessToken: "token",
      sharePointUrls: ["https://contoso.sharepoint.com/sites/reply"],
      fallbackMetadata: sampleSharePointMetadata,
      fetchImpl,
    });

    expect(result).toEqual({
      metadata: sampleSharePointMetadata,
      status: "available",
      error: "Tenant policy blocked request",
    });
  });
});
