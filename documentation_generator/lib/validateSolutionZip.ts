/**
 * Validate that a zip file is a Power Platform solution export
 */

import JSZip from "jszip";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

const SOLUTION_MARKERS = ["solution.xml", "[content_types].xml"];

/**
 * Validate that a file is a Power Platform solution zip
 */
export async function validateSolutionZip(file: File): Promise<ValidationResult> {
  if (!file) {
    return { ok: false, reason: "No file provided" };
  }

  if (!file.name.toLowerCase().endsWith(".zip")) {
    return { ok: false, reason: "File is not a .zip file" };
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const names = Object.keys(zip.files).map((n) => n.toLowerCase());

    const hasSolutionMarkers = SOLUTION_MARKERS.some((marker) =>
      names.some((name) => name.endsWith(marker))
    );

    if (!hasSolutionMarkers) {
      return {
        ok: false,
        reason: "Zip does not contain Power Platform solution markers",
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `Failed to read zip file: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
