export type SharePointRef = {
  url: string;
  kind: "site" | "list" | "library" | "unknown";
  source: string;
};

export type SharePointEnrichmentStatus =
  | "not_needed"
  | "detected_requires_auth"
  | "disabled"
  | "available"
  | "failed";

export type SharePointColumn = {
  name: string;
  displayName: string;
  type: string;
  required: boolean;
  readOnly: boolean;
};

export type SharePointList = {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  columns: SharePointColumn[];
  webUrl: string;
  itemCount?: number;
};

export type SharePointLibrary = {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  webUrl: string;
  driveType: string;
};

export type SharePointMetadata = {
  siteUrl: string;
  siteId: string;
  siteName: string;
  lists: SharePointList[];
  libraries: SharePointLibrary[];
  errorMessage?: string;
};

export type ParsedSolutionResult = {
  solutionName?: string;
  solution_name?: string;
  version?: string;
  publisher?: string;
  components?: unknown[];
  sharepointRefs?: SharePointRef[];
  sharePointMetadata?: SharePointMetadata[];
  [key: string]: unknown;
};

export function splitParsedSolutionData(solution: ParsedSolutionResult) {
  const { sharePointMetadata, ...baseParsedSolution } = solution;
  return {
    parsedSolution: baseParsedSolution as ParsedSolutionResult,
    sharePointMetadata: Array.isArray(sharePointMetadata) ? sharePointMetadata : null,
  };
}

export function buildSolutionForGeneration(
  baseParsedSolution: ParsedSolutionResult,
  sharePointMetadataForGeneration: SharePointMetadata[] | null
): ParsedSolutionResult {
  if (!sharePointMetadataForGeneration?.length) {
    return baseParsedSolution;
  }

  return {
    ...baseParsedSolution,
    sharePointMetadata: sharePointMetadataForGeneration,
  };
}

export function hasDetectedSharePointReferences(
  baseParsedSolution: ParsedSolutionResult,
  detectedSharePointUrls: string[]
): boolean {
  const sharePointRefs = Array.isArray(baseParsedSolution.sharepointRefs)
    ? baseParsedSolution.sharepointRefs
    : [];
  return detectedSharePointUrls.length > 0 || sharePointRefs.length > 0;
}

export function shouldAttemptSharePointUserEnrichment(params: {
  authenticationRequired: boolean;
  detectedSharePointUrls: string[];
  sharePointToken: string | null;
}): boolean {
  return (
    params.authenticationRequired &&
    params.detectedSharePointUrls.length > 0 &&
    Boolean(params.sharePointToken)
  );
}

async function readRouteError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({}));
  if (typeof payload?.error === "string" && payload.error.trim().length > 0) {
    return payload.error;
  }
  return fallback;
}

export async function fetchSharePointEnrichmentWithUserToken(params: {
  accessToken: string;
  sharePointUrls: string[];
  fallbackMetadata: SharePointMetadata[] | null;
  fetchImpl?: typeof fetch;
}): Promise<{
  metadata: SharePointMetadata[] | null;
  status: SharePointEnrichmentStatus;
  error?: string;
}> {
  const { accessToken, sharePointUrls, fallbackMetadata, fetchImpl = fetch } = params;

  let resolvedSharePointMetadata = fallbackMetadata;
  let resolvedSharePointEnrichmentStatus: SharePointEnrichmentStatus =
    fallbackMetadata?.length ? "available" : "failed";

  try {
    const spRes = await fetchImpl("/api/fetch-sharepoint-metadata-with-user-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken,
        sharePointUrls,
        includeColumns: true,
      }),
    });

    if (spRes.ok) {
      const spData = await spRes.json().catch(() => ({}));
      if (Array.isArray(spData.sites)) {
        resolvedSharePointMetadata = spData.sites;
      }

      if (spData.success || resolvedSharePointMetadata?.length) {
        resolvedSharePointEnrichmentStatus = "available";
      } else if (!resolvedSharePointMetadata?.length) {
        resolvedSharePointEnrichmentStatus = "failed";
      }

      return {
        metadata: resolvedSharePointMetadata,
        status: resolvedSharePointEnrichmentStatus,
        error: typeof spData?.error === "string" ? spData.error : undefined,
      };
    }

    const errorMessage = await readRouteError(spRes, "Failed to fetch SharePoint metadata.");
    if (!resolvedSharePointMetadata?.length) {
      resolvedSharePointEnrichmentStatus = "failed";
    }

    return {
      metadata: resolvedSharePointMetadata,
      status: resolvedSharePointEnrichmentStatus,
      error: errorMessage,
    };
  } catch (err: any) {
    if (!resolvedSharePointMetadata?.length) {
      resolvedSharePointEnrichmentStatus = "failed";
    }

    return {
      metadata: resolvedSharePointMetadata,
      status: resolvedSharePointEnrichmentStatus,
      error: err?.message || "Failed to fetch SharePoint metadata.",
    };
  }
}
