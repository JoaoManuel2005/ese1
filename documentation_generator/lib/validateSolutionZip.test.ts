import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { validateSolutionZip } from "./validateSolutionZip";

async function createZipFile(entries: Record<string, string>, filename = "test.zip"): Promise<File> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content);
  }
  const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
  const file = new File([arrayBuffer], filename);
  if (typeof file.arrayBuffer !== "function") {
    (file as File & { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = () => Promise.resolve(arrayBuffer);
  }
  return file;
}

describe("validateSolutionZip", () => {
  it("returns ok: false when no file provided", async () => {
    const result = await validateSolutionZip(null as any);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("No file provided");
  });

  it("returns ok: false when file is not .zip", async () => {
    const file = new File(["x"], "document.pdf");
    const result = await validateSolutionZip(file);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("File is not a .zip file");
  });

  it("returns ok: false when zip has no solution markers", async () => {
    const file = await createZipFile({ "readme.txt": "hello" });
    const result = await validateSolutionZip(file);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Power Platform solution markers|Failed to read zip/);
  });

  it("returns ok: true when zip contains solution.xml", async () => {
    const file = await createZipFile({
      "Other/Solution.xml": "<ImportExportXml></ImportExportXml>",
    });
    const result = await validateSolutionZip(file);
    expect(result.ok).toBe(true);
  });

  it("returns ok: true when zip contains [Content_Types].xml", async () => {
    const file = await createZipFile({
      "[Content_Types].xml": "<Types></Types>",
    });
    const result = await validateSolutionZip(file);
    expect(result.ok).toBe(true);
  });

  it("returns ok: false with reason when zip is invalid", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "bad.zip");
    const result = await validateSolutionZip(file);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Failed to read zip");
  });
});
