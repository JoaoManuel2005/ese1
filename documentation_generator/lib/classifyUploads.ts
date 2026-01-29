/**
 * Classify uploaded files to determine processing mode
 */

import JSZip from "jszip";

export type UploadClassificationType =
  | "power_platform_solution_zip"
  | "solution_zip"
  | "docs"
  | "generic_docs"
  | "unknown"
  | "unsupported";

export interface UploadClassification {
  type: UploadClassificationType;
  reason: string;
}

const DOC_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".js",
  ".ts",
  ".py",
  ".pdf",
  ".xml",
  ".html",
  ".htm",
]);

const SOLUTION_MARKERS = ["solution.xml", "[content_types].xml"];

/**
 * Check if a zip file contains Power Platform solution markers
 */
async function isSolutionZip(file: File): Promise<boolean> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const names = Object.keys(zip.files).map((n) => n.toLowerCase());

    return SOLUTION_MARKERS.some((marker) =>
      names.some((name) => name.endsWith(marker))
    );
  } catch {
    return false;
  }
}

/**
 * Classify a list of uploaded files to determine the processing mode
 */
export async function classifyUploads(
  files: FileList | File[]
): Promise<UploadClassification> {
  const fileArray = Array.from(files);

  if (fileArray.length === 0) {
    return { type: "unsupported", reason: "No files provided" };
  }

  // Check for solution zip first
  for (const file of fileArray) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      const isSolution = await isSolutionZip(file);
      if (isSolution) {
        return {
          type: "power_platform_solution_zip",
          reason: "Power Platform solution detected",
        };
      }
    }
  }

  // Check for document files
  const hasDocuments = fileArray.some((file) => {
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    return DOC_EXTENSIONS.has(ext);
  });

  if (hasDocuments) {
    return {
      type: "docs",
      reason: "Document files detected",
    };
  }

  return {
    type: "unsupported",
    reason: "No supported file types found",
  };
}
