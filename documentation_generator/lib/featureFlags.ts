function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isSharePointEnrichmentEnabled(): boolean {
  return parseBooleanFlag(process.env.FEATURE_SHAREPOINT_ENRICHMENT);
}
