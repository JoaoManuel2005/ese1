import type { AttachedFile } from "../types";
import type { UploadClassification } from "../../lib/classifyUploads";

export function isZipFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".zip");
}

export function hasInvalidSelectedFiles(files: AttachedFile[]): boolean {
  return files.some((file) => !isZipFileName(file.name) || Boolean(file.error));
}

export function canGenerateSolutionDocs(args: {
  files: AttachedFile[];
  uploadClassification: UploadClassification | null;
  generating: boolean;
}): boolean {
  const { files, uploadClassification, generating } = args;
  const hasFiles = files.length > 0;
  const hasOnlyZipFiles = hasFiles && files.every((file) => isZipFileName(file.name));
  const hasSolution = uploadClassification?.type === "power_platform_solution_zip";

  return !hasInvalidSelectedFiles(files) && hasOnlyZipFiles && hasSolution && !generating;
}
