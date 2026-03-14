import { describe, expect, it } from "vitest";
import type { AttachedFile } from "../types";
import { canGenerateSolutionDocs, hasInvalidSelectedFiles, isZipFileName } from "./solutionUploadValidation";
import type { UploadClassification } from "../../lib/classifyUploads";

function makeAttachedFile(overrides: Partial<AttachedFile> = {}): AttachedFile {
  return {
    name: "solution.zip",
    type: "application/zip",
    size: 1024,
    isText: false,
    ...overrides,
  };
}

function makeClassification(type: UploadClassification["type"]): UploadClassification {
  return {
    type,
    reason: "test",
  };
}

describe("solutionUploadValidation", () => {
  it("recognizes zip filenames", () => {
    expect(isZipFileName("solution.zip")).toBe(true);
    expect(isZipFileName("solution.ZIP")).toBe(true);
    expect(isZipFileName("notes.txt")).toBe(false);
  });

  it("reports invalid selected state when a non-zip file is present", () => {
    expect(
      hasInvalidSelectedFiles([
        makeAttachedFile({ name: "solution.zip" }),
        makeAttachedFile({ name: "notes.txt" }),
      ])
    ).toBe(true);
  });

  it("reports invalid selected state when a file has an error", () => {
    expect(
      hasInvalidSelectedFiles([
        makeAttachedFile({ name: "solution.zip", error: "Invalid file type" }),
      ])
    ).toBe(true);
  });

  it("does not allow generation when no valid file is present", () => {
    expect(
      canGenerateSolutionDocs({
        files: [],
        uploadClassification: null,
        generating: false,
      })
    ).toBe(false);
  });

  it("does not allow generation when invalid selected state exists", () => {
    expect(
      canGenerateSolutionDocs({
        files: [makeAttachedFile({ name: "bad.txt", error: "Invalid file type" })],
        uploadClassification: makeClassification("unsupported"),
        generating: false,
      })
    ).toBe(false);
  });

  it("restores generation eligibility after the invalid file is removed", () => {
    const invalidFiles = [makeAttachedFile({ name: "bad.txt", error: "Invalid file type" })];
    expect(
      canGenerateSolutionDocs({
        files: invalidFiles,
        uploadClassification: makeClassification("unsupported"),
        generating: false,
      })
    ).toBe(false);

    const validFiles = [makeAttachedFile({ name: "solution.zip" })];
    expect(
      canGenerateSolutionDocs({
        files: validFiles,
        uploadClassification: makeClassification("power_platform_solution_zip"),
        generating: false,
      })
    ).toBe(true);
  });

  it("does not allow generation while generation is already in progress", () => {
    expect(
      canGenerateSolutionDocs({
        files: [makeAttachedFile({ name: "solution.zip" })],
        uploadClassification: makeClassification("power_platform_solution_zip"),
        generating: true,
      })
    ).toBe(false);
  });
});
