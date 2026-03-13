import { afterEach, describe, expect, it, vi } from "vitest";
import { isSharePointEnrichmentEnabled } from "./featureFlags";

describe("isSharePointEnrichmentEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true for truthy feature flag values", () => {
    vi.stubEnv("FEATURE_SHAREPOINT_ENRICHMENT", "true");
    expect(isSharePointEnrichmentEnabled()).toBe(true);

    vi.stubEnv("FEATURE_SHAREPOINT_ENRICHMENT", "YES");
    expect(isSharePointEnrichmentEnabled()).toBe(true);
  });

  it("returns false when the feature flag is unset or falsey", () => {
    vi.stubEnv("FEATURE_SHAREPOINT_ENRICHMENT", "");
    expect(isSharePointEnrichmentEnabled()).toBe(false);

    vi.stubEnv("FEATURE_SHAREPOINT_ENRICHMENT", "false");
    expect(isSharePointEnrichmentEnabled()).toBe(false);
  });
});
